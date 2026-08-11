import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ConnectionSummary, ExplorerNode } from '../../../shared/models/workspace';
import { EngineBadge } from '../../../shared/ui/engine-badge/engine-badge';
import { Icon, IconName } from '../../../shared/ui/icon/icon';

/** Sangría por nivel del árbol, en píxeles. Coincide con el mockup. */
const INDENT_STEP = 16;
const INDENT_BASE = 8;

/** Icono que corresponde a cada clase de objeto del explorador. */
const KIND_ICONS: Readonly<Record<ExplorerNode['kind'], IconName | null>> = {
  folder: null,
  database: null,
  schema: null,
  table: 'table',
  view: 'table',
  function: null,
  procedure: null,
};

/**
 * Barra lateral de conexiones con el explorador de objetos.
 *
 * En la Fase 1 recibe el árbol ya aplanado y no carga nada: la carga perezosa
 * por nodo llega en la Fase 2.
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
  readonly refresh = output<void>();
  readonly toggleConnection = output<string>();
  readonly toggleNode = output<string>();

  protected readonly activeCount = computed(
    () => this.connections().filter((connection) => connection.state === 'connected').length,
  );

  protected indentFor(node: ExplorerNode): number {
    return INDENT_BASE + node.depth * INDENT_STEP;
  }

  protected iconFor(node: ExplorerNode): IconName | null {
    return KIND_ICONS[node.kind];
  }
}
