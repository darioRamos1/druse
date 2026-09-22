import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ConnectionSummary, ExplorerNode } from '../../../shared/models/workspace';
import { EngineBadge } from '../../../shared/ui/engine-badge/engine-badge';
import { Icon, IconName } from '../../../shared/ui/icon/icon';
import {
  Search,
  Segment,
  fold,
  highlight,
  parseSearch,
  scoreMatch,
} from '../../../shared/util/text-match';

/** Sangría por nivel del árbol, en píxeles. Coincide con el mockup. */
const INDENT_STEP = 16;
const INDENT_BASE = 8;

/**
 * Espera antes de rehacer el árbol filtrado, en milisegundos.
 *
 * Lo escrito se pinta al instante; lo que espera es el filtrado, que recorre
 * todo el catálogo. Con esquemas grandes, hacerlo por cada letra se nota.
 */
const FILTER_DELAY = 120;

const NO_NODES: readonly ExplorerNode[] = [];

/** Nodo del árbol con sus hijos, tal y como hace falta para filtrarlo. */
interface Branch {
  readonly node: ExplorerNode;
  readonly children: readonly Branch[];
}

/** Una rama que sobrevive al filtro, con lo que vale su mejor coincidencia. */
interface Hit {
  readonly branch: Branch;
  readonly score: number;
}

/** Nombre calificado del objeto, plegado, para medir «ventas.cli». */
function qualifiedOf(node: ExplorerNode): string {
  return node.source.schema ? `${node.source.schema}.${node.source.name}` : node.source.name;
}

function scoreNode(node: ExplorerNode, search: Search): number {
  if (search.kinds && !search.kinds.has(node.kind)) {
    return 0;
  }

  return scoreMatch(fold(node.label), fold(qualifiedOf(node)), search.parts);
}

/**
 * El aplanado vuelto árbol, aprovechando que viene en preorden.
 *
 * Filtrar sobre la lista plana obligaba a rebuscar los ancestros de cada
 * coincidencia; con los hijos colgando de su padre, una sola pasada basta.
 */
function nest(nodes: readonly ExplorerNode[]): readonly Branch[] {
  const roots: Branch[] = [];
  const stack: { node: ExplorerNode; children: Branch[] }[] = [];

  for (const node of nodes) {
    const branch = { node, children: [] as Branch[] };

    while (stack.length && stack[stack.length - 1].node.depth >= node.depth) {
      stack.pop();
    }

    (stack.length ? stack[stack.length - 1].children : roots).push(branch);
    stack.push(branch);
  }

  return roots;
}

/**
 * Lo que cuelga de una coincidencia, menos las columnas.
 *
 * Quien busca un esquema quiere ver sus tablas; nadie quiere ver de golpe las
 * veinte mil columnas que hay debajo. Una columna sigue apareciendo si coincide
 * ella misma.
 */
function inherit(branches: readonly Branch[]): readonly Branch[] {
  return branches
    .filter((branch) => branch.node.kind !== 'column')
    .map((branch) => ({ node: branch.node, children: inherit(branch.children) }));
}

/** Las ramas que coinciden, con sus ancestros y su contenido. */
function prune(branches: readonly Branch[], search: Search): readonly Hit[] {
  const kept: Hit[] = [];

  for (const branch of branches) {
    const own = scoreNode(branch.node, search);

    if (own > 0) {
      kept.push({ branch: { node: branch.node, children: inherit(branch.children) }, score: own });
      continue;
    }

    const children = prune(branch.children, search);

    if (children.length) {
      // Un contenedor vale lo que su mejor descendiente: así la rama que trae la
      // coincidencia más limpia sube, y las demás quedan debajo sin desaparecer.
      kept.push({
        branch: { node: branch.node, children: children.map((hit) => hit.branch) },
        score: Math.max(...children.map((hit) => hit.score)),
      });
    }
  }

  // `sort` es estable, así que a igual relevancia se conserva el orden del
  // catálogo, que es el alfabético con el que el usuario ya cuenta.
  return kept.sort((a, b) => b.score - a.score);
}

/**
 * El árbol podado, otra vez plano y listo para pintar.
 *
 * Lo que sobrevive al filtro se enseña entero, así que un nodo con hijos
 * visibles se marca abierto aunque su rama estuviera plegada: dibujarle el
 * chevron cerrado encima de sus propios hijos no lo entendería nadie.
 */
function flatten(branches: readonly Branch[], out: ExplorerNode[]): ExplorerNode[] {
  for (const branch of branches) {
    out.push(branch.children.length ? { ...branch.node, expanded: true } : branch.node);
    flatten(branch.children, out);
  }

  return out;
}

/** Icono que corresponde a cada clase de objeto del explorador. */
const KIND_ICONS: Readonly<Record<ExplorerNode['kind'], IconName | null>> = {
  folder: null,
  database: 'database',
  schema: 'schema',
  table: 'table',
  view: 'table',
  function: null,
  procedure: null,
  column: null,
};

/**
 * Barra lateral de conexiones con el explorador de objetos.
 *
 * Recibe el árbol ya aplanado y solo emite intenciones: quién carga los hijos y
 * cuándo es asunto del store.
 */
@Component({
  selector: 'app-connections-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, EngineBadge, TranslatePipe],
  templateUrl: './connections-sidebar.html',
  styleUrl: './connections-sidebar.scss',
})
export class ConnectionsSidebar {
  readonly connections = input.required<readonly ConnectionSummary[]>();
  readonly explorerNodes = input.required<readonly ExplorerNode[]>();

  /**
   * El árbol completo que hay cargado, ramas plegadas incluidas.
   *
   * Solo lo usa el filtro. Vacío, el buscador se conforma con lo visible, que es
   * lo que hacía antes.
   */
  readonly catalogNodes = input<readonly ExplorerNode[]>([]);
  readonly version = input('');

  readonly addConnection = output<void>();
  readonly toggleConnection = output<string>();
  readonly connectSaved = output<string>();
  readonly toggleNode = output<string>();
  readonly refreshNode = output<string>();
  readonly disconnect = output<string>();
  /** Cerrar la sesión y volver a abrirla, conservando las pestañas. */
  readonly reconnect = output<string>();
  readonly forget = output<string>();
  /** Abrir el formulario con los datos de esta conexión guardada. */
  readonly edit = output<string>();
  readonly openNode = output<ExplorerNode>();
  /** Componer una consulta sobre esta tabla o vista. */
  readonly composeQuery = output<ExplorerNode>();
  readonly definition = output<ExplorerNode>();
  readonly runProcedure = output<ExplorerNode>();

  /** Crear una tabla dentro de este esquema. */
  readonly createTable = output<ExplorerNode>();

  /** Cambiar la estructura de esta tabla. */
  readonly designTable = output<ExplorerNode>();

  /** Importar un archivo dentro de esta tabla. */
  readonly importInto = output<ExplorerNode>();

  /**
   * Copiar las filas de esta tabla a otra.
   *
   * Solo sobre una tabla: el traslado va de una tabla a otra, y ofrecerlo sobre
   * una base haría creer que se copia entera.
   */
  readonly transferFrom = output<ExplorerNode>();

  /** Varias tablas de un esquema o carpeta, en una pasada. */
  readonly transferTablesFrom = output<ExplorerNode>();

  /**
   * Respaldar lo que cuelga de este nodo.
   *
   * Se ofrece sobre la base, el esquema y la tabla porque son los tres sitios
   * desde los que se piensa «me llevo esto»: el asistente resuelve solo qué
   * tablas hay debajo.
   */
  readonly backup = output<ExplorerNode>();

  /**
   * Dibujar el diagrama de lo que cuelga de este nodo.
   *
   * Sobre un esquema entran sus tablas; sobre una tabla, ella y las que la
   * rodean. Sobre la base entera no se ofrece: serían trescientas cajas y una
   * espera, y para eso está el selector.
   */
  readonly diagram = output<ExplorerNode>();

  /**
   * Aplicar un respaldo sobre esta base.
   *
   * Solo se ofrece sobre la base y no sobre un esquema o una tabla: un artefacto
   * trae sus propios esquemas dentro, y abrirlo desde un nodo más hondo sugeriría
   * que se restaura «ahí», que es justo lo que no pasa.
   */
  readonly restore = output<ExplorerNode>();
  readonly copied = output<string>();
  readonly copyFailed = output<void>();

  /**
   * Un clic sobre una conexión guardada y desconectada la abre; sobre una ya
   * conectada, solo pliega o despliega su árbol.
   */
  protected activate(connection: ConnectionSummary): void {
    if (connection.state === 'disconnected' && connection.saved) {
      this.connectSaved.emit(connection.id);
      return;
    }

    this.toggleConnection.emit(connection.id);
  }

  protected statusLabel(connection: ConnectionSummary): string {
    switch (connection.state) {
      case 'connected':
        return this._i18n.t('sidebar.status.connected');
      case 'connecting':
        return this._i18n.t('sidebar.status.connecting');
      case 'error':
        return this._i18n.t('sidebar.status.error');
      default:
        return this._i18n.t('sidebar.status.off');
    }
  }

  protected readonly activeCount = computed(
    () => this.connections().filter((connection) => connection.state === 'connected').length,
  );

  /** Lo que hay escrito en el campo, que se pinta sin esperar a nada. */
  protected readonly typed = signal('');

  /** Término ya asentado con el que se filtra de verdad. */
  protected readonly filter = signal('');
  protected readonly openMenuId = signal<string | null>(null);
  protected readonly menuPosition = signal({ top: 0, left: 0 });
  protected readonly focusedId = signal<string | null>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private menuTrigger: HTMLElement | null = null;

  /** Un punto de entrada al árbol; las flechas recorren solo las filas visibles. */
  protected readonly treeRows = computed(() =>
    this.visibleConnections().flatMap((connection) => [
      { id: connection.id, level: 1, connection, node: null as ExplorerNode | null },
      ...(connection.expanded ? this.nodesOf(connection.id) : []).map((node) => ({
        id: node.id,
        level: node.depth + 1,
        connection,
        node,
      })),
    ]),
  );
  protected readonly tabStop = computed(() => {
    const rows = this.treeRows();
    return rows.some((row) => row.id === this.focusedId())
      ? this.focusedId()
      : (rows[0]?.id ?? null);
  });
  protected readonly treePositions = computed(() => {
    const stack: { id: string; level: number }[] = [];
    const siblings = new Map<string, string[]>();
    for (const row of this.treeRows()) {
      while (stack.length && stack[stack.length - 1].level >= row.level) stack.pop();
      const parent = stack[stack.length - 1]?.id ?? '';
      const group = siblings.get(parent) ?? [];
      group.push(row.id);
      siblings.set(parent, group);
      stack.push(row);
    }
    const positions = new Map<string, { index: number; count: number }>();
    for (const group of siblings.values()) {
      group.forEach((id, index) => positions.set(id, { index: index + 1, count: group.length }));
    }
    return positions;
  });

  protected readonly search = computed(() => parseSearch(this.filter()));

  private readonly _filterInput = viewChild<ElementRef<HTMLInputElement>>('filterInput');
  private readonly _i18n = inject(I18nService);
  private _pending: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelPending());
  }

  /**
   * Objetos de cada conexión, ya filtrados, por identificador de conexión.
   *
   * Es un `computed` y no un método porque la plantilla lo pide una vez por
   * conexión en cada ciclo de detección: recorrer el catálogo entero cada vez
   * era el precio de teclear en el campo.
   */
  protected readonly filteredNodes = computed<ReadonlyMap<string, readonly ExplorerNode[]>>(() => {
    const search = this.search();

    // Con filtro se mira el catálogo entero, plegado incluido; sin filtro, solo
    // lo que el árbol ya enseña, que es su estado de expansión real.
    const source =
      search && this.catalogNodes().length ? this.catalogNodes() : this.explorerNodes();
    const byConnection = new Map<string, ExplorerNode[]>();

    for (const node of source) {
      const nodes = byConnection.get(node.connectionId);

      if (nodes) {
        nodes.push(node);
      } else {
        byConnection.set(node.connectionId, [node]);
      }
    }

    if (!search) {
      return byConnection;
    }

    const filtered = new Map<string, readonly ExplorerNode[]>();

    for (const [connectionId, nodes] of byConnection) {
      const kept = flatten(
        prune(nest(nodes), search).map((hit) => hit.branch),
        [],
      );

      if (kept.length) {
        filtered.set(connectionId, kept);
      }
    }

    return filtered;
  });

  /** Cuántos objetos ha dejado el filtro, para decirlo bajo el campo. */
  protected readonly matchCount = computed(() =>
    [...this.filteredNodes().values()].reduce((total, nodes) => total + nodes.length, 0),
  );

  /** Trozos subrayados de cada nombre, por nodo, mientras haya filtro. */
  protected readonly labelSegments = computed<ReadonlyMap<string, readonly Segment[]>>(() => {
    const search = this.search();
    const segments = new Map<string, readonly Segment[]>();

    if (!search?.parts.length) {
      return segments;
    }

    for (const nodes of this.filteredNodes().values()) {
      for (const node of nodes) {
        segments.set(node.id, highlight(node.label, search.parts));
      }
    }

    return segments;
  });

  protected readonly visibleConnections = computed(() => {
    const search = this.search();

    if (!search) {
      return this.connections();
    }

    const filtered = this.filteredNodes();

    // Una conexión se queda si coincide ella o alguno de sus objetos: al buscar
    // una tabla, esconder su conexión dejaría el resultado inalcanzable. Y si lo
    // que coincide está dentro, se abre: anunciarla plegada y vacía era peor que
    // no encontrar nada.
    return this.connections()
      .filter((connection) => {
        if (filtered.get(connection.id)?.length) {
          return true;
        }

        // Pedir una clase —«t:ventas»— es preguntar por objetos, no por
        // conexiones: entonces la conexión solo entra si algo suyo coincide.
        if (search.kinds) {
          return false;
        }

        // Se mide contra el nombre del perfil y contra el de su base por
        // separado, que son los dos por los que se la reconoce.
        const nombre = fold(connection.name);
        const base = fold(connection.database);

        return (
          scoreMatch(nombre, nombre, search.parts) > 0 || scoreMatch(base, base, search.parts) > 0
        );
      })
      .map((connection) =>
        filtered.get(connection.id)?.length ? { ...connection, expanded: true } : connection,
      );
  });

  protected onFilter(event: Event): void {
    const value = (event.target as HTMLInputElement).value;

    this.typed.set(value);
    this.cancelPending();

    // Vaciar el campo tiene que devolver el árbol al instante: la espera solo
    // sirve mientras se teclea.
    if (!value.trim()) {
      this.filter.set(value);

      return;
    }

    this._pending = setTimeout(() => this.filter.set(value), FILTER_DELAY);
  }

  protected clearFilter(): void {
    this.cancelPending();
    this.typed.set('');
    this.filter.set('');
    this._filterInput()?.nativeElement.focus();
  }

  /** El shell revela el panel antes de llevar el foco a su filtro. */
  focusFilter(): void {
    const input = this._filterInput()?.nativeElement;
    input?.focus();
    input?.select();
  }

  private cancelPending(): void {
    if (this._pending) {
      clearTimeout(this._pending);
      this._pending = null;
    }
  }

  /** Nodos de cada conexión, para pintarlos bajo la suya. */
  protected nodesOf(connectionId: string): readonly ExplorerNode[] {
    return this.filteredNodes().get(connectionId) ?? NO_NODES;
  }

  /** Trozos del nombre para subrayar la coincidencia, o `null` si no hay filtro. */
  protected segmentsOf(nodeId: string): readonly Segment[] | null {
    return this.labelSegments().get(nodeId) ?? null;
  }

  /** Nombre calificado del objeto, listo para pegar en una consulta. */
  protected qualifiedName(node: ExplorerNode): string {
    return node.source.schema ? `${node.source.schema}.${node.source.name}` : node.source.name;
  }

  protected async copyName(event: Event, node: ExplorerNode): Promise<void> {
    event.stopPropagation();
    this.dismissMenu();

    try {
      await navigator.clipboard.writeText(this.qualifiedName(node));
      this.copied.emit(this.qualifiedName(node));
    } catch {
      // El portapapeles puede estar bloqueado por permisos del navegador.
      this.copyFailed.emit();
    }
  }

  protected indentFor(node: ExplorerNode): number {
    return INDENT_BASE + node.depth * INDENT_STEP;
  }

  protected iconFor(node: ExplorerNode): IconName | null {
    return KIND_ICONS[node.kind];
  }

  protected toggleMenu(event: Event, nodeId: string): void {
    event.stopPropagation();
    if (this.openMenuId() === nodeId) {
      this.dismissMenu();
      return;
    }
    this.showMenu(event.currentTarget as HTMLElement, nodeId);
  }

  private showMenu(trigger: HTMLElement, nodeId: string, last = false): void {
    this.menuTrigger = trigger;
    this.focusedId.set(nodeId);
    this.openMenuId.set(nodeId);
    afterNextRender(
      () => {
        if (this.openMenuId() !== nodeId) return;
        const menu = trigger.parentElement?.querySelector<HTMLElement>('[role="menu"]');
        if (!menu) return;
        const rect = trigger.getBoundingClientRect();
        const scale = rect.width / trigger.offsetWidth || 1;
        const height = menu.getBoundingClientRect().height;
        const top =
          rect.bottom + height + 3 <= window.innerHeight - 8
            ? rect.bottom + 3
            : Math.max(8 * scale, rect.top - height - 3);
        this.menuPosition.set({
          top: top / scale,
          left: Math.max(
            8,
            Math.min(
              rect.right / scale - menu.offsetWidth,
              window.innerWidth / scale - menu.offsetWidth - 8,
            ),
          ),
        });
        const items = menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        items[last ? items.length - 1 : 0]?.focus();
      },
      { injector: this.injector },
    );
  }

  protected onMenuTriggerKeydown(event: KeyboardEvent, id: string): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.showMenu(event.currentTarget as HTMLElement, id, event.key === 'ArrowUp');
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.dismissMenu();
    }
  }

  protected onTreeKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (
      target.getAttribute('role') !== 'treeitem' ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const rows = this.treeRows();
    const index = rows.findIndex((row) => row.id === target.dataset['treeId']);
    const row = rows[index];
    if (!row) return;
    const focus = (next: number) => {
      const id = rows[next]?.id;
      if (!id) return;
      this.focusedId.set(id);
      Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[role="treeitem"]'))
        .find((item) => item.dataset['treeId'] === id)
        ?.focus();
    };
    const expanded = row.node ? row.node.expanded : row.connection.expanded;
    const expandable = row.node ? row.node.expandable : row.connection.state === 'connected';
    const toggle = () =>
      row.node ? this.toggleNode.emit(row.id) : this.toggleConnection.emit(row.id);
    switch (event.key) {
      case 'ArrowDown':
        focus(Math.min(rows.length - 1, index + 1));
        break;
      case 'ArrowUp':
        focus(Math.max(0, index - 1));
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(rows.length - 1);
        break;
      case 'ArrowRight':
        if (expandable && !expanded) toggle();
        else if (expanded && rows[index + 1]?.level > row.level) focus(index + 1);
        break;
      case 'ArrowLeft':
        if (expandable && expanded && !this.search()) toggle();
        else {
          for (let parent = index - 1; parent >= 0; parent--) {
            if (rows[parent].level < row.level) {
              focus(parent);
              break;
            }
          }
        }
        break;
      case 'Enter':
        if (!row.node) this.activate(row.connection);
        else if (row.node.kind === 'table' || row.node.kind === 'view')
          this.openNode.emit(row.node);
        else this.toggleNode.emit(row.id);
        break;
      case ' ':
        if (row.node) toggle();
        else this.activate(row.connection);
        break;
      case 'F10':
        if (!event.shiftKey) return;
        this.openRowMenu(target, row.id);
        break;
      case 'ContextMenu':
        this.openRowMenu(target, row.id);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  private openRowMenu(row: HTMLElement, id: string): void {
    const trigger = row.querySelector<HTMLElement>('[data-menu-trigger]');
    if (trigger) this.showMenu(trigger, id);
  }

  private dismissMenu(restoreFocus = true): void {
    this.openMenuId.set(null);
    if (restoreFocus && this.menuTrigger?.isConnected) this.menuTrigger.focus();
  }

  @HostListener('document:pointerdown', ['$event'])
  protected outsideMenu(event: Event): void {
    if (
      this.openMenuId() &&
      event.target instanceof Node &&
      !this.menuTrigger?.parentElement?.contains(event.target)
    ) {
      this.dismissMenu(false);
    }
  }

  protected stopMenuKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismissMenu();
      return;
    }
    const items = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ),
    );
    const index = items.indexOf(event.target as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % items.length;
        break;
      case 'ArrowUp':
        next = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  protected closeMenu(event: FocusEvent, nodeId: string): void {
    const next = event.relatedTarget as Node | null;
    const current = event.currentTarget as HTMLElement;

    if (!next || !current.contains(next)) {
      this.openMenuId.update((open) => (open === nodeId ? null : open));
    }
  }

  /** Evita que el botón de una acción propague el clic al nodo. */
  protected act(event: Event, action: () => void): void {
    event.stopPropagation();
    this.dismissMenu();
    action();
  }
}
