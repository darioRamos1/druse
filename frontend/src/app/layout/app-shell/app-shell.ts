import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { ConnectionsSidebar } from '../../features/connections/connections-sidebar/connections-sidebar';
import { EditorTabs } from '../../features/query-editor/editor-tabs/editor-tabs';
import { EditorToolbar } from '../../features/query-editor/editor-toolbar/editor-toolbar';
import { CursorPosition, SqlEditor } from '../../features/query-editor/sql-editor/sql-editor';
import { ResultsPanel } from '../../features/query-results/results-panel/results-panel';
import {
  MOCK_CONNECTIONS,
  MOCK_EXPLORER_NODES,
  MOCK_RESULT_SET,
  MOCK_SESSION,
  MOCK_SQL,
  MOCK_TABS,
} from '../../shared/mock/mock-workspace';
import { QueryTab } from '../../shared/models/workspace';
import { ResizeHandle } from '../../shared/ui/resize-handle/resize-handle';
import { StatusBar } from '../status-bar/status-bar';
import { TopBar } from '../top-bar/top-bar';

/** Límites de arrastre de los paneles, en píxeles. */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
const RESULTS_MIN = 120;
const RESULTS_MAX = 700;

/**
 * Ventana principal: compone la barra superior, el panel lateral, el editor,
 * los resultados y la barra de estado.
 *
 * Sostiene el estado del shell con Signals. En la Fase 2 este estado pasará a
 * servicios por funcionalidad; aquí vive junto porque todavía es de presentación
 * y no tiene reglas.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TopBar,
    StatusBar,
    ConnectionsSidebar,
    EditorTabs,
    EditorToolbar,
    SqlEditor,
    ResultsPanel,
    ResizeHandle,
  ],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  // --- Tamaños de panel ------------------------------------------------------
  protected readonly sidebarWidth = signal(274);
  protected readonly resultsHeight = signal(322);

  protected readonly sidebarMin = SIDEBAR_MIN;
  protected readonly sidebarMax = SIDEBAR_MAX;
  protected readonly resultsMin = RESULTS_MIN;
  protected readonly resultsMax = RESULTS_MAX;

  // --- Contenido simulado ----------------------------------------------------
  protected readonly connections = signal(MOCK_CONNECTIONS);
  protected readonly explorerNodes = signal(MOCK_EXPLORER_NODES);
  protected readonly tabs = signal<readonly QueryTab[]>(MOCK_TABS);
  protected readonly sql = signal(MOCK_SQL);
  protected readonly resultSet = signal(MOCK_RESULT_SET);
  protected readonly session = signal(MOCK_SESSION);

  // --- Estado del editor -----------------------------------------------------
  protected readonly cursor = signal<CursorPosition>({ line: 1, column: 1 });
  protected readonly hasSelection = signal(false);
  protected readonly running = signal(false);

  protected readonly editorContext = computed(
    () => `${this.session().database}.public`,
  );

  private _nextTab = MOCK_TABS.length + 1;

  // --- Conexiones ------------------------------------------------------------
  protected toggleConnection(id: string): void {
    this.connections.update((connections) =>
      connections.map((connection) =>
        connection.id === id ? { ...connection, expanded: !connection.expanded } : connection,
      ),
    );
  }

  protected toggleNode(id: string): void {
    this.explorerNodes.update((nodes) =>
      nodes.map((node) =>
        node.id === id && node.expandable ? { ...node, expanded: !node.expanded } : node,
      ),
    );
  }

  // --- Pestañas --------------------------------------------------------------
  protected selectTab(id: string): void {
    this.tabs.update((tabs) => tabs.map((tab) => ({ ...tab, active: tab.id === id })));
  }

  protected closeTab(id: string): void {
    this.tabs.update((tabs) => {
      const remaining = tabs.filter((tab) => tab.id !== id);

      // Al cerrar la pestaña activa, la primera que quede toma el relevo.
      if (remaining.length > 0 && !remaining.some((tab) => tab.active)) {
        return remaining.map((tab, index) => ({ ...tab, active: index === 0 }));
      }

      return remaining;
    });
  }

  protected createTab(): void {
    const tab: QueryTab = {
      id: `q${this._nextTab++}`,
      title: `Query ${this._nextTab - 1}`,
      active: true,
      dirty: false,
    };

    this.tabs.update((tabs) => [...tabs.map((t) => ({ ...t, active: false })), tab]);
  }

  // --- Editor ----------------------------------------------------------------
  protected onCursorChange(position: CursorPosition): void {
    this.cursor.set(position);
  }

  protected onExecute(): void {
    // La ejecución real llega en la Fase 2. Aquí solo se refleja el estado
    // para poder ver cómo se comporta la barra de acciones.
    this.running.set(true);
    setTimeout(() => this.running.set(false), 600);
  }
}
