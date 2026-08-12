import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { ConnectionDialog } from '../../features/connections/connection-dialog/connection-dialog';
import { ConnectionsSidebar } from '../../features/connections/connections-sidebar/connections-sidebar';
import { EditorTabs } from '../../features/query-editor/editor-tabs/editor-tabs';
import { EditorToolbar } from '../../features/query-editor/editor-toolbar/editor-toolbar';
import { CursorPosition, SqlEditor } from '../../features/query-editor/sql-editor/sql-editor';
import { ResultsPanel } from '../../features/query-results/results-panel/results-panel';
import { ExplorerNode, SessionStatus } from '../../shared/models/workspace';
import { ResizeHandle } from '../../shared/ui/resize-handle/resize-handle';
import { StatusBar } from '../status-bar/status-bar';
import { TopBar } from '../top-bar/top-bar';

/** Límites de arrastre de los paneles, en píxeles. */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;
const RESULTS_MIN = 120;
const RESULTS_MAX = 700;

/** Estado que se muestra mientras no hay ninguna conexión abierta. */
const DISCONNECTED: SessionStatus = {
  connected: false,
  engine: 'postgresql',
  engineVersion: 'Sin conexión',
  database: '—',
  user: '—',
  lastDurationMs: null,
};

/**
 * Ventana principal: compone la barra superior, el panel lateral, el editor,
 * los resultados y la barra de estado.
 *
 * El estado vive en {@link WorkspaceStore}; aquí solo queda lo que es puramente
 * de presentación, como el tamaño de los paneles o si el diálogo está abierto.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TopBar,
    StatusBar,
    ConnectionsSidebar,
    ConnectionDialog,
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
  private readonly _store = inject(WorkspaceStore);

  // --- Tamaños de panel ------------------------------------------------------
  protected readonly sidebarWidth = signal(274);
  protected readonly resultsHeight = signal(322);

  protected readonly sidebarMin = SIDEBAR_MIN;
  protected readonly sidebarMax = SIDEBAR_MAX;
  protected readonly resultsMin = RESULTS_MIN;
  protected readonly resultsMax = RESULTS_MAX;

  // --- Diálogo ---------------------------------------------------------------
  protected readonly dialogOpen = signal(false);

  // --- Estado del área de trabajo -------------------------------------------
  protected readonly connections = this._store.connections;
  protected readonly explorerNodes = this._store.explorerNodes;
  protected readonly tabs = this._store.tabs;
  protected readonly resultSet = this._store.resultSet;
  protected readonly result = this._store.result;
  protected readonly running = this._store.running;
  protected readonly rejection = this._store.rejection;
  protected readonly notice = this._store.notice;

  protected readonly session = computed(() => this._store.session() ?? DISCONNECTED);

  protected readonly sql = computed(() => this._store.activeTab()?.sql ?? '');

  protected readonly hasConnection = computed(() => !!this._store.activeConnection()?.sessionId);

  protected readonly editorContext = computed(() => {
    const session = this._store.session();

    return session ? `${session.database}.public` : 'sin conexión';
  });

  // --- Estado del editor -----------------------------------------------------
  protected readonly cursor = signal<CursorPosition>({ line: 1, column: 1 });
  protected readonly hasSelection = signal(false);

  /** Última selección del editor, para poder ejecutarla sola. */
  private _selectedSql = '';

  // --- Conexiones ------------------------------------------------------------
  protected openDialog(): void {
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    this.dialogOpen.set(false);
  }

  protected toggleConnection(id: string): void {
    this._store.toggleConnection(id);
  }

  protected toggleNode(id: string): void {
    void this._store.toggleNode(id);
  }

  protected refreshNode(id: string): void {
    void this._store.refreshNode(id);
  }

  protected disconnect(id: string): void {
    void this._store.disconnect(id);
  }

  /** Doble clic sobre una tabla: abre una consulta preparada. */
  protected openNode(node: ExplorerNode): void {
    this._store.openSelectFor(node);
  }

  // --- Pestañas --------------------------------------------------------------
  protected selectTab(id: string): void {
    this._store.selectTab(id);
  }

  protected closeTab(id: string): void {
    this._store.closeTab(id);
  }

  protected createTab(): void {
    this._store.createTab();
  }

  // --- Editor ----------------------------------------------------------------
  protected onSqlChange(sql: string): void {
    this._store.updateSql(sql);
  }

  protected onCursorChange(position: CursorPosition): void {
    this.cursor.set(position);
  }

  protected onSelectionChange(selection: { hasSelection: boolean; text: string }): void {
    this.hasSelection.set(selection.hasSelection);
    this._selectedSql = selection.text;
  }

  // --- Ejecución -------------------------------------------------------------
  protected execute(): void {
    void this._store.execute();
  }

  /** Ejecuta solo lo seleccionado, sin alterar el contenido de la pestaña. */
  protected executeSelection(): void {
    void this._store.execute(this._selectedSql);
  }

  protected cancel(): void {
    void this._store.cancel();
  }

  protected confirmDestructive(): void {
    const rejection = this.rejection();

    // Solo se puede confirmar un riesgo, nunca saltarse el modo de solo lectura.
    if (rejection?.reason === 'unconfirmeddestructive') {
      void this._store.confirmAndExecute(this.hasSelection() ? this._selectedSql : undefined);
    }
  }

  protected dismissRejection(): void {
    this._store.dismissRejection();
  }

  protected dismissNotice(): void {
    this._store.dismissNotice();
  }
}
