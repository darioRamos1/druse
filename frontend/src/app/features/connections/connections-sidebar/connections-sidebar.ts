import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { ConnectionSummary, ExplorerNode } from '../../../shared/models/workspace';
import { EngineBadge } from '../../../shared/ui/engine-badge/engine-badge';
import { Icon, IconName } from '../../../shared/ui/icon/icon';

/** Sangría por nivel del árbol, en píxeles. Coincide con el mockup. */
const INDENT_STEP = 16;
const INDENT_BASE = 8;

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
  imports: [Icon, EngineBadge],
  templateUrl: './connections-sidebar.html',
  styleUrl: './connections-sidebar.scss',
})
export class ConnectionsSidebar {
  readonly connections = input.required<readonly ConnectionSummary[]>();
  readonly explorerNodes = input.required<readonly ExplorerNode[]>();

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

  /** Crear una tabla dentro de este esquema. */
  readonly createTable = output<ExplorerNode>();

  /** Cambiar la estructura de esta tabla. */
  readonly designTable = output<ExplorerNode>();

  /** Importar un archivo dentro de esta tabla. */
  readonly importInto = output<ExplorerNode>();
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
        return 'Conectado';
      case 'connecting':
        return 'Conectando…';
      case 'error':
        return 'Error de conexión';
      default:
        return 'Sin conexión. Haz clic para conectar.';
    }
  }

  protected readonly activeCount = computed(
    () => this.connections().filter((connection) => connection.state === 'connected').length,
  );

  /** Término por el que se filtran conexiones y objetos. */
  protected readonly filter = signal('');
  protected readonly openMenuId = signal<string | null>(null);
  protected readonly menuPosition = signal({ top: 0, left: 0 });

  protected readonly visibleConnections = computed(() => {
    const term = this.filter().trim().toLowerCase();

    if (!term) {
      return this.connections();
    }

    // Una conexión se queda si coincide ella o alguno de sus objetos: al buscar
    // una tabla, esconder su conexión dejaría el resultado inalcanzable.
    return this.connections().filter(
      (connection) =>
        connection.name.toLowerCase().includes(term) ||
        connection.database.toLowerCase().includes(term) ||
        this.explorerNodes().some(
          (node) => node.connectionId === connection.id && node.label.toLowerCase().includes(term),
        ),
    );
  });

  protected onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  /** Nodos de cada conexión, para pintarlos bajo la suya. */
  protected nodesOf(connectionId: string): readonly ExplorerNode[] {
    const nodes = this.explorerNodes().filter((node) => node.connectionId === connectionId);
    const term = this.filter().trim().toLowerCase();

    if (!term) {
      return nodes;
    }

    // Con filtro se muestran las coincidencias y sus ancestros: una tabla suelta
    // sin su esquema encima no diría de dónde sale.
    const keep = new Set<string>();

    nodes.forEach((node, index) => {
      if (!node.label.toLowerCase().includes(term)) {
        return;
      }

      keep.add(node.id);

      let depth = node.depth;

      for (let i = index - 1; i >= 0 && depth > 0; i--) {
        if (nodes[i].depth < depth) {
          keep.add(nodes[i].id);
          depth = nodes[i].depth;
        }
      }
    });

    return nodes.filter((node) => keep.has(node.id));
  }

  /** Nombre calificado del objeto, listo para pegar en una consulta. */
  protected qualifiedName(node: ExplorerNode): string {
    return node.source.schema ? `${node.source.schema}.${node.source.name}` : node.source.name;
  }

  protected async copyName(event: Event, node: ExplorerNode): Promise<void> {
    event.stopPropagation();
    this.openMenuId.set(null);

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
    const current = this.openMenuId();

    if (current === nodeId) {
      this.openMenuId.set(null);
      return;
    }

    const trigger = event.currentTarget as HTMLElement;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = 190;
    const top =
      rect.bottom + menuHeight <= window.innerHeight - 8
        ? rect.bottom + 3
        : Math.max(8, rect.top - menuHeight - 3);

    this.menuPosition.set({ top, left: Math.max(8, rect.right - 190) });
    this.openMenuId.set(nodeId);
  }

  protected onNodeKeydown(event: KeyboardEvent, nodeId: string): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleNode.emit(nodeId);
    }
  }

  protected stopMenuKeydown(event: KeyboardEvent): void {
    event.stopPropagation();

    if (event.key === 'Escape') {
      this.openMenuId.set(null);
      ((event.currentTarget as HTMLElement).closest('.node') as HTMLElement | null)?.focus();
    }
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
    this.openMenuId.set(null);
    action();
  }
}
