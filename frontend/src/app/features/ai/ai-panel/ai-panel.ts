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
import { AiSource, AiChatPreview } from '../../../shared/models/ai';
import { AiNotesStore, eligibleNotes } from '../../../core/ai/ai-notes-store';
import { AiNotes } from '../ai-notes/ai-notes';
import { AiPreview } from '../ai-preview/ai-preview';
import { describeError } from '../../../core/workspace/errors';

/** Un trozo de respuesta ya separado en prosa y SQL. */
export interface ChatPart {
  readonly kind: 'text' | 'sql' | 'code';
  readonly language?: string;
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
  readonly connectionSaved?: boolean;
  readonly knownConnectionIds?: readonly string[];
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
  imports: [Icon, TranslatePipe, AiNotes, AiPreview],
  templateUrl: './ai-panel.html',
  styleUrl: './ai-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiPanel {
  private readonly _store = inject(AiStore);
  private readonly _i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly catalog = inject(AiCatalog);
  protected readonly notes = inject(AiNotesStore);
  protected readonly notesOpen = signal(false);
  protected readonly noteSource = computed(
    () =>
      this.context().source ?? {
        connectionId: '',
        connectionName: '',
        database: this.context().database,
      },
  );
  readonly requestedTable = input<DatabaseObject | null>(null);
  protected readonly selectorOpen = signal(false);
  protected readonly catalogQuery = signal('');
  protected readonly preparing = signal(false);
  protected readonly tableKey = aiTableKey;
  protected readonly tableName = qualifiedName;
  private mention: { start: number; end: number } | null = null;
  private preparation = 0;
  protected readonly review = signal<{
    request: AiChatRequestSnapshot;
    preview: AiChatPreview;
    rawDraft: string;
  } | null>(null);
  protected readonly preparationError = signal('');
  protected readonly historyLimit = signal<number | null>(null);
  protected readonly historyQuestions = this._store.historyQuestions;
  protected readonly omittedQuestions = computed(() => {
    const omitted = this.review()?.request.omittedTurnIndices ?? [];
    return this.historyQuestions().filter((question) => omitted.includes(question.index));
  });
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
    if (request.preview) return request.preview.context || this._i18n.t('ai.noAttachedContext');
    const context = request.context;
    if (!context) return this._i18n.t('ai.noAttachedContext');
    return [
      context.source.engine,
      context.source.serverVersion,
      context.source.database,
      context.source.schema,
      context.warnings?.join('\n'),
      ...(context.notes ?? []).map(
        (note) =>
          `${note.database} · ${
            note.reference
              ? [note.reference.schema, note.reference.table, note.reference.column]
                  .filter(Boolean)
                  .join('.')
              : this._i18n.t('ai.notes.base')
          } (${this.formatTimestamp(note.updatedAtUtc)}):\n${note.text}`,
      ),
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
    effect(() => {
      this.active();
      untracked(() => {
        this.review.set(null);
        this.preparation++;
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.preparation++;
      this.catalog.pause();
    });
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
    if (changed) {
      this.review.set(null);
      this.preparation++;
    }
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
    const includeSchema = this.includeSchema();
    const includeSql = this.includeSql();
    const preparation = ++this.preparation;
    this.preparing.set(true);
    this.preparationError.set('');
    this.review.set(null);
    try {
      if (this.contextAllowed() && includeSchema && this.catalog.selected().length) {
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
      if (this.contextAllowed() && provider.shareBusinessNotes && !(await this.notes.load())) {
        this.notesOpen.set(true);
        return;
      }
      if (
        preparation !== this.preparation ||
        this.active() !== provider ||
        this.context().sessionId !== context.sessionId ||
        this.context().source?.connectionId !== context.source?.connectionId ||
        this.context().database !== context.database
      )
        return;
      const request = this._store.prepare(
        text,
        this.contextAllowed()
          ? {
              source: context.source ?? {
                connectionId: '',
                connectionName: '',
                database: context.database,
              },
              sql: includeSql ? context.sql.trim() || undefined : undefined,
              schema: includeSchema ? this.catalog.described().schema || undefined : undefined,
              tables: includeSchema ? [...this.catalog.names()] : [],
              warnings: includeSchema ? [...this.catalog.warnings()] : [],
              notes:
                provider.shareBusinessNotes && context.connectionSaved
                  ? eligibleNotes(
                      this.notes.notes(),
                      this.noteSource(),
                      includeSchema ? this.catalog.selected() : [],
                    )
                  : undefined,
            }
          : undefined,
        this.historyLimit(),
      );
      if (!request) return;
      const preview = await this._store.preview(request);
      if (
        preparation !== this.preparation ||
        this.active() !== provider ||
        this.context().sessionId !== context.sessionId ||
        this.context().database !== context.database
      )
        return;
      this.selectorOpen.set(false);
      this.review.set({ request, preview, rawDraft });
    } catch (error) {
      if (preparation === this.preparation)
        this.preparationError.set(describeError(error, this._i18n));
    } finally {
      this.preparing.set(false);
    }
  }

  protected confirmReview(): void {
    const review = this.review();
    if (!review || this.preparing()) return;
    if (this._store.sendPrepared(review.request, review.preview)) {
      if (this.draft() === review.rawDraft) this.draft.set('');
      this.review.set(null);
    }
  }

  protected backToEditing(): void {
    this.review.set(null);
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLTextAreaElement>('.composer__input')?.focus(),
    );
  }

  protected changeHistory(limit: number | null): void {
    this.historyLimit.set(limit);
    void this.send();
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
    this.preparation++;
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
  const fence = /^```([^`\r\n]*)\r?\n([\s\S]*?)(?:^```[ \t]*(?:\r?\n|(?![\s\S]))|(?![\s\S]))/gm;
  let cursor = 0;
  let match = fence.exec(text);

  while (match) {
    const before = text.slice(cursor, match.index).trim();

    if (before.length > 0) {
      parts.push({ kind: 'text', text: before });
    }

    const sql = match[2].trim();
    const tag = match[1].trim().toLowerCase();
    const sqlTag = /^sql(?:-(insert|replace))?$/.exec(tag);

    if (sql.length > 0) {
      parts.push({
        kind: sqlTag ? 'sql' : 'code',
        text: sql,
        ...(sqlTag
          ? { action: sqlTag[1] === 'replace' ? ('replace' as const) : ('insert' as const) }
          : { language: tag }),
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
