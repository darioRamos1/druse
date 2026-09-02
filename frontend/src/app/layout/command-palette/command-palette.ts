import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
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

type PaletteItem =
  | { readonly id: string; readonly kind: 'command'; readonly label: string; readonly hint: string }
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
    };

@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, EngineBadge],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
})
export default class CommandPalette implements AfterViewInit {
  readonly connections = input.required<readonly ConnectionSummary[]>();
  readonly nodes = input.required<readonly ExplorerNode[]>();
  readonly snippets = input<readonly SavedSnippet[]>([]);

  /** Las consultas abiertas, para llegar a las que ya no caben en la barra. */
  readonly tabs = input<readonly QueryTab[]>([]);

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

  protected readonly items = computed<readonly PaletteItem[]>(() => {
    const term = this.query().trim().toLowerCase();
    const commands: PaletteItem[] = [
      { id: 'new-query', kind: 'command', label: 'Nueva consulta', hint: 'Ctrl+T' },
      { id: 'new-connection', kind: 'command', label: 'Nueva conexión', hint: 'Crear perfil' },
      { id: 'execute', kind: 'command', label: 'Ejecutar consulta activa', hint: 'Ctrl+Enter' },
      {
        id: 'execute-current',
        kind: 'command',
        label: 'Ejecutar instrucción actual',
        hint: 'Ctrl+Shift+Enter',
      },
      { id: 'format', kind: 'command', label: 'Formatear SQL', hint: 'Ctrl+Shift+F' },
      {
        id: 'toggle-line-comment',
        kind: 'command',
        label: 'Comentar/descomentar líneas',
        hint: 'Ctrl+/',
      },
      // El buscador del editor existía y no lo decía nadie.
      { id: 'find', kind: 'command', label: 'Buscar en el editor', hint: 'Ctrl+F' },
      { id: 'replace', kind: 'command', label: 'Buscar y reemplazar', hint: 'Ctrl+H' },
      { id: 'history', kind: 'command', label: 'Abrir historial', hint: 'Consultas anteriores' },
      {
        id: 'save-snippet',
        kind: 'command',
        label: 'Guardar como fragmento',
        hint: 'Lo seleccionado, o la instrucción del cursor',
      },
      { id: 'duplicate-tab', kind: 'command', label: 'Duplicar la pestaña', hint: 'Con el mismo SQL' },
      {
        id: 'close-other-tabs',
        kind: 'command',
        label: 'Cerrar las demás pestañas',
        hint: 'Se preguntará por las que tengan cambios',
      },
      {
        id: 'copy-qualified-name',
        kind: 'command',
        label: 'Copiar el nombre calificado',
        hint: 'De la tabla de esta pestaña',
      },
      { id: 'diagram', kind: 'command', label: 'Ver el diagrama', hint: 'De donde se está trabajando' },
      { id: 'transaction-begin', kind: 'command', label: 'Iniciar transacción', hint: 'Nada se escribe hasta confirmar' },
      { id: 'transaction-commit', kind: 'command', label: 'Confirmar la transacción', hint: 'Escribe los cambios. No se deshace' },
      { id: 'transaction-rollback', kind: 'command', label: 'Deshacer la transacción', hint: 'Tira lo hecho desde que se abrió' },
      { id: 'shortcuts', kind: 'command', label: 'Ver los atajos de teclado', hint: 'F1' },
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
      const estado = [tab.dirty ? 'sin guardar' : '', tab.active ? 'delante' : '']
        .filter(Boolean)
        .join(' · ');
      const contexto = connection
        ? `${connection.name} · ${tab.database ?? connection.database}`
        : 'Sin conexión asignada';

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
      hint: `${connection.database} · ${connection.state === 'connected' ? 'conectada' : 'sin conexión'}`,
      connection,
    }));
    const objects: PaletteItem[] = this.nodes()
      .filter((node) => node.kind === 'table' || node.kind === 'view')
      .map((node) => ({
        id: `object:${node.id}`,
        kind: 'object',
        label: node.label,
        hint: `${this.connections().find((connection) => connection.id === node.connectionId)?.name ?? 'Conexión'} · ${node.source.database ?? ''} · ${node.source.schema ? `${node.source.schema}.` : ''}${node.source.name} · ${node.kind === 'view' ? 'vista' : 'tabla'}`,
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

    const all = [...tabs, ...commands, ...snippets, ...connections, ...objects];

    return term
      ? all.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(term))
      : all;
  });

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
    const nombre = item.kind === 'object' ? item.node.kind : item.kind;

    if (nombre === 'snippet') {
      return 'fragmento';
    }

    if (nombre === 'tab') {
      return 'pestaña';
    }


    switch (nombre) {
      case 'command':
        return 'comando';
      case 'connection':
        return 'conexión';
      case 'database':
        return 'base';
      case 'schema':
        return 'esquema';
      case 'folder':
        return 'carpeta';
      case 'table':
        return 'tabla';
      case 'view':
        return 'vista';
      case 'function':
        return 'función';
      case 'procedure':
        return 'procedimiento';
      case 'column':
        return 'columna';
      default:
        return nombre;
    }
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
