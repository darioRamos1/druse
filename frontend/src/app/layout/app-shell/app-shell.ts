import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { ExportFormat, SavedSnippet } from '../../core/application-gateway/application-gateway';
import { SnippetStore } from '../../core/snippets/snippet.store';
import { SplashScreen } from '../../core/startup/splash-screen';
import { ThemeName, ThemeService } from '../../core/theme/theme.service';
import { UpdateService } from '../../core/update/update.service';
import { SettingsDialog } from '../../features/settings/settings-dialog/settings-dialog';
import { FormatSettings } from '../../core/workspace/format-settings';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { SqlFileService } from '../../core/sql-files/sql-file.service';
import { ConnectionDialog } from '../../features/connections/connection-dialog/connection-dialog';
import { ConnectionsSidebar } from '../../features/connections/connections-sidebar/connections-sidebar';
import { EditorTabs } from '../../features/query-editor/editor-tabs/editor-tabs';
import {
  ConnectionChoice,
  EditorToolbar,
} from '../../features/query-editor/editor-toolbar/editor-toolbar';
import {
  CursorPosition,
  EditorSelection,
  ExecutionErrorContext,
} from '../../features/query-editor/sql-editor/sql-editor';
import SqlEditor from '../../features/query-editor/sql-editor/sql-editor';
import { BackupDialog } from '../../features/backup/backup-dialog/backup-dialog';
import { RestoreDialog } from '../../features/backup/restore-dialog/restore-dialog';
import { ImportDialog } from '../../features/import/import-dialog/import-dialog';
import { TransferDialog } from '../../features/transfer/transfer-dialog/transfer-dialog';
import { TransferSetDialog } from '../../features/transfer/transfer-set-dialog/transfer-set-dialog';
import { TableDesigner } from '../../features/tables/table-designer/table-designer';
import { DiagramPanel } from '../../features/diagram/diagram-panel/diagram-panel';
import { ProcedureRunner } from '../../features/query-builder/procedure-runner/procedure-runner';
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
import { AiPanel } from '../../features/ai/ai-panel/ai-panel';
import { AiProviderDialog } from '../../features/ai/ai-provider-dialog/ai-provider-dialog';
import { AiStore } from '../../core/ai/ai-store';
import { describeSchema } from '../../core/ai/ai-context';

/**
 * Cuantas tablas se precargan al abrir el asistente.
 *
 * Cada una es una consulta al catalogo del motor. El tope evita que abrir el
 * panel sobre una base de cientos de tablas se convierta en una espera, y
 * coincide con el que aplica el propio compositor del contexto.
 */
const MAX_WARMED_TABLES = 40;

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
    TransferDialog,
    TransferSetDialog,
    BackupDialog,
    RestoreDialog,
    TableDesigner,
    DiagramPanel,
    QueryBuilder,
    ProcedureRunner,
    CommandPalette,
    SettingsDialog,
    ResizeHandle,
    AiPanel,
    AiProviderDialog,
  ],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  private readonly _store = inject(WorkspaceStore);
  private readonly _sqlFiles = inject(SqlFileService);
  private readonly _snippets = inject(SnippetStore);
  private readonly _themes = inject(ThemeService);
  private readonly _splash = inject(SplashScreen);
  protected readonly updates = inject(UpdateService);

  // --- Apariencia ------------------------------------------------------------
  protected readonly theme = this._themes.theme;

  /** El acento elegido, que el editor necesita para su cursor y su selección. */
  protected readonly accent = computed(() => this._themes.appearance().accent);

  protected readonly editorFontSize = computed(() => this._themes.appearance().editorFontSize);

  protected readonly settingsOpen = signal(false);

  // --- Asistente -------------------------------------------------------------
  private readonly _ai = inject(AiStore);

  protected readonly aiOpen = signal(false);
  protected readonly aiProvidersOpen = signal(false);

  /**
   * Lo que el asistente puede saber de la base sin que nadie se lo escriba.
   *
   * Lo compone el shell porque es quien conoce el espacio de trabajo; el panel
   * solo lo recibe hecho y decide si mandarlo. De momento son los nombres de
   * las tablas cargadas en el arbol de la conexion activa y el SQL abierto:
   * **nombres y consulta, nunca filas de resultados**.
   */
  protected readonly aiContext = computed(() => {
    const session = this._store.session();
    const described = describeSchema(this._store.schemaIndex().relations);

    return {
      database: session?.database ?? '',
      tables: described.tables,
      schema: described.schema,
      sql: this._store.activeTab()?.sql ?? '',
    };
  });

  protected toggleAssistant(): void {
    const abriendo = !this.aiOpen();

    this.aiOpen.set(abriendo);

    // La lista se pide al abrir y no al arrancar: quien no use el asistente no
    // tiene por que pagar una peticion mas en cada arranque.
    if (abriendo) {
      void this._ai.refresh();
      void this.warmSchema();
    }
  }

  /**
   * Carga las columnas de las tablas que el usuario no ha desplegado.
   *
   * Sin esto, el asistente solo conoce las tablas que estuvieran abiertas en el
   * arbol —normalmente ninguna— y responde pidiendo los nombres de las columnas
   * en lugar de escribir la consulta. Se hace al abrir el panel y no al
   * arrancar, y una sola vez por tabla: el store cachea lo que trae.
   */
  private async warmSchema(): Promise<void> {
    const pending = this._store
      .schemaIndex()
      .relations.filter((relation) => relation.columns.length === 0)
      .slice(0, MAX_WARMED_TABLES);

    // De una en una y no en paralelo: son peticiones al catalogo del motor, y
    // cuarenta a la vez sobre una conexion compartida compiten con lo que el
    // usuario este haciendo en ese momento.
    for (const relation of pending) {
      await this._store.ensureColumnsAsync(relation.schema || null, relation.name);
    }
  }

  /** Inserta donde esté el cursor, o sustituye únicamente la selección activa. */
  protected insertFromAi(sql: string): void {
    this._editor()?.insertText(sql);
  }

  /** Sustituye solo la selección o sentencia activa; el resto de la pestaña sobrevive. */
  protected replaceFromAi(sql: string): void {
    this._editor()?.replaceActiveStatement(sql);
  }

  /**
   * Proporción del editor, para que la miniatura de preferencias enseñe el
   * mismo recorte. Se mide al abrir el panel y no antes: depende de cómo tenga
   * el usuario repartidos los paneles en ese momento.
   */
  protected readonly editorRatio = signal('16 / 9');

  protected openSettings(): void {
    this.prepareOverlay();
    const box = this._editorElement()?.nativeElement.getBoundingClientRect();

    if (box?.height) {
      // Acotada: con el panel de resultados abierto del todo, el editor puede
      // quedar en una franja de diez a uno, y una miniatura con esa forma no se
      // ve. Se pierde algo de fidelidad justo cuando el encuadre importa menos,
      // porque apenas hay editor donde enseñar la imagen.
      const ratio = Math.min(2.6, Math.max(1.2, box.width / box.height));

      this.editorRatio.set(`${ratio.toFixed(2)} / 1`);
    }

    this.settingsOpen.set(true);
  }

  protected selectTheme(theme: ThemeName): void {
    void this._themes.set(theme);
  }

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

  /**
   * Al cerrar o al perder el foco se guarda ya lo que estuviera esperando.
   *
   * El guardado normal espera a que se deje de escribir, y esa espera deja una
   * rendija: cerrar la ventana justo después de teclear se llevaría lo último.
   * `blur` cubre además el caso de irse a otra aplicación y no volver.
   */
  @HostListener('window:beforeunload')
  @HostListener('window:blur')
  protected onLeaving(): void {
    this._store.flushTabs();
  }

  @HostListener('document:keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      if (this.paletteOpen()) {
        return;
      }
      if (
        this.dialogOpen() ||
        this.importTarget() ||
        this.transferTarget() ||
        this.transferSetTarget() ||
        this.builderTarget() ||
        this.designTarget() ||
        this.backupOpen() ||
        this.restoreOpen()
      ) {
        return;
      }
      event.preventDefault();
      this.prepareOverlay();
      this.paletteOpen.set(true);
    } else if (event.key === 'Escape' && this.paletteOpen()) {
      this.paletteOpen.set(false);
    }
  }

  /** Tabla a la que se está importando, si el diálogo está abierto. */
  protected readonly importTarget = signal<ExplorerNode | null>(null);

  protected openImport(node: ExplorerNode): void {
    this.prepareOverlay();
    this.importTarget.set(node);
  }

  protected closeImport(): void {
    this.importTarget.set(null);
  }

  /**
   * Tabla desde la que se está trasladando, si el asistente está abierto.
   *
   * Se borra al cerrar y el traslado sigue: el estado que sobrevive vive en el
   * `TransferStore`, no aquí, igual que en los respaldos.
   */
  protected readonly transferTarget = signal<ExplorerNode | null>(null);

  protected openTransfer(node: ExplorerNode): void {
    this.prepareOverlay();
    this.transferTarget.set(node);
  }

  /**
   * Sitio del que se están migrando varias tablas.
   *
   * Va aparte del de una tabla porque son dos asistentes: aquí lo que se elige es
   * el conjunto, y el destino es dónde viven las tablas y no una de ellas.
   */
  protected readonly transferSetTarget = signal<ExplorerNode | null>(null);

  protected openTransferSet(node: ExplorerNode): void {
    this.prepareOverlay();
    this.transferSetTarget.set(node);
  }

  protected closeTransferSet(): void {
    this.transferSetTarget.set(null);
  }

  protected closeTransfer(): void {
    this.transferTarget.set(null);
  }

  /**
   * Nodo desde el que se abrió el asistente de respaldos.
   *
   * No se borra al cerrar el asistente **a propósito**: el respaldo sigue
   * corriendo en el proceso local y el indicador de la barra de estado tiene que
   * poder devolver aquí. Lo que se cierra es la visibilidad, no el destino.
   */
  protected readonly backupTarget = signal<ExplorerNode | null>(null);

  protected readonly backupOpen = signal(false);

  /** Sesión de la conexión del nodo respaldado; vacía si se perdió. */
  protected readonly backupSessionId = computed(() => {
    const target = this.backupTarget();

    return target ? (this._store.sessionForConnection(target.connectionId) ?? '') : '';
  });

  /**
   * Base sobre la que está abierto el asistente de restauración.
   *
   * Se guarda igual que el del respaldo y por lo mismo: el trabajo sigue en el
   * proceso local aunque se cierre la ventana.
   */
  protected readonly restoreTarget = signal<ExplorerNode | null>(null);

  protected readonly restoreOpen = signal(false);

  protected readonly restoreSessionId = computed(() => {
    const target = this.restoreTarget();

    return target ? (this._store.sessionForConnection(target.connectionId) ?? '') : '';
  });

  protected openRestore(node: ExplorerNode): void {
    this.prepareOverlay();
    this.restoreTarget.set(node);
    this.restoreOpen.set(true);
  }

  protected closeRestore(): void {
    this.restoreOpen.set(false);
  }

  /** Vuelve al detalle desde el indicador de la barra, igual que el respaldo. */
  protected reopenRestore(): void {
    if (this.restoreTarget()) {
      this.restoreOpen.set(true);
    }
  }

  protected openBackup(node: ExplorerNode): void {
    this.prepareOverlay();
    this.backupTarget.set(node);
    this.backupOpen.set(true);
  }

  protected closeBackup(): void {
    this.backupOpen.set(false);
  }

  /**
   * Vuelve al detalle desde el indicador de la barra de estado.
   *
   * Sin destino no hay nada que reabrir: pasa si la aplicación se recargó con un
   * respaldo en marcha, y entonces el indicador solo informa.
   */
  protected reopenBackup(): void {
    if (this.backupTarget()) {
      this.backupOpen.set(true);
    }
  }

  /**
   * Nodo sobre el que está abierto el diseñador de tablas.
   *
   * Un esquema significa crear; una tabla, modificarla. El propio diseñador
   * distingue por la clase del nodo.
   */
  protected readonly designTarget = signal<ExplorerNode | null>(null);

  protected openTableDesigner(node: ExplorerNode): void {
    this.prepareOverlay();
    this.designTarget.set(node);
  }

  protected closeTableDesigner(): void {
    this.designTarget.set(null);
  }

  /**
   * Esquema o tabla cuyo diagrama se está mirando.
   *
   * Vive aquí y no entre las pestañas porque el diagrama todavía no se guarda:
   * en cuanto se pueda guardar tendrá pestaña propia, que es donde caben varios
   * abiertos a la vez.
   */
  protected readonly diagramTarget = signal<ExplorerNode | null>(null);

  /** Sesión de la conexión cuyo diagrama se mira; vacía si se perdió. */
  protected readonly diagramSessionId = computed(() => {
    const target = this.diagramTarget();

    return target ? (this._store.sessionForConnection(target.connectionId) ?? '') : '';
  });

  protected openDiagram(node: ExplorerNode): void {
    this.prepareOverlay();
    this.diagramTarget.set(node);
  }

  protected closeDiagram(): void {
    this.diagramTarget.set(null);
  }

  /** Del diagrama al diseñador: el mismo camino que desde el explorador. */
  protected designFromDiagram(table: DatabaseObject): void {
    const target = this.diagramTarget();

    if (!target) {
      return;
    }

    this.diagramTarget.set(null);
    this.openTableDesigner({ ...target, source: table });
  }

  /** Tabla sobre la que se está componiendo una consulta. */
  protected readonly builderTarget = signal<ExplorerNode | null>(null);

  protected openBuilder(node: ExplorerNode): void {
    this.prepareOverlay();
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

  /** Procedimiento que se está preparando para ejecutar. */
  protected readonly procedureTarget = signal<ExplorerNode | null>(null);

  protected openProcedureRunner(node: ExplorerNode): void {
    this.prepareOverlay();
    this.procedureTarget.set(node);
  }

  protected closeProcedureRunner(): void {
    this.procedureTarget.set(null);
  }

  /** La llamada compuesta se abre en una pestaña, para poder revisarla. */
  protected insertCall(sql: string): void {
    const target = this.procedureTarget();

    this._store.createTab(
      sql,
      undefined,
      target?.connectionId,
      target ? `${target.label} · EXEC` : undefined,
      target?.source.database,
    );

    this.procedureTarget.set(null);
  }

  /**
   * Ejecutar abre igualmente la pestaña antes de lanzar.
   *
   * Lo que se ejecuta tiene que quedar escrito en algún sitio: si la llamada
   * falla o devuelve algo raro, el usuario necesita el SQL delante para
   * entenderlo, y no un diálogo que ya se cerró.
   */
  protected async runCall(sql: string): Promise<void> {
    this.insertCall(sql);
    await this._store.execute();
  }

  // --- Estado del área de trabajo -------------------------------------------
  protected readonly connections = this._store.connections;
  protected readonly explorerNodes = this._store.explorerNodes;

  /** Todo lo cargado, para que el filtro del explorador alcance lo plegado. */
  protected readonly catalogNodes = this._store.catalogNodes;
  protected readonly searchableRelations = this._store.searchableRelations;
  protected readonly tabs = this._store.tabs;
  protected readonly resultSet = this._store.resultSet;
  protected readonly result = this._store.result;
  protected readonly running = this._store.running;
  protected readonly canceling = this._store.canceling;

  // Borrado de filas: la selección y el SQL viven en el store, como la edición.
  protected readonly selectedRows = this._store.selectedRows;
  protected readonly deletePreview = this._store.deletePreview;
  protected readonly deleting = this._store.deleting;

  protected toggleRowSelection(row: number): void {
    this._store.toggleRowSelection(row);
  }

  protected clearRowSelection(): void {
    this._store.clearRowSelection();
  }

  protected async prepareDelete(): Promise<void> {
    await this._store.prepareDelete();
  }

  protected cancelDeletePreview(): void {
    this._store.cancelDeletePreview();
  }

  protected async deleteSelectedRows(): Promise<void> {
    await this._store.deleteSelectedRows();
  }
  protected readonly rejection = this._store.rejection;
  protected readonly notice = this._store.notice;
  protected readonly history = this._store.history;
  protected readonly exporting = this._store.exporting;
  protected readonly transaction = this._store.transaction;
  protected readonly transactionBusy = this._store.transactionBusy;
  protected readonly formatSettings = this._store.formatSettings;

  /**
   * Estado de la sesión para la barra inferior.
   *
   * La base es la de la pestaña, no la que se abrió al conectar: se puede
   * cambiar desde la barra del editor, y una barra de estado que siguiera
   * diciendo la original estaría señalando a otra base que la que se ejecuta.
   */
  protected readonly session = computed(() => {
    const status = this._store.session() ?? DISCONNECTED;
    const database = this._store.activeDatabase();

    return database && database !== status.database ? { ...status, database } : status;
  });

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
  ): Promise<readonly KnownColumn[]> => {
    const tab = this._store.activeTab();

    return this._store.ensureColumnsAsync(schema, name, tab?.connectionId, tab?.database);
  };

  /** Lo mismo para las tablas de un esquema que el precalentado no alcanzó. */
  protected readonly loadRelations = (schema: string): Promise<void> => {
    const tab = this._store.activeTab();

    return this._store.ensureRelationsAsync(schema, tab?.connectionId, tab?.database);
  };
  protected readonly timeoutSeconds = this._store.timeoutSeconds;

  protected readonly maxRows = this._store.maxRows;

  private readonly _editor = viewChild<SqlEditor>('editor');
  private readonly _editorElement = viewChild('editor', { read: ElementRef });
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

  protected toggleLineComment(): void {
    this._editor()?.toggleLineComment();
  }

  protected findInEditor(replace: boolean): void {
    this._editor()?.openFind(replace);
  }

  // --- Fragmentos guardados ---------------------------------------------------

  protected readonly snippets = this._snippets.snippets;

  /**
   * Guarda lo que hay en el editor con el nombre que dio la paleta.
   *
   * Se guarda **lo mismo que ejecutaría «Ejecutar actual»**: la selección, o la
   * instrucción donde esté el cursor. Guardar la pestaña entera cuando lo que se
   * quería era una consulta obligaría a recortarla después a mano.
   */
  protected async saveSnippet(name: string): Promise<void> {
    const sql = this._editor()?.activeFragment().text.trim() ?? '';

    if (sql.length === 0) {
      this._store.notify('No hay nada que guardar: el editor está vacío.');

      return;
    }

    const saved = await this._snippets.save(name || SnippetStore.suggestName(sql), sql);

    this._store.notify(
      saved
        ? `Fragmento guardado: «${saved.name}».`
        : (this._snippets.error() ?? 'No se pudo guardar el fragmento.'),
    );
  }

  /** Lo pone donde esté el cursor, que es de donde vino el usuario. */
  protected insertSnippet(snippet: SavedSnippet): void {
    this._editor()?.insertText(snippet.sql);
  }

  protected async deleteSnippet(snippet: SavedSnippet): Promise<void> {
    const removed = await this._snippets.remove(snippet.id);

    this._store.notify(
      removed
        ? `Fragmento borrado: «${snippet.name}».`
        : (this._snippets.error() ?? 'No se pudo borrar el fragmento.'),
    );
  }

  protected onFormatFailed(message: string): void {
    this._store.notify(`No se pudo formatear: ${message}`);
  }

  protected setMaxRows(rows: number): void {
    this._store.setMaxRows(rows);
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
    void this.startup();

    let tabId = this._store.activeTab()?.id;
    effect(() => {
      const nextTabId = this._store.activeTab()?.id;

      if (nextTabId !== tabId) {
        tabId = nextTabId;
        this.executionError.set(null);
      }
    });
  }

  /**
   * Lo que hay que leer para que la ventana tenga algo que enseñar.
   *
   * Las cinco lecturas salen a la vez porque ninguna depende de otra, y la
   * pantalla de carga se retira cuando han terminado todas: hasta entonces, lo
   * que hay detrás es una interfaz vacía que se iría poblando a saltos.
   *
   * `allSettled` y no `all`: que una falle —el historial, pongamos— deja a la
   * aplicación sin esa parte, pero no es motivo para dejar la pantalla de carga
   * puesta encima de todo lo demás, que sí funciona.
   */
  private async startup(): Promise<void> {
    await Promise.allSettled([
      // Los perfiles guardados deben estar antes de que el usuario mire la barra
      // lateral; si no, parecería que se han perdido.
      this._store.loadSavedConnections(),
      this._store.loadHistory(),
      this._store.loadPreferences(),

      // Los fragmentos, con lo demás: los ofrece el autocompletado desde la
      // primera tecla, así que no pueden llegar cuando al usuario ya le hizo
      // falta uno.
      this._snippets.load(),

      // Lo que quedó escrito y sin ejecutar vuelve tal cual. Va aquí y no más
      // tarde porque hasta que no se ha leído, el store no guarda nada: la
      // pestaña vacía del arranque pisaría el trabajo de la sesión anterior.
      this._store.restoreTabs(),
    ]);

    this._splash.dismiss();

    void this.updates.initialize().then(() => {
      const release = this.updates.available();

      if (release) {
        this._store.notify(`Druse ${release.version} está disponible en Preferencias.`);
      }
    });
  }

  // --- Conexiones ------------------------------------------------------------
  protected openDialog(): void {
    this.prepareOverlay();
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

    this.prepareOverlay();
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

  private prepareOverlay(): void {
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

  /** Bases de la conexión activa, para el desplegable de la barra. */
  protected readonly databases = computed(() => {
    const connectionId = this._store.activeConnection()?.id;

    return connectionId ? this._store.databasesFor(connectionId) : [];
  });

  protected readonly activeDatabase = this._store.activeDatabase;
  protected readonly lostConnection = this._store.lostConnection;

  protected useDatabase(database: string): void {
    this._store.useDatabase(database);
  }

  /**
   * Las conexiones entre las que puede moverse la pestaña.
   *
   * Van todas: las abiertas y las guardadas que no lo están. Pasar de desarrollo
   * a preproducción es el caso de todos los días, y obligar a ir al panel de
   * conexiones y volver es lo que lleva a tener la misma consulta en dos
   * pestañas y ejecutarla en la equivocada.
   */
  protected readonly connectionChoices = computed<readonly ConnectionChoice[]>(() =>
    this._store.connections().map((connection) => ({
      id: connection.id,
      name: connection.name,
      environment: connection.environment,
      open: connection.sessionId !== undefined,
      readOnly: connection.readOnly,
    })),
  );

  protected readonly activeConnectionId = computed(
    () => this._store.activeConnection()?.id ?? null,
  );

  /**
   * Cambia la conexión de la pestaña.
   *
   * Si la elegida no está abierta y su contraseña no está guardada, se abre el
   * mismo diálogo que al editarla: es donde el usuario ya sabe escribirla.
   */
  protected async useConnection(connectionId: string): Promise<void> {
    if ((await this._store.useConnection(connectionId)) === 'needsPassword') {
      this.editConnection(connectionId);
    }
  }

  /**
   * Vuelve a abrir una conexión.
   *
   * Si el perfil no guarda la contraseña, la API la pide y aquí se abre el mismo
   * diálogo que al editarla: es donde el usuario ya sabe escribirla.
   */
  protected async reconnect(id: string): Promise<void> {
    const outcome = await this._store.reconnect(id);

    if (outcome === 'needsPassword') {
      this.editConnection(id);
    }
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

    if (
      tab?.dirty &&
      !window.confirm(`“${tab.title}” tiene cambios sin guardar. ¿Cerrar de todos modos?`)
    ) {
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

  /**
   * Ejecuta un trozo de la pestaña, sin alterar su contenido.
   *
   * Con selección, lo seleccionado. Sin ella, **la instrucción donde está el
   * cursor**: es lo que se espera de un editor con varias consultas dentro, y
   * antes obligaba a resaltarla a mano cada vez.
   *
   * Se le pregunta al editor porque el cursor es suyo. El shell solo guarda la
   * última selección, que no basta: el cursor se mueve sin seleccionar nada.
   */
  protected executeSelection(): void {
    const fragment = this._editor()?.activeFragment() ?? this._selection;

    void this.runQuery(fragment.text, fragment.startOffset);
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
