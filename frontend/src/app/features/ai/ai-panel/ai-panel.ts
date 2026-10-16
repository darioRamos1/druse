import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  DestroyRef,
  ElementRef,
  untracked,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { AiStore, AiChatRequestSnapshot } from '../../../core/ai/ai-store';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { Icon } from '../../../shared/ui/icon/icon';
import { formatDate } from '../../../core/i18n/locale-format';
import { AiCatalog, aiTableKey } from '../../../core/ai/ai-catalog';
import { qualifiedName } from '../../../core/ai/ai-context';
import { DatabaseObject } from '../../../shared/models/workspace';
import { AiSource } from '../../../shared/models/ai';

/** Un trozo de respuesta ya separado en prosa y SQL. */
export interface ChatPart {
  readonly kind: 'text' | 'sql';
  readonly text: string;
  /** Acción que recomienda el modelo para este bloque. */
  readonly action?: 'insert' | 'replace';
}

/**
 * Lo que el asistente puede saber de la base sin que nadie se lo escriba.
 *
 * Lo compone quien abre el panel —el shell, que sí conoce el espacio de
 * trabajo— y llega ya hecho: el panel no habla con la base de datos.
 */
export interface AiContext {
  /** Consulta abierta en el editor. Puede estar vacía. */
  readonly sql: string;
  /** Estructura de las tablas en juego, en texto. Vacío si no hay conexión abierta. */
  readonly schema: string;
  /** Nombres de las tablas que se han metido, para poder enseñarlos. */
  readonly tables: readonly string[];
  /** Base a la que apunta la pestaña, para nombrarla en la pantalla vacía. */
  readonly database: string;
  readonly source?: AiSource;
  readonly sessionId?: string;
  readonly revision?: number;
}

/**
 * El asistente, como panel lateral.
 *
 * Tres decisiones que se ven en pantalla y que no son de adorno:
 *
 * 1. **Cada pregunta conserva su contexto.** Se puede consultar lo preparado y
 *    su confirmación del servidor aunque después se edite el SQL o cambie la base.
 * 2. **El SQL no se ejecuta solo.** Se inserta en el editor, donde una persona
 *    lo lee y decide. Un modelo que se equivoca de `WHERE` en un `DELETE` no
 *    tiene por qué poder ejecutarlo.
 * 3. **El proveedor está siempre a la vista.** Hablar con el MaaS de la empresa
 *    y hablar con un modelo del propio equipo no son lo mismo, y confundirlos
 *    es mandar fuera lo que no debía salir.
 */
@Component({
  selector: 'app-ai-panel',
  imports: [Icon, TranslatePipe],
  templateUrl: './ai-panel.html',
  styleUrl: './ai-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiPanel {
  private readonly _store = inject(AiStore);
  private readonly _i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly catalog = inject(AiCatalog);
  readonly requestedTable = input<DatabaseObject | null>(null);
  protected readonly selectorOpen = signal(false);
  protected readonly catalogQuery = signal('');
  protected readonly preparing = signal(false);
  protected readonly tableKey = aiTableKey;
  protected readonly tableName = qualifiedName;
  private mention: { start: number; end: number } | null = null;
  protected readonly matches = computed(() => {
    const query = this.catalogQuery().toLowerCase();
    return this.catalog
      .catalog()
      .filter((table) => `${table.schema ?? ''}.${table.name}`.toLowerCase().includes(query));
  });

  /** «Pregunta sobre {base}», con el nombre de la base en `<code>`. */
  protected askParts(database: string) {
    return this._i18n.tParts('ai.askAboutDatabase', { database });
  }

  /** Deja empezada la frase de una sugerencia, en el idioma elegido. */
  protected suggest(key: string): void {
    this.draft.set(this._i18n.t(key));
  }

  /** Lo que se le puede contar al modelo sobre la base abierta. */
  readonly context = input<AiContext>({ sql: '', schema: '', tables: [], database: '' });

  readonly closed = output<void>();

  /** SQL que el usuario quiere llevarse al editor. */
  readonly insert = output<string>();

  /** SQL que sustituye únicamente la consulta activa del editor. */
  readonly replace = output<string>();

  /** El usuario quiere configurar sus proveedores. */
  readonly configure = output<void>();

  protected readonly draft = signal('');
  protected readonly pickerOpen = signal(false);
  protected readonly includeSql = signal(true);
  protected readonly includeSchema = signal(true);

  protected readonly providers = this._store.providers;
  protected readonly active = this._store.active;
  protected readonly busy = this._store.busy;
  protected readonly configured = this._store.configured;
  protected readonly formatTimestamp = (value: string) =>
    formatDate(value, { dateStyle: 'short', timeStyle: 'short' });
  protected readonly retry = () => this._store.retry();
  protected preparedContext(request: AiChatRequestSnapshot): string {
    const context = request.context;
    if (!context) return this._i18n.t('ai.noAttachedContext');
    return [
      context.source.engine,
      context.source.serverVersion,
      context.source.database,
      context.source.schema,
      context.warnings?.join('\n'),
      composeContext(
        {
          sql: context.sql ?? '',
          schema: context.schema ?? '',
          tables: context.tables,
          database: context.source.database,
        },
        true,
        true,
      ),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  constructor() {
    effect(() => {
      const context = this.context();
      untracked(() => this.activateContext(context));
    });
    effect(() => {
      const table = this.requestedTable();
      if (table)
        untracked(() => {
          this.activateContext(this.context());
          this.catalog.add(table);
          this.openContextPicker();
        });
    });
    inject(DestroyRef).onDestroy(() => this.catalog.pause());
  }

  private activateContext(context: AiContext): void {
    const source = context.source ?? {
      connectionId: '',
      connectionName: '',
      database: context.database,
    };
    this._store.setSource(source);
    const changed = this.catalog.activate({
      source,
      sessionId: context.sessionId ?? '',
      revision: context.revision,
    });
    if (changed && this.selectorOpen()) void this.catalog.loadCatalog();
  }

  protected openContextPicker(focus = false): void {
    this.selectorOpen.set(true);
    void this.catalog.loadCatalog();
    if (focus)
      setTimeout(() =>
        this.host.nativeElement.querySelector<HTMLInputElement>('.catalog-search')?.focus(),
      );
  }

  protected closeContextPicker(): void {
    this.selectorOpen.set(false);
    this.mention = null;
  }

  protected selectTable(table: DatabaseObject): void {
    if (!this.mention && this.catalog.isSelected(table)) this.catalog.remove(table);
    else {
      this.catalog.add(table);
      if (this.mention) {
        const value = this.draft();
        this.draft.set(
          value.slice(0, this.mention.start) +
            qualifiedName(table) +
            ' ' +
            value.slice(this.mention.end),
        );
        this.mention = null;
        this.catalogQuery.set('');
        this.host.nativeElement.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      }
    }
  }

  protected readonly isLocal = isLocal;
  protected readonly contextAllowed = computed(() => {
    const provider = this.active();

    return provider !== null && provider.disclosure !== 'nothing';
  });

  /** La conversación, con la respuesta ya partida en prosa y bloques de SQL. */
  protected readonly turns = computed(() =>
    this._store.turns().map((turn) => ({
      ...turn,
      parts:
        turn.role === 'assistant' ? split(turn.text) : [{ kind: 'text' as const, text: turn.text }],
    })),
  );

  /**
   * Qué promete el proveedor activo sobre dónde acaban los datos.
   *
   * Se dice con sus palabras y no con el nombre técnico del nivel: «nada sale a
   * internet» significa algo para cualquiera; «disclosure: schema» no.
   */
  protected readonly promise = computed(() => {
    const provider = this.active();

    if (!provider) {
      return '';
    }

    if (provider.kind === 'localcli') {
      return this._i18n.t('ai.promise.cli');
    }

    if (isLocal(provider.baseUrl)) {
      return this._i18n.t('ai.promise.local');
    }

    return this._i18n.t(
      provider.disclosure === 'nothing' ? 'ai.promise.nothing' : 'ai.promise.schema',
    );
  });

  protected async send(): Promise<void> {
    const rawDraft = this.draft();
    const text = rawDraft.trim();
    if (!text || this.busy() || this.preparing()) return;
    const context = this.context();
    const provider = this.active();
    if (!provider) return;
    this.preparing.set(true);
    try {
      if (this.contextAllowed() && this.includeSchema() && this.catalog.selected().length) {
        const current = await this.catalog.refreshSelected();
        if (
          !current ||
          this.active() !== provider ||
          this.context().sessionId !== context.sessionId ||
          this.context().database !== context.database
        )
          return;
        if (this.catalog.failures().length && !this.catalog.allowPartial()) {
          this.openContextPicker();
          return;
        }
      }
      this._store.ask(
        text,
        this.contextAllowed()
          ? {
              source: context.source ?? {
                connectionId: '',
                connectionName: '',
                database: context.database,
              },
              sql: this.includeSql() ? context.sql.trim() || undefined : undefined,
              schema: this.includeSchema()
                ? this.catalog.described().schema || undefined
                : undefined,
              tables: this.includeSchema() ? [...this.catalog.names()] : [],
              warnings: this.includeSchema() ? [...this.catalog.warnings()] : [],
            }
          : undefined,
      );
      if (this.draft() === rawDraft) this.draft.set('');
    } finally {
      this.preparing.set(false);
    }
  }

  /**
   * Enter manda; Mayús+Enter hace párrafo.
   *
   * Es lo que hace cualquier chat, y lo contrario obligaría a soltar el teclado
   * para pulsar un botón en la pregunta más corta.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.selectorOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeContextPicker();
      return;
    }
    if (event.key === 'Enter' && this.mention && this.selectorOpen()) {
      event.preventDefault();
      const first = this.matches()[0];
      if (first) this.selectTable(first);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  protected onInput(event: Event): void {
    const input = event.target as HTMLTextAreaElement;
    this.draft.set(input.value);
    const prefix = input.value.slice(0, input.selectionStart);
    const mention = /(?:^|\s)@([^@\s]*)$/.exec(prefix);
    if (mention && this.contextAllowed() && this.context().sessionId) {
      this.mention = { start: prefix.lastIndexOf('@'), end: input.selectionStart };
      this.catalogQuery.set(mention[1]);
      this.openContextPicker();
    } else this.mention = null;
  }

  protected choose(id: string): void {
    this._store.use(id);
    this.pickerOpen.set(false);
  }

  protected cancel(): void {
    if (this.preparing()) this.catalog.pause();
    this._store.cancel();
  }

  protected clear(): void {
    this._store.clear();
  }

  /** Manda una de las sugerencias. Recibe su clave del catálogo, no la frase. */
  protected ask(key: string): void {
    this.draft.set(this._i18n.t(key));
    this.send();
  }

  protected async copy(sql: string): Promise<void> {
    await navigator.clipboard.writeText(sql);
  }
}

/** Compone únicamente las partes de contexto que la persona dejó activadas. */
export function composeContext(
  context: AiContext,
  includeSql: boolean,
  includeSchema: boolean,
): string | undefined {
  const parts: string[] = [];
  const sql = context.sql.trim();

  if (includeSql && sql.length > 0) {
    parts.push(`SQL abierto en el editor:\n\n\`\`\`sql\n${sql}\n\`\`\``);
  }

  if (includeSchema && context.schema.trim().length > 0) {
    parts.push(`Estructura de las tablas en juego:\n\n${context.schema.trim()}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/**
 * Parte la respuesta en prosa y bloques de SQL.
 *
 * Se hace aquí y no con una librería de Markdown porque lo único que hace falta
 * distinguir es el SQL: es lo que lleva botones, y lo demás es texto corrido.
 * Traer un intérprete entero para eso pesaría más que la función.
 */
export function split(text: string): readonly ChatPart[] {
  const parts: ChatPart[] = [];
  const fence = /```(?:sql(?:-(insert|replace))?)?\n?([\s\S]*?)(?:```|$)/gi;
  let cursor = 0;
  let match = fence.exec(text);

  while (match) {
    const before = text.slice(cursor, match.index).trim();

    if (before.length > 0) {
      parts.push({ kind: 'text', text: before });
    }

    const sql = match[2].trim();

    if (sql.length > 0) {
      parts.push({
        kind: 'sql',
        text: sql,
        action: match[1]?.toLowerCase() === 'replace' ? 'replace' : 'insert',
      });
    }

    cursor = match.index + match[0].length;
    match = fence.exec(text);
  }

  const rest = text.slice(cursor).trim();

  if (rest.length > 0) {
    parts.push({ kind: 'text', text: rest });
  }

  return parts;
}

/** Un proveedor que vive en este equipo no manda nada a ninguna parte. */
function isLocal(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(baseUrl);
}
