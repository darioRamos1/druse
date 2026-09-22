import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  ElementRef,
  HostListener,
} from '@angular/core';

import { SavedSnippet } from '../../core/application-gateway/application-gateway';
import { ConnectionSummary, ExplorerNode, QueryTab } from '../../shared/models/workspace';
import { EngineBadge } from '../../shared/ui/engine-badge/engine-badge';
import { Icon } from '../../shared/ui/icon/icon';
import { DialogBackdrop } from '../../shared/a11y/dialog-backdrop';
import { editorShortcutLabel, shortcutLabel } from '../../core/shortcuts/shortcut-label';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

type PaletteItem = { readonly disabledReason?: string | null } & (
  | {
      readonly id: string;
      readonly kind: 'command';
      readonly label: string;
      readonly hint: string;
      /** La clave del comando: se busca también por ella (ver `searchable`). */
      readonly alias?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'tab';
      readonly label: string;
      readonly hint: string;
      readonly tab: QueryTab;
    }
  | {
      readonly id: string;
      readonly kind: 'connection';
      readonly label: string;
      readonly hint: string;
      readonly connection: ConnectionSummary;
    }
  | {
      readonly id: string;
      readonly kind: 'object';
      readonly label: string;
      readonly hint: string;
      readonly node: ExplorerNode;
    }
  | {
      readonly id: string;
      readonly kind: 'snippet';
      readonly label: string;
      readonly hint: string;
      readonly snippet: SavedSnippet;
    }
);

@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogBackdrop, Icon, EngineBadge, TranslatePipe],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
})
export default class CommandPalette implements AfterViewInit {
  readonly connections = input.required<readonly ConnectionSummary[]>();
  readonly nodes = input.required<readonly ExplorerNode[]>();
  readonly snippets = input<readonly SavedSnippet[]>([]);

  /** Las consultas abiertas, para llegar a las que ya no caben en la barra. */
  readonly tabs = input<readonly QueryTab[]>([]);

  /** El mismo estado que usa la barra del editor, resuelto por el workspace. */
  readonly hasConnection = input(false);
  readonly running = input(false);
  readonly transactionOpen = input(false);
  readonly transactionBusy = input(false);
  readonly hasSelection = input(false);

  private readonly activeTab = computed(() => this.tabs().find((tab) => tab.active));

  readonly closed = output<void>();
  readonly newConnection = output<void>();
  readonly newQuery = output<void>();
  readonly executeQuery = output<void>();

  /** Ejecutar solo la instrucción del cursor, o la selección si la hay. */
  readonly executeCurrent = output<void>();
  readonly formatQuery = output<void>();
  readonly toggleLineComment = output<void>();

  /** Abrir el buscador del editor; con `true`, el de reemplazar. */
  readonly findInEditor = output<boolean>();
  readonly showHistory = output<void>();

  /** Guardar lo que hay en el editor con este nombre. Vacío, lo pone el shell. */
  readonly saveSnippet = output<string>();
  readonly insertSnippet = output<SavedSnippet>();
  readonly deleteSnippet = output<SavedSnippet>();
  readonly activateConnection = output<string>();
  readonly activateTab = output<string>();
  readonly openNode = output<ExplorerNode>();

  /** Otra pestaña con el mismo SQL, para probar una variante sin perder esta. */
  readonly duplicateTab = output<void>();

  /** Cerrar todas menos la de delante. */
  readonly closeOtherTabs = output<void>();

  /** El nombre calificado de la tabla de la pestaña, al portapapeles. */
  readonly copyQualifiedName = output<void>();

  /** El diagrama de donde se está trabajando. */
  readonly openDiagram = output<void>();

  /** Abrir, confirmar o deshacer la transacción.
   *
   * Desde aquí y sin atajo a propósito: confirmar o deshacer con un dedazo
   * es de las pocas cosas de Druse que no se pueden deshacer.
   */
  readonly transaction = output<'begin' | 'commit' | 'rollback'>();

  /** La hoja con todos los atajos. */
  readonly showShortcuts = output<void>();

  protected readonly query = signal('');
  protected readonly selected = signal(0);

  /**
   * La paleta pidiendo el nombre del fragmento.
   *
   * Se hace aquí y no en un diálogo aparte porque el usuario ya está escribiendo
   * en este campo: abrirle una ventana encima para una línea de texto sería
   * sacarlo del teclado para devolverlo al mismo sitio.
   */
  protected readonly naming = signal(false);

  /** Fragmento que se ha pedido borrar una vez y espera la confirmación. */
  protected readonly confirmingDelete = signal<string | null>(null);
  private readonly _input = viewChild<ElementRef<HTMLInputElement>>('search');
  private _returnFocus: HTMLElement | null = null;
  private readonly _i18n = inject(I18nService);

  protected readonly items = computed<readonly PaletteItem[]>(() => {
    const term = this.query().trim().toLowerCase();
    const commands: PaletteItem[] = [
      { id: 'new-query', kind: 'command', label: 'palette.command.newQuery', hint: 'Ctrl+T' },
      {
        id: 'new-connection',
        kind: 'command',
        label: 'palette.command.newConnection',
        hint: 'palette.command.newConnectionHint',
      },
      { id: 'execute', kind: 'command', label: 'palette.command.execute', hint: 'Ctrl+Enter' },
      {
        id: 'execute-current',
        kind: 'command',
        label: this.hasSelection()
          ? 'palette.command.executeSelection'
          : 'palette.command.executeCurrent',
        hint: 'Ctrl+Shift+Enter',
      },
      { id: 'format', kind: 'command', label: 'palette.command.format', hint: 'Ctrl+Shift+F' },
      {
        id: 'toggle-line-comment',
        kind: 'command',
        label: 'palette.command.toggleComment',
        hint: 'Ctrl+/',
      },
      // El buscador del editor existía y no lo decía nadie.
      { id: 'find', kind: 'command', label: 'palette.command.find', hint: 'Ctrl+F' },
      {
        id: 'replace',
        kind: 'command',
        label: 'palette.command.replace',
        hint: editorShortcutLabel('replace'),
      },
      {
        id: 'history',
        kind: 'command',
        label: 'palette.command.history',
        hint: 'palette.command.historyHint',
      },
      {
        id: 'save-snippet',
        kind: 'command',
        label: 'palette.command.saveSnippet',
        hint: 'palette.command.saveSnippetHint',
      },
      {
        id: 'duplicate-tab',
        kind: 'command',
        label: 'palette.command.duplicateTab',
        hint: 'palette.command.duplicateTabHint',
      },
      {
        id: 'close-other-tabs',
        kind: 'command',
        label: 'palette.command.closeOtherTabs',
        hint: 'palette.command.closeOtherTabsHint',
      },
      {
        id: 'copy-qualified-name',
        kind: 'command',
        label: 'palette.command.copyQualifiedName',
        hint: 'palette.command.copyQualifiedNameHint',
      },
      {
        id: 'diagram',
        kind: 'command',
        label: 'palette.command.diagram',
        hint: 'palette.command.diagramHint',
      },
      {
        id: 'transaction-begin',
        kind: 'command',
        label: 'palette.command.transactionBegin',
        hint: 'palette.command.transactionBeginHint',
      },
      {
        id: 'transaction-commit',
        kind: 'command',
        label: 'palette.command.transactionCommit',
        hint: 'palette.command.transactionCommitHint',
      },
      {
        id: 'transaction-rollback',
        kind: 'command',
        label: 'palette.command.transactionRollback',
        hint: 'palette.command.transactionRollbackHint',
      },
      { id: 'shortcuts', kind: 'command', label: 'palette.command.shortcuts', hint: 'F1' },
    ];
    /*
     * Las pestañas abiertas, delante de todo.
     *
     * En la barra solo caben las que caben, y con doce abiertas la única forma
     * de volver a una era ir pasándolas de una en una. Aquí se busca por su
     * nombre, o por la conexión y la base contra las que trabaja.
     */
    const tabs: PaletteItem[] = this.tabs().map((tab) => {
      const connection = this.connections().find((item) => item.id === tab.connectionId);
      const estado = [
        tab.dirty ? this._i18n.t('palette.tab.unsaved') : '',
        tab.active ? this._i18n.t('palette.tab.front') : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const contexto = connection
        ? `${connection.name} · ${tab.database ?? connection.database}`
        : this._i18n.t('palette.tab.noConnection');

      return {
        id: `tab:${tab.id}`,
        kind: 'tab',
        label: tab.title,
        hint: estado ? `${contexto} · ${estado}` : contexto,
        tab,
      };
    });
    const connections: PaletteItem[] = this.connections().map((connection) => ({
      id: `connection:${connection.id}`,
      kind: 'connection',
      label: connection.name,
      hint: this._i18n.t('palette.connection.hint', {
        database: connection.database,
        state: connection.state,
      }),
      connection,
    }));
    const objects: PaletteItem[] = this.nodes()
      .filter((node) => node.kind === 'table' || node.kind === 'view')
      .map((node) => ({
        id: `object:${node.id}`,
        kind: 'object',
        label: node.label,
        hint: this._i18n.t('palette.object.hint', {
          connection:
            this.connections().find((connection) => connection.id === node.connectionId)?.name ??
            this._i18n.t('palette.object.connection'),
          database: node.source.database ?? '',
          name: `${node.source.schema ? `${node.source.schema}.` : ''}${node.source.name}`,
          kind: node.kind,
        }),
        node,
      }));

    // Delante de las conexiones y las tablas: se guardan para usarlos, y quien
    // los busca sabe cómo se llaman.
    const snippets: PaletteItem[] = this.snippets().map((snippet) => ({
      id: `snippet:${snippet.id}`,
      kind: 'snippet',
      label: snippet.name,
      hint: firstLine(snippet.sql),
      snippet,
    }));

    const all = [
      ...tabs,
      ...commands.map((command) => ({
        ...command,
        // Etiqueta y pista son claves; la pista también puede ser un atajo.
        label: this._i18n.t(command.label),
        hint: command.hint.startsWith('palette.')
          ? this._i18n.t(command.hint)
          : shortcutLabel(command.hint),
        alias: command.label,
        disabledReason: this.commandDisabledReason(command.id),
      })),
      ...snippets,
      ...connections,
      ...objects,
    ];

    const wanted = searchable(term);

    return wanted ? all.filter((item) => searchable(haystack(item)).includes(wanted)) : all;
  });

  private commandDisabledReason(id: string): string | null {
    const tab = this.activeTab();
    const t = (key: string) => this._i18n.t(key);
    const connectionRequired = t('palette.disabled.connection');
    const queryRequired = t('palette.disabled.query');
    const sqlRequired = t('palette.disabled.sql');
    const running = t('palette.disabled.running');
    const transactionBusy = t('palette.disabled.transactionBusy');
    const tableRequired = t('palette.disabled.table');

    switch (id) {
      case 'execute':
      case 'execute-current':
        if (!this.hasConnection()) return connectionRequired;
        if (this.running()) return running;
        if (this.transactionBusy()) return transactionBusy;
        return !tab?.sql.trim() ? sqlRequired : null;
      case 'format':
      case 'save-snippet':
        return !tab?.sql.trim() ? sqlRequired : null;
      case 'toggle-line-comment':
      case 'find':
      case 'replace':
      case 'duplicate-tab':
        return tab ? null : queryRequired;
      case 'close-other-tabs':
        return this.tabs().length > 1 ? null : t('palette.disabled.otherTab');
      case 'copy-qualified-name':
        return tab?.sourceTable ? null : tableRequired;
      case 'diagram':
        if (!tab?.sourceTable || !tab.connectionId) return tableRequired;
        return this.hasConnection() ? null : connectionRequired;
      case 'transaction-begin':
      case 'transaction-commit':
      case 'transaction-rollback':
        if (!this.hasConnection()) return connectionRequired;
        if (this.transactionBusy()) return transactionBusy;
        if (this.running()) return running;
        if (id === 'transaction-begin') {
          return this.transactionOpen() ? t('palette.disabled.transactionOpen') : null;
        }
        return this.transactionOpen() ? null : t('palette.disabled.noTransaction');
      default:
        return null;
    }
  }

  ngAfterViewInit(): void {
    this._returnFocus = document.activeElement as HTMLElement | null;
    queueMicrotask(() => this._input()?.nativeElement.focus());
  }

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (
      event.key === 'Escape' ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();

      // Escapar de «ponle nombre» devuelve a la lista, no cierra la paleta: se
      // vino aquí desde ella y el usuario aún no ha hecho nada.
      if (this.naming() && event.key === 'Escape') {
        this.cancelNaming();

        return;
      }

      this.close();
    }
  }

  /**
   * Qué es cada resultado, dicho en el idioma de la aplicación.
   *
   * Salían los nombres internos —`command`, `connection`, `table`— en una
   * interfaz que está en español de arriba abajo.
   */
  protected kindLabel(item: PaletteItem): string {
    return this._i18n.t('palette.kind', {
      kind: item.kind === 'object' ? item.node.kind : item.kind,
    });
  }

  protected close(): void {
    this.closed.emit();
    queueMicrotask(() => this._returnFocus?.focus());
  }

  closeWithoutRestoringFocus(): void {
    this.closed.emit();
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.selected.set(0);
    this.confirmingDelete.set(null);
  }

  protected move(delta: number): void {
    const length = this.items().length;

    if (length > 0) {
      this.selected.update((current) => (current + delta + length) % length);
      queueMicrotask(() =>
        document
          .getElementById(`palette-option-${this.selected()}`)
          ?.scrollIntoView({ block: 'nearest' }),
      );
    }
  }

  protected run(item = this.items()[this.selected()]): void {
    if (!item) {
      return;
    }

    // La sesión puede perderse mientras la paleta está abierta. Se consulta
    // el estado actual también al activar con ratón, no solo al pintar la fila.
    const current = this.items().find((candidate) => candidate.id === item.id);
    if (!current || current.disabledReason) return;
    item = current;

    if (item.kind === 'command') {
      switch (item.id) {
        case 'new-query':
          this.newQuery.emit();
          break;
        case 'new-connection':
          this.closeWithoutRestoringFocus();
          this.newConnection.emit();
          return;
        case 'execute':
          this.executeQuery.emit();
          break;
        case 'execute-current':
          this.executeCurrent.emit();
          break;
        case 'format':
          this.formatQuery.emit();
          break;
        case 'toggle-line-comment':
          this.toggleLineComment.emit();
          break;
        case 'find':
          // Se cierra sin devolver el foco: lo quiere el buscador del editor.
          this.closeWithoutRestoringFocus();
          this.findInEditor.emit(false);
          break;
        case 'replace':
          this.closeWithoutRestoringFocus();
          this.findInEditor.emit(true);
          break;
        case 'history':
          this.showHistory.emit();
          break;
        case 'save-snippet':
          // No se cierra: hace falta el nombre, y se pide en este mismo campo.
          this.startNaming();
          return;
        case 'duplicate-tab':
          this.duplicateTab.emit();
          break;
        case 'close-other-tabs':
          this.closeOtherTabs.emit();
          break;
        case 'copy-qualified-name':
          this.copyQualifiedName.emit();
          break;
        case 'diagram':
          this.closeWithoutRestoringFocus();
          this.openDiagram.emit();
          return;
        case 'transaction-begin':
          this.transaction.emit('begin');
          break;
        case 'transaction-commit':
          this.transaction.emit('commit');
          break;
        case 'transaction-rollback':
          this.transaction.emit('rollback');
          break;
        case 'shortcuts':
          this.closeWithoutRestoringFocus();
          this.showShortcuts.emit();
          return;
      }
    } else if (item.kind === 'tab') {
      this.activateTab.emit(item.tab.id);
    } else if (item.kind === 'connection') {
      this.activateConnection.emit(item.connection.id);
    } else if (item.kind === 'snippet') {
      // Sin devolver el foco a donde estaba: lo quiere el editor, que es donde
      // acaba de aparecer el texto.
      this.closeWithoutRestoringFocus();
      this.insertSnippet.emit(item.snippet);
      return;
    } else {
      this.openNode.emit(item.node);
    }

    this.close();
  }

  /** Pasa a pedir el nombre, con el campo limpio para escribirlo. */
  private startNaming(): void {
    this.naming.set(true);
    this.query.set('');
    queueMicrotask(() => this._input()?.nativeElement.focus());
  }

  /**
   * Confirma el nombre y guarda.
   *
   * Un nombre vacío también vale: el shell propone uno a partir del propio SQL,
   * porque lo que no puede pasar es que guardar cueste más que volver a escribir
   * la consulta.
   */
  protected confirmName(): void {
    this.saveSnippet.emit(this.query().trim());
    this.naming.set(false);
    this.close();
  }

  protected cancelNaming(): void {
    this.naming.set(false);
    this.query.set('');
    this.selected.set(0);
  }

  /**
   * Borra el fragmento marcado, a la segunda.
   *
   * La primera pulsación pregunta y la segunda borra: no hay deshacer, y un
   * atajo que borra a la primera desde una lista que se recorre con las flechas
   * es un accidente esperando su turno.
   */
  protected requestDelete(): void {
    const item = this.items()[this.selected()];

    if (item?.kind !== 'snippet') {
      return;
    }

    if (this.confirmingDelete() === item.snippet.id) {
      this.confirmingDelete.set(null);
      this.deleteSnippet.emit(item.snippet);

      return;
    }

    this.confirmingDelete.set(item.snippet.id);
  }

  /** El fragmento sobre el que está la selección, si lo es. */
  protected readonly selectedSnippet = computed(() => {
    const item = this.items()[this.selected()];

    return item?.kind === 'snippet' ? item.snippet : null;
  });

  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }

    const palette = event.currentTarget as HTMLElement;
    const focusable = [...palette.querySelectorAll<HTMLElement>('input, button')];
    const first = focusable[0];
    const last = focusable.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}

/**
 * La primera línea con algo escrito, para reconocer el fragmento en la lista.
 *
 * Los comentarios de cabecera se saltan: «-- pedidos del día» explica, pero no
 * distingue un fragmento de otro tan bien como el `SELECT` que viene detrás.
 */
/**
 * El texto para comparar: minúsculas y sin tildes. «conexion» encuentra
 * «Conexión», y quien escribe sin acentos no se queda sin resultados.
 */
function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/**
 * Dónde se busca un resultado. Los comandos llevan además su clave, que está
 * en inglés: quien cambia de idioma sigue encontrando «format» o «history».
 */
function haystack(item: PaletteItem): string {
  const alias = item.kind === 'command' && item.alias ? item.alias.replace(/[.]/g, ' ') : '';

  return `${item.label} ${item.hint} ${alias}`;
}

function firstLine(sql: string): string {
  const line = sql
    .split('\n')
    .map((text) => text.trim())
    .find((text) => text.length > 0 && !text.startsWith('--'));

  if (!line) {
    return 'Fragmento vacío';
  }

  return line.length > 72 ? `${line.slice(0, 72).trimEnd()}…` : line;
}
