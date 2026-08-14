import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { ExportFormat } from '../../core/application-gateway/application-gateway';
import { FormatSettings } from '../../core/workspace/format-settings';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { SqlFileService } from '../../core/sql-files/sql-file.service';
import { ConnectionDialog } from '../../features/connections/connection-dialog/connection-dialog';
import { ConnectionsSidebar } from '../../features/connections/connections-sidebar/connections-sidebar';
import { EditorTabs } from '../../features/query-editor/editor-tabs/editor-tabs';
import { EditorToolbar } from '../../features/query-editor/editor-toolbar/editor-toolbar';
import {
  CursorPosition,
  EditorSelection,
  ExecutionErrorContext,
} from '../../features/query-editor/sql-editor/sql-editor';
import SqlEditor from '../../features/query-editor/sql-editor/sql-editor';
import { ImportDialog } from '../../features/import/import-dialog/import-dialog';
import { TableDesigner } from '../../features/tables/table-designer/table-designer';
import { QueryBuilder } from '../../features/query-builder/query-builder/query-builder';
import { buildSelect } from '../../features/query-editor/sql-language/sql-writer';
import { ResultsPanel } from '../../features/query-results/results-panel/results-panel';
import {
  CellEdit,
  DatabaseEngine,
  DatabaseObject,
  ExplorerNode,
  KnownColumn,
  QueryHistoryEntry,
  SavedConnection,
  SessionStatus,
} from '../../shared/models/workspace';
import { ResizeHandle } from '../../shared/ui/resize-handle/resize-handle';
import { StatusBar } from '../status-bar/status-bar';
import { TopBar } from '../top-bar/top-bar';
import CommandPalette from '../command-palette/command-palette';

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
    ImportDialog,
    TableDesigner,
    QueryBuilder,
    CommandPalette,
    ResizeHandle,
  ],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  private readonly _store = inject(WorkspaceStore);
  private readonly _sqlFiles = inject(SqlFileService);

  // --- Tamaños de panel ------------------------------------------------------
  protected readonly sidebarWidth = signal(274);
  protected readonly mobileExplorerOpen = signal(false);
  protected readonly resultsHeight = signal(322);

  protected readonly sidebarMin = SIDEBAR_MIN;
  protected readonly sidebarMax = SIDEBAR_MAX;
  protected readonly resultsMin = RESULTS_MIN;
  protected readonly resultsMax = RESULTS_MAX;

  // --- Diálogo ---------------------------------------------------------------
  protected readonly dialogOpen = signal(false);

  /** Perfil que se está editando; `null` cuando el diálogo crea uno nuevo. */
  protected readonly editingConnection = signal<SavedConnection | null>(null);
  protected readonly paletteOpen = signal(false);

  @HostListener('document:keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      if (this.paletteOpen()) {
        return;
      }
      if (
        this.dialogOpen() ||
        this.importTarget() ||
        this.builderTarget() ||
        this.designTarget()
      ) {
        return;
      }
      event.preventDefault();
      this.paletteOpen.set(true);
    } else if (event.key === 'Escape' && this.paletteOpen()) {
      this.paletteOpen.set(false);
    }
  }

  /** Tabla a la que se está importando, si el diálogo está abierto. */
  protected readonly importTarget = signal<ExplorerNode | null>(null);

  protected openImport(node: ExplorerNode): void {
    this.importTarget.set(node);
  }

  protected closeImport(): void {
    this.importTarget.set(null);
  }

  /**
   * Nodo sobre el que está abierto el diseñador de tablas.
   *
   * Un esquema significa crear; una tabla, modificarla. El propio diseñador
   * distingue por la clase del nodo.
   */
  protected readonly designTarget = signal<ExplorerNode | null>(null);

  protected openTableDesigner(node: ExplorerNode): void {
    this.designTarget.set(node);
  }

  protected closeTableDesigner(): void {
    this.designTarget.set(null);
  }

  /** Tabla sobre la que se está componiendo una consulta. */
  protected readonly builderTarget = signal<ExplorerNode | null>(null);

  protected openBuilder(node: ExplorerNode): void {
    this.builderTarget.set(node);
  }

  protected closeBuilder(): void {
    this.builderTarget.set(null);
  }

  /**
   * Lo compuesto va a una pestaña nueva, no encima de la que hubiera.
   *
   * Pisar lo que el usuario tenía a medio escribir sería la peor forma de
   * estrenar una ayuda.
   */
  protected insertComposed(sql: string): void {
    const target = this.builderTarget();
    const operation = sql
      .trimStart()
      .match(/^(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|DROP TABLE)/i)?.[1];
    const editableSource = operation?.toUpperCase() === 'SELECT' && !/\bJOIN\b/i.test(sql);

    this._store.createTab(
      sql,
      target?.kind === 'table' && editableSource ? target.source : undefined,
      target?.connectionId,
      target ? `${target.label} · ${operation?.toUpperCase() ?? 'Consulta'}` : undefined,
      target?.source.database,
    );
  }

  // --- Estado del área de trabajo -------------------------------------------
  protected readonly connections = this._store.connections;
  protected readonly explorerNodes = this._store.explorerNodes;
  protected readonly searchableRelations = this._store.searchableRelations;
  protected readonly tabs = this._store.tabs;
  protected readonly resultSet = this._store.resultSet;
  protected readonly result = this._store.result;
  protected readonly running = this._store.running;
  protected readonly rejection = this._store.rejection;
  protected readonly notice = this._store.notice;
  protected readonly history = this._store.history;
  protected readonly exporting = this._store.exporting;
  protected readonly transaction = this._store.transaction;
  protected readonly transactionBusy = this._store.transactionBusy;
  protected readonly formatSettings = this._store.formatSettings;

  protected readonly session = computed(() => this._store.session() ?? DISCONNECTED);

  protected readonly sql = computed(() => this._store.activeTab()?.sql ?? '');

  protected readonly hasConnection = computed(() => !!this._store.activeConnection()?.sessionId);

  /**
   * Contexto que muestra la barra del editor.
   *
   * El esquema solo se añade cuando el explorador ha cargado **uno y solo uno**,
   * y no coincide ya con el nombre de la base. Antes se escribía `public` fijo,
   * que es el esquema por omisión de PostgreSQL y de nadie más: en SQL Server es
   * `dbo` y en MySQL no existe, porque allí el esquema *es* la base. Inventar un
   * nombre de esquema es peor que no mostrar ninguno.
   */
  protected readonly editorContext = computed(() => {
    const session = this._store.session();

    if (!session) {
      return 'sin conexión';
    }

    const database = this._store.activeTab()?.database ?? session.database;
    const schemas = this._store.schemaIndex().schemas;
    const only = schemas.length === 1 ? schemas[0] : null;

    return only && only !== database ? `${database}.${only}` : database;
  });

  // --- Estado del editor -----------------------------------------------------
  protected readonly cursor = signal<CursorPosition>({ line: 1, column: 1 });
  protected readonly hasSelection = signal(false);

  /** Motor de la conexión activa; decide el dialecto del editor. */
  protected readonly activeEngine = computed<DatabaseEngine>(
    () => this._store.activeConnection()?.engine ?? 'postgresql',
  );

  protected engineFor(connectionId: string): DatabaseEngine {
    return this._store.engineForConnection(connectionId) ?? 'postgresql';
  }

  protected readonly schemaIndex = this._store.schemaIndex;

  // --- Edición de filas --------------------------------------------------------
  protected readonly editableTable = this._store.editableTable;
  protected readonly edits = this._store.edits;
  protected readonly editPreview = this._store.editPreview;
  protected readonly savingEdits = this._store.savingEdits;

  protected onCellEdited(edit: CellEdit): void {
    this._store.editCell(edit);
  }

  protected async prepareEdits(): Promise<void> {
    await this._store.prepareEdits();
  }

  protected async saveEdits(): Promise<void> {
    await this._store.saveEdits();
  }

  protected discardEdits(): void {
    this._store.discardEdits();
  }

  /** Vuelve del SQL a la lista de cambios, sin perderlos. */
  protected cancelSave(): void {
    this._store.cancelPreview();
  }

  /**
   * El editor pide por aquí las columnas de una tabla que aún no está abierta en
   * el explorador. Va como propiedad ligada, no como método suelto, para que
   * conserve el `this` del store.
   */
  protected readonly loadColumns = (
    schema: string | null,
    name: string,
  ): Promise<readonly KnownColumn[]> => this._store.ensureColumnsAsync(schema, name);

  /** Lo mismo para las tablas de un esquema que el precalentado no alcanzó. */
  protected readonly loadRelations = (schema: string): Promise<void> =>
    this._store.ensureRelationsAsync(schema);
  protected readonly timeoutSeconds = this._store.timeoutSeconds;

  private readonly _editor = viewChild<SqlEditor>('editor');
  private readonly _resultsPanel = viewChild<ResultsPanel>('resultsPanel');

  protected showHistory(): void {
    this._resultsPanel()?.openHistory();
  }

  /** Última selección y su origen, para trasladar a Monaco los errores del motor. */
  private _selection: EditorSelection = { hasSelection: false, text: '', startOffset: 0 };
  private _executionContext: { sql: string; startOffset: number } | null = null;
  protected readonly executionError = signal<ExecutionErrorContext | null>(null);

  // --- Productividad del editor ----------------------------------------------

  protected format(): void {
    void this._editor()?.formatDocument();
  }

  protected onFormatFailed(message: string): void {
    this._store.notify(`No se pudo formatear: ${message}`);
  }

  protected setTimeout(seconds: number): void {
    this._store.setTimeout(seconds);
  }

  protected async openSqlFile(): Promise<void> {
    try {
      const document = await this._sqlFiles.open();

      if (document) {
        this._store.openSqlFile(document.fileName, document.contents, document.documentId);
      }
    } catch (error) {
      this._store.notify(this.fileError('No se pudo abrir el archivo SQL', error));
    }
  }

  protected async saveTab(saveAs = false): Promise<void> {
    const tab = this._store.activeTab();

    if (!tab) {
      return;
    }

    try {
      const saved = await this._sqlFiles.save(
        {
          documentId: tab.documentId,
          fileName: tab.fileName,
          title: tab.title,
          contents: tab.sql,
        },
        saveAs,
      );

      if (saved) {
        this._store.markTabSaved(tab.id, tab.sql, saved.fileName, saved.documentId);
        this._store.notify(`Guardado: ${saved.fileName}`);
      }
    } catch (error) {
      this._store.notify(this.fileError('No se pudo guardar el archivo SQL', error));
    }
  }

  constructor() {
    // Los perfiles guardados deben estar antes de que el usuario mire la barra
    // lateral; si no, parecería que se han perdido.
    void this._store.loadSavedConnections();
    void this._store.loadHistory();
    void this._store.loadPreferences();

    let tabId = this._store.activeTab()?.id;
    effect(() => {
      const nextTabId = this._store.activeTab()?.id;

      if (nextTabId !== tabId) {
        tabId = nextTabId;
        this.executionError.set(null);
      }
    });
  }

  // --- Conexiones ------------------------------------------------------------
  protected openDialog(): void {
    this.editingConnection.set(null);
    this.dialogOpen.set(true);
  }

  /**
   * Abre el formulario con los datos de una conexión guardada.
   *
   * Si el perfil no está cargado no se abre nada: un formulario vacío que dice
   * «Editar» acabaría creando una conexión nueva sin que el usuario lo pidiera.
   */
  protected editConnection(id: string): void {
    const profile = this._store.savedProfile(id);

    if (!profile) {
      return;
    }

    this.editingConnection.set(profile);
    this.dialogOpen.set(true);
  }

  protected connectSaved(id: string): void {
    void this._store.connectSaved(id);
  }

  protected activateFromPalette(id: string): void {
    const connection = this.connections().find((item) => item.id === id);

    if (connection?.state === 'disconnected' && connection.saved) {
      this.connectSaved(id);
    } else {
      this._store.selectConnection(id);
    }
  }

  protected forget(id: string): void {
    void this._store.forget(id);
  }

  protected closeDialog(): void {
    this.dialogOpen.set(false);
    this.editingConnection.set(null);
  }

  protected toggleConnection(id: string): void {
    this._store.toggleConnection(id);
  }

  protected toggleNode(id: string): void {
    void this._store.toggleNode(id);
  }

  protected closeMobileExplorer(): void {
    this.mobileExplorerOpen.set(false);
  }

  protected refreshNode(id: string): void {
    void this._store.refreshNode(id);
  }

  protected openDefinition(node: ExplorerNode): void {
    void this._store.openDefinition(node);
  }

  protected disconnect(id: string): void {
    // Cerrar la conexión deshace lo que no esté confirmado, y eso puede ser el
    // trabajo de un buen rato. Es el mismo aviso que al cerrar una pestaña con
    // cambios sin guardar, por el mismo motivo.
    if (
      this._store.hasOpenTransaction(id) &&
      !window.confirm(
        'Esta conexión tiene una transacción abierta. Al cerrarla se perderán los ' +
          'cambios sin confirmar. ¿Cerrar de todos modos?',
      )
    ) {
      return;
    }

    void this._store.disconnect(id);
  }

  protected setFormatSettings(changes: Partial<FormatSettings>): void {
    void this._store.setFormatSettings(changes);
  }

  protected beginTransaction(): void {
    void this._store.beginTransaction();
  }

  protected commitTransaction(): void {
    void this._store.commitTransaction();
  }

  protected rollbackTransaction(): void {
    void this._store.rollbackTransaction();
  }

  /** Doble clic sobre una tabla: abre una consulta preparada. */
  protected openNode(node: ExplorerNode): void {
    const engine = this._store.engineForConnection(node.connectionId);

    if (!engine || (node.kind !== 'table' && node.kind !== 'view')) {
      return;
    }

    this._store.openSelectFor(
      node,
      buildSelect(engine, {
        schema: node.source.schema,
        table: node.source.name,
        columns: [],
        filters: [],
        limit: 100,
      }),
    );
  }

  // --- Pestañas --------------------------------------------------------------
  protected selectTab(id: string): void {
    this.executionError.set(null);
    this._store.selectTab(id);
  }

  protected closeTab(id: string): void {
    const tab = this.tabs().find((item) => item.id === id);

    if (tab?.dirty && !window.confirm(`“${tab.title}” tiene cambios sin guardar. ¿Cerrar de todos modos?`)) {
      return;
    }

    this.executionError.set(null);
    this._store.closeTab(id);
  }

  protected createTab(): void {
    this.executionError.set(null);
    this._store.createTab();
  }

  // --- Editor ----------------------------------------------------------------
  protected onSqlChange(sql: string): void {
    this.executionError.set(null);
    this._store.updateSql(sql);
  }

  private fileError(prefix: string, error: unknown): string {
    return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
  }

  protected onCursorChange(position: CursorPosition): void {
    this.cursor.set(position);
  }

  protected onSelectionChange(selection: EditorSelection): void {
    this.hasSelection.set(selection.hasSelection);
    this._selection = selection;
  }

  // --- Ejecución -------------------------------------------------------------
  protected execute(): void {
    void this.runQuery(this.sql(), 0);
  }

  /** Ejecuta solo lo seleccionado, sin alterar el contenido de la pestaña. */
  protected executeSelection(): void {
    void this.runQuery(this._selection.text, this._selection.startOffset);
  }

  protected cancel(): void {
    void this._store.cancel();
  }

  protected confirmDestructive(): void {
    const rejection = this.rejection();

    // Solo se puede confirmar un riesgo, nunca saltarse el modo de solo lectura.
    if (rejection?.reason === 'unconfirmeddestructive') {
      void this.confirmQuery();
    }
  }

  private async runQuery(sql: string, startOffset: number): Promise<void> {
    if (this.running()) {
      return;
    }

    this._executionContext = { sql, startOffset };
    this.executionError.set(null);
    const result = await this._store.execute(
      startOffset === 0 && sql === this.sql() ? undefined : sql,
    );

    if (result?.state === 'failed' && result.error) {
      this.executionError.set({ error: result.error, sql, startOffset });
    }
  }

  private async confirmQuery(): Promise<void> {
    const context = this._executionContext;
    this.executionError.set(null);
    const result = await this._store.confirmAndExecute();

    if (context && result?.state === 'failed' && result.error) {
      this.executionError.set({ error: result.error, ...context });
    }
  }

  protected dismissRejection(): void {
    this._store.dismissRejection();
  }

  protected dismissNotice(): void {
    this._store.dismissNotice();
  }

  // --- Exportación -----------------------------------------------------------
  protected exportAs(format: ExportFormat): void {
    void this._store.export(format);
  }

  // --- Copiar nombres --------------------------------------------------------
  protected onCopied(name: string): void {
    this._store.notify(`Copiado: ${name}`);
  }

  protected onCopyFailed(): void {
    this._store.notify('No se pudo acceder al portapapeles.');
  }

  // --- Historial -------------------------------------------------------------
  protected refreshHistory(): void {
    void this._store.loadHistory();
  }

  protected searchHistory(term: string): void {
    void this._store.loadHistory(term);
  }

  protected clearHistory(): void {
    void this._store.clearHistory();
  }

  /** Recupera una consulta del historial en una pestaña nueva. */
  protected reuseQuery(entry: QueryHistoryEntry): void {
    this._store.createTab(
      entry.sql,
      undefined,
      entry.connectionId,
      'Historial · Consulta',
      entry.database,
    );
  }
}
