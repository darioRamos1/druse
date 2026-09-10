import { Observable } from 'rxjs';

import {
  AuthenticationMode,
  DatabaseColumn,
  DatabaseEngine,
  DatabaseObject,
  EngineInfo,
  IndexCapabilities,
  QueryHistoryEntry,
  QueryResult,
  SavedConnection,
  SecretStoreStatus,
  SessionInfo,
  SshTunnel,
  TableAlteration,
  TableDesign,
  RoutineSignature,
  TableStructure,
  SchemaGraph,
  TestConnectionResult,
  TestTunnelResult,
} from '../../shared/models/workspace';
import {
  AiChatRequest,
  AiProbeResult,
  AiProvider,
  AiProviderList,
  AiModelList,
  AiStreamEvent,
  CliLaunch,
  CliSessionState,
  SaveAiProviderRequest,
} from '../../shared/models/ai';

/** Estado del proceso local que atiende las peticiones de la aplicación. */
export interface HealthStatus {
  readonly status: string;
  readonly product: string;
  readonly version: string;
  readonly environment: string;
  readonly timestampUtc: string;
}

/** Datos de conexión. La contraseña solo viaja de ida. */
export interface ConnectRequest {
  readonly profile: {
    readonly id?: string;
    readonly name: string;
    readonly engine: DatabaseEngine;
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly username: string;
    /** `password` o `windows`. Si falta, la API asume `password`. */
    readonly authentication?: AuthenticationMode;
    readonly readOnly?: boolean;
    readonly sslMode?: string;
    readonly connectTimeoutSeconds?: number;
    /** Servidor intermedio, o ausente para ir directo. */
    readonly sshTunnel?: SshTunnel;
    /** Servidor lógico de Informix. Solo lo usa el motor `informixsqli`. */
    readonly informixServer?: string;
  };
  readonly password?: string;
  /** Contraseña del usuario SSH, o passphrase de su clave. */
  readonly sshSecret?: string;
  /** Código de un solo uso del servidor SSH. */
  readonly sshVerificationCode?: string;
}

/** Cómo leer el archivo que se importa. */
export interface ImportOptions {
  readonly hasHeaders: boolean;
  readonly delimiter: string;
  readonly encoding: string;
  readonly nullText: string;
}

/** Qué columna del archivo va a qué columna de la tabla. */
export interface ColumnMapping {
  readonly source: string;
  readonly target: string | null;
}

/** Un valor del archivo que no cabe en su columna. */
export interface ImportProblem {
  readonly row: number;
  readonly column: string;
  readonly message: string;
}

/** Lo que se sabe antes de escribir nada. */
export interface ImportPreview {
  readonly mappings: readonly ColumnMapping[];
  readonly missingRequired: readonly string[];
  readonly problems: readonly ImportProblem[];
  readonly rowCount: number;
  readonly statements: readonly string[];
}

/** Cambios de la cuadrícula tal y como viajan a la API. */
export interface RowEditRequest {
  readonly sessionId: string;
  readonly table: DatabaseObject;
  /** El usuario ya vio el SQL. Sin esto el servidor se niega. */
  readonly confirmed: boolean;
  readonly edits: readonly {
    readonly key: readonly { column: string; value: string | null }[];
    readonly changes: readonly { column: string; value: string | null }[];
  }[];
}

/**
 * Filas que se van a borrar, señaladas por su clave primaria.
 *
 * Sin valores: para borrar basta con saber cuál es la fila.
 */
export interface RowDeleteRequest {
  readonly sessionId: string;
  readonly table: DatabaseObject;
  /** El usuario ya vio el SQL. Sin esto el servidor se niega. */
  readonly confirmed: boolean;
  readonly keys: readonly (readonly { column: string; value: string | null }[])[];
}

/** Lo que se ejecutó al cambiar la estructura, y cuánto tardó. */
export interface TableChangeResult {
  readonly statements: readonly string[];
  readonly durationMs: number;
}

export interface RowEditResult {
  readonly rowsAffected: number;
  readonly durationMs: number;
  /** Lo que se ejecutó, escrito para poder leerlo. */
  readonly statements: readonly string[];
}

export interface ExecuteQueryRequest {
  readonly sessionId: string;
  readonly sql: string;
  /** Base elegida en el explorador; si falta, se usa la inicial de la conexión. */
  readonly database?: string;

  /**
   * Identificador elegido por el cliente para poder cancelar.
   *
   * Sin él, el identificador solo llegaría con la respuesta —cuando ya no queda
   * nada que cancelar— y el botón «Cancelar» no tendría a qué agarrarse.
   */
  readonly executionId?: string;

  readonly maxRows?: number;
  readonly timeoutSeconds?: number;
  readonly confirmDestructive?: boolean;
}

/** Riesgo detectado antes de ejecutar. */
export interface SqlRisk {
  readonly kind: string;
  readonly description: string;
}

/** La ejecución se rechazó y el usuario debe decidir. */
export interface QueryRejected {
  readonly reason:
    | 'readonlyconnection'
    | 'unconfirmeddestructive'
    | 'emptystatement'
    /** Se pidió exportar algo que escribe en la base en vez de devolver filas. */
    | 'notexportable';
  readonly message: string;
  readonly risks: readonly SqlRisk[];
}

/**
 * La transacción manual de una conexión.
 *
 * Es de la conexión y no de la pestaña: dos pestañas del mismo perfil comparten
 * sesión, así que lo que se ejecute en cualquiera de ellas entra en la misma
 * transacción. De ahí que lleve el nombre de la conexión y la base, que es lo
 * que el indicador tiene que enseñar.
 */
export interface TransactionState {
  readonly sessionId: string;
  readonly isOpen: boolean;
  /** Cuándo se abrió, en UTC. Ausente si no hay ninguna. */
  readonly startedAt?: string;
  readonly lastActivityAt?: string;
  readonly connectionName: string;
  readonly database: string;
  readonly engine: DatabaseEngine;
  /** El DDL entra en la transacción y se deshace con ella. Falso en MySQL. */
  readonly ddlIsReversible: boolean;
  /** Segundos sin actividad tras los cuales se deshace sola. */
  readonly idleTimeoutSeconds: number;
  /** Se deshizo sola por inactividad y hay que contárselo al usuario. */
  readonly autoRolledBackAt?: string;
}

/**
 * Una pestaña del editor tal como se guarda entre sesiones.
 *
 * Es trabajo **sin ejecutar**: el historial ya guarda lo que llegó a lanzarse, y
 * esto es lo demás, que hasta ahora se perdía al cerrar.
 */
export interface StoredEditorTab {
  readonly id: string;
  readonly title: string;
  readonly sql: string;
  readonly isActive: boolean;
  readonly isDirty: boolean;
  readonly connectionId?: string;
  readonly database?: string;
  readonly fileName?: string;
  readonly documentId?: string;
}

/**
 * Un trozo de SQL guardado con nombre.
 *
 * Lo que se escribe una vez y se repite muchas. No se ata a ninguna conexión:
 * el mismo `SELECT` sirve en pruebas y en producción, y atarlo a un perfil
 * obligaría a decidir qué hacer con él cuando ese perfil se borra.
 */
/**
 * Un diagrama guardado.
 *
 * `model` es JSON con lo que hace falta para volver a dibujarlo: qué tablas
 * entran y dónde están. Nunca columnas ni tipos.
 */
export interface SavedDiagram {
  readonly id: string;
  readonly connectionId: string;
  readonly name: string;
  readonly model: string;
  readonly createdAtUtc?: string;
  readonly updatedAtUtc?: string;
}

export interface SavedSnippet {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
  readonly createdAtUtc?: string;
  readonly updatedAtUtc?: string;
}

/** No se pudo iniciar, confirmar o deshacer. */
export interface TransactionRejected {
  readonly reason: 'alreadyopen' | 'notopen' | 'readonlyconnection';
  readonly message: string;
}

/**
 * Único punto de contacto entre la interfaz y la aplicación local.
 *
 * Los componentes dependen siempre de esta abstracción, nunca de HttpClient.
 * Hoy la implementa `HttpApplicationGateway`; cuando Tauri administre el proceso
 * (Fase 7) podrá sustituirse por una implementación IPC sin tocar la interfaz.
 *
 * Ver PLAN_TRABAJO_DRUSE.md §2 (Arquitectura) y §5 (Límites de los módulos).
 */
export abstract class ApplicationGateway {
  /** Verifica que el proceso local está activo. */
  abstract getHealth(): Observable<HealthStatus>;

  /** Motores con proveedor registrado. */
  abstract getEngines(): Observable<readonly EngineInfo[]>;

  /**
   * Crea la base que el perfil nombra, sin abrirla.
   *
   * Crear y conectar son dos cosas: quien crea una base quiere después decidir
   * si la abre, y encadenarlo dejaría una sesión viva que nadie pidió.
   */
  abstract createDatabase(request: ConnectRequest): Observable<void>;

  /** Prueba unas credenciales sin abrir sesión ni guardarlas. */
  abstract testConnection(request: ConnectRequest): Observable<TestConnectionResult>;

  /**
   * Prueba solo el túnel, sin tocar la base de datos.
   *
   * Separa dos fallos que «no se pudo conectar» mezcla: que el servidor
   * intermedio no deje entrar, y que desde él no se alcance el de la base.
   */
  abstract testTunnel(request: ConnectRequest): Observable<TestTunnelResult>;

  /**
   * Bases que esas credenciales pueden abrir, antes de abrir ninguna sesión.
   *
   * Es lo que deja elegir en el formulario en vez de tener que saberse el nombre
   * de memoria.
   */
  abstract listConnectionDatabases(request: ConnectRequest): Observable<readonly string[]>;

  abstract openSession(request: ConnectRequest): Observable<SessionInfo>;

  abstract closeSession(sessionId: string): Observable<void>;

  abstract getDatabases(sessionId: string): Observable<readonly DatabaseObject[]>;

  /** Hijos de un nodo. Es la base de la carga perezosa del explorador. */
  abstract getChildren(
    sessionId: string,
    parent: DatabaseObject,
  ): Observable<readonly DatabaseObject[]>;

  abstract getColumns(
    sessionId: string,
    table: DatabaseObject,
  ): Observable<readonly DatabaseColumn[]>;

  abstract getDefinition(sessionId: string, databaseObject: DatabaseObject): Observable<string>;

  /** Parámetros de un procedimiento, para poder componer su llamada. */
  abstract getRoutineSignature(
    sessionId: string,
    routine: DatabaseObject,
  ): Observable<RoutineSignature>;

  /**
   * Ejecuta SQL.
   *
   * Un rechazo por instrucción destructiva o por conexión de solo lectura llega
   * como error HTTP 409 con cuerpo {@link QueryRejected}, no como excepción de
   * transporte: es una respuesta legítima que la interfaz debe saber tratar.
   */
  abstract executeQuery(request: ExecuteQueryRequest): Observable<QueryResult>;

  abstract cancelQuery(executionId: string): Observable<void>;

  // --- Transacciones manuales -----------------------------------------------

  /**
   * Estado de la transacción de una conexión.
   *
   * La interfaz lo consulta también cada poco mientras hay una abierta: es como
   * se entera de que se deshizo sola por inactividad, que pasa sin que nadie
   * haya pulsado nada.
   */
  abstract getTransaction(sessionId: string): Observable<TransactionState>;

  /** Entra en modo manual. Hasta aquí cada instrucción se confirmaba sola. */
  abstract beginTransaction(sessionId: string): Observable<TransactionState>;

  abstract commitTransaction(sessionId: string): Observable<TransactionState>;

  abstract rollbackTransaction(sessionId: string): Observable<TransactionState>;

  // --- Edición de filas -----------------------------------------------------

  /**
   * El SQL que se ejecutaría, para enseñarlo antes de tocar nada.
   *
   * Va por su propia ruta y no como una bandera de {@link applyRowEdits}: ver y
   * ejecutar son cosas distintas, y confundirlas aquí acabaría guardando algo
   * que solo se quería mirar.
   */
  abstract previewRowEdits(request: RowEditRequest): Observable<readonly string[]>;

  /** Guarda los cambios. El servidor los aplica todos o ninguno. */
  abstract applyRowEdits(request: RowEditRequest): Observable<RowEditResult>;

  /** El `DELETE` que se ejecutaría, para enseñarlo antes de borrar nada. */
  abstract previewRowDeletes(request: RowDeleteRequest): Observable<readonly string[]>;

  abstract deleteRows(request: RowDeleteRequest): Observable<RowEditResult>;

  // --- Importación ----------------------------------------------------------

  /**
   * Qué se insertaría y qué no cabe, sin tocar la tabla.
   *
   * El archivo viaja tal cual, en un formulario: codificarlo en base64 dentro de
   * un JSON lo haría un tercio más grande sin ganar nada.
   */
  abstract previewImport(
    sessionId: string,
    table: DatabaseObject,
    file: File,
    options: ImportOptions,
  ): Observable<ImportPreview>;

  /** Inserta las filas del archivo. Todas o ninguna. */
  abstract runImport(
    sessionId: string,
    table: DatabaseObject,
    file: File,
    options: ImportOptions,
  ): Observable<RowEditResult>;

  // --- Diseño de tablas -----------------------------------------------------

  /** Tipos que ofrece el motor de esta sesión, para el desplegable. */
  abstract getTableDataTypes(sessionId: string): Observable<readonly string[]>;

  /**
   * Lo que el motor admite al definir un índice.
   *
   * El diseñador dibuja el formulario con esto en lugar de mirar el motor de la
   * conexión: así ofrece lo que hay sin saber contra qué está conectado.
   */
  abstract getTableCapabilities(sessionId: string): Observable<IndexCapabilities>;

  /** Índices, claves foráneas y demás restricciones de una tabla. */
  abstract getTableStructure(sessionId: string, table: DatabaseObject): Observable<TableStructure>;

  /**
   * Columnas y estructura de varias tablas en una sola petición.
   *
   * Es lo que hace posible el diagrama. Pedirlas de una en una serían sesenta
   * peticiones que además se turnarían con lo que el explorador y el editor
   * estén haciendo sobre la misma conexión.
   */
  abstract getSchemaGraph(
    sessionId: string,
    tables: readonly DatabaseObject[],
  ): Observable<SchemaGraph>;

  /**
   * El SQL que crearía la tabla, para enseñarlo antes de ejecutarlo.
   *
   * Va por su propia ruta y no como una bandera de {@link createTable}: ver y
   * ejecutar son cosas distintas, igual que en la edición de filas.
   */
  abstract previewCreateTable(sessionId: string, table: TableDesign): Observable<readonly string[]>;

  /** Crea la tabla. El servidor se niega si `confirmed` no llega. */
  abstract createTable(sessionId: string, table: TableDesign): Observable<TableChangeResult>;

  abstract previewAlterTable(
    sessionId: string,
    alteration: TableAlteration,
  ): Observable<readonly string[]>;

  /**
   * Aplica los cambios de estructura.
   *
   * `confirmedDestructive` es aparte porque borrar una columna se lleva sus
   * datos y ningún `ALTER` los devuelve.
   */
  abstract alterTable(
    sessionId: string,
    alteration: TableAlteration,
    confirmedDestructive: boolean,
  ): Observable<TableChangeResult>;

  // --- Conexiones guardadas -------------------------------------------------

  abstract getSavedConnections(): Observable<readonly SavedConnection[]>;

  /** Dónde se guardan las contraseñas, o por qué no se pueden guardar. */
  abstract getSecretStoreStatus(): Observable<SecretStoreStatus>;

  abstract saveConnection(request: SaveConnectionRequest): Observable<SavedConnection>;

  abstract updateConnection(
    id: string,
    request: SaveConnectionRequest,
  ): Observable<SavedConnection>;

  abstract deleteConnection(id: string): Observable<void>;

  /**
   * Abre sesión con un perfil guardado.
   *
   * Si no hay contraseña guardada, la API responde 428 y hay que pedírsela al
   * usuario y reintentar con `password`.
   */
  abstract openSavedSession(id: string, password?: string): Observable<SessionInfo>;

  // --- Historial y preferencias ---------------------------------------------

  abstract getHistory(search?: string): Observable<readonly QueryHistoryEntry[]>;

  abstract clearHistory(): Observable<void>;

  abstract getPreferences(): Observable<Readonly<Record<string, string>>>;

  /**
   * Pestañas abiertas la última vez, con lo que hubiera escrito sin ejecutar.
   *
   * Van y vienen todas juntas: son pocas y cambian a la vez, y reemplazar el
   * conjunto entero evita guardar un estado que nunca existió.
   */
  abstract getEditorTabs(): Observable<readonly StoredEditorTab[]>;

  abstract saveEditorTabs(tabs: readonly StoredEditorTab[]): Observable<void>;

  abstract setPreference(key: string, value: string): Observable<void>;

  /**
   * Fragmentos de SQL guardados, del último tocado al más antiguo.
   *
   * Van de uno en uno, al revés que las pestañas: son independientes entre sí y
   * guardar uno no puede tocar los demás.
   */
  abstract getSnippets(): Observable<readonly SavedSnippet[]>;

  /** Inserta o reemplaza según el identificador, que lo pone quien guarda. */
  abstract saveSnippet(snippet: SavedSnippet): Observable<void>;

  abstract deleteSnippet(id: string): Observable<void>;

  /**
   * Diagramas guardados de una conexión.
   *
   * Lo que se guarda son las decisiones de quien lo armó —qué tablas entran,
   * dónde están—, **nunca el esquema**: las columnas se releen del catálogo al
   * abrirlo, y por eso un diagrama de hace meses no miente.
   */
  abstract getDiagrams(connectionId: string): Observable<readonly SavedDiagram[]>;

  abstract saveDiagram(diagram: SavedDiagram): Observable<void>;

  abstract deleteDiagram(id: string): Observable<void>;

  /**
   * Exporta el resultado de una consulta.
   *
   * Se envía el SQL y no las filas que hay en pantalla: así se exporta el
   * resultado completo aunque la cuadrícula solo muestre las primeras.
   */
  abstract exportQuery(request: ExportRequest): Observable<Blob>;

  // --- Respaldos ------------------------------------------------------------

  /**
   * El guion que se escribiría, para enseñarlo antes de tocar nada.
   *
   * Va por su propia ruta y no como una bandera de {@link runBackup}, igual que
   * la vista previa de la edición de filas: ver y ejecutar son cosas distintas.
   */
  abstract previewBackup(request: BackupRequest): Observable<BackupPreview>;

  /**
   * Lanza el respaldo y devuelve su identificador.
   *
   * **No espera a que termine.** El trabajo sigue en el proceso local aunque se
   * cierre el asistente, y el progreso se pregunta con {@link getBackupStatus}.
   */
  abstract runBackup(request: BackupRequest): Observable<string>;

  abstract getBackupStatus(backupId: string): Observable<BackupProgress>;

  abstract cancelBackup(backupId: string): Observable<void>;

  /**
   * Los trabajos largos que hubo, con los que quedaron a medias entre ellos.
   *
   * Es lo único que sobrevive a cerrar Druse: los estados de respaldos,
   * restauraciones y traslados viven en la memoria del proceso local y se van con
   * él, que es justo cuando hace falta saber qué estaba corriendo.
   */
  abstract getJobs(): Observable<readonly JobSummary[]>;

  /**
   * El paquete de diagnóstico: los registros y un resumen de versión y sistema.
   *
   * Va saneado desde el proceso local —sin contraseñas, tokens, cadenas de
   * conexión, SQL ni datos de filas—, que es lo que permite mandarlo sin tener
   * que revisarlo antes.
   */
  abstract getDiagnostics(): Observable<Blob>;

  // --- Perfiles de respaldo -------------------------------------------------

  abstract getBackupProfiles(): Observable<readonly BackupProfile[]>;

  /**
   * Guarda uno nuevo o reemplaza el que traiga identificador.
   *
   * Renombrar es guardar con otro nombre y duplicar es guardar sin
   * identificador: tres botones en la pantalla, un solo camino aquí.
   */
  abstract saveBackupProfile(profile: BackupProfileInput): Observable<BackupProfile>;

  abstract deleteBackupProfile(profileId: string): Observable<void>;

  /**
   * Abre un perfil contra una sesión: qué de lo que pedía existe hoy y qué no.
   *
   * La sesión se pasa aparte de lo que el perfil recuerda porque llevarse la
   * estructura de producción a desarrollo es justo abrirlo contra otra.
   */
  abstract resolveBackupProfile(
    profileId: string,
    sessionId: string,
  ): Observable<BackupProfileResolution>;

  /** Anota que se acaba de lanzar, sin tocar nada más del perfil. */
  abstract markBackupProfileRun(profileId: string): Observable<void>;

  // --- Restauración ---------------------------------------------------------

  /**
   * Qué trae un artefacto y qué pasaría al aplicarlo aquí, **sin tocar nada**.
   *
   * Va por su propia ruta y no como un paso de restaurar, igual que la vista
   * previa del respaldo: entre mirar y aplicar está la única oportunidad de ver
   * qué se sobrescribe.
   */
  abstract inspectRestore(sessionId: string, path: string): Observable<RestoreInspection>;

  /**
   * Aplica el artefacto y devuelve el identificador de la operación.
   *
   * No espera a que termine: el trabajo sigue en el proceso local y el progreso
   * se pregunta con {@link getRestoreStatus}.
   */
  abstract runRestore(request: RestoreRequest): Observable<string>;

  abstract getRestoreStatus(restoreId: string): Observable<RestoreProgress>;

  abstract cancelRestore(restoreId: string): Observable<void>;

  // --- Traslado de datos entre tablas ---------------------------------------

  /**
   * Qué se copiaría y qué habría que mirar antes, **sin tocar el destino**.
   *
   * Va por su propia ruta y no como una bandera de {@link runTransfer}, igual
   * que la vista previa del respaldo: entre mirar y copiar está la única
   * oportunidad de ver a qué columna va cada columna.
   */
  abstract previewTransfer(request: TransferRequest): Observable<TransferPreview>;

  /**
   * Lanza el traslado y devuelve su identificador.
   *
   * **No espera a que termine.** El trabajo sigue en el proceso local aunque se
   * cierre el asistente, y el progreso se pregunta con
   * {@link getTransferStatus}. Aquí eso importa más que en un respaldo: lo que
   * queda a medias no es un archivo que se pueda tirar, sino filas en otra base.
   */
  abstract runTransfer(request: TransferRequest): Observable<string>;

  /**
   * Qué tipo tendría cada columna del origen en el motor de destino.
   *
   * Va por su propia ruta y no dentro de la vista previa porque **se pregunta
   * antes de que la tabla exista**: es justo lo que hay que leer para decidir si
   * crearla. Dentro del mismo motor devuelve vacío.
   */
  abstract translateTransferTypes(request: TransferRequest): Observable<readonly TypeTranslation[]>;

  /**
   * Crea en el destino una tabla con la forma de la de origen.
   *
   * Devuelve las instrucciones que se ejecutaron, para poder leerlas.
   */
  abstract createTransferTarget(request: TransferRequest): Observable<readonly string[]>;

  /**
   * En qué orden se copiarían las tablas de una pasada, y cuáles se apuntan
   * entre sí.
   *
   * Se pregunta antes de confirmar nada: quien va a mover doce tablas quiere
   * verlo en la vista previa y no en el aviso de un traslado que ya empezó.
   */
  abstract orderTransferSet(request: TransferSetRequest): Observable<TransferSetOrder>;

  /** Lanza la pasada entera y devuelve su identificador. Ver {@link runTransfer}. */
  abstract runTransferSet(request: TransferSetRequest): Observable<string>;

  // --- Migraciones guardadas ------------------------------------------------

  abstract getTransferProfiles(): Observable<readonly TransferProfile[]>;

  /** Guardar, renombrar y duplicar son lo mismo: cambia lo que se manda. */
  abstract saveTransferProfile(profile: TransferProfile): Observable<TransferProfile>;

  abstract deleteTransferProfile(profileId: string): Observable<void>;

  /**
   * Abre un perfil contra dos conexiones vivas.
   *
   * Devuelve lo que hoy se puede migrar **y lo que no**: un perfil de hace medio
   * año nombra tablas que alguien borró, y negarse a abrirlo obligaría a rehacerlo
   * entero.
   */
  abstract resolveTransferProfile(
    profileId: string,
    sourceSessionId: string,
    targetSessionId: string,
  ): Observable<TransferProfileResolution>;

  /** Anota que se acaba de lanzar. No modifica el resto del perfil. */
  abstract markTransferProfileRun(profileId: string): Observable<void>;

  abstract getTransferStatus(transferId: string): Observable<TransferProgress>;

  abstract cancelTransfer(transferId: string): Observable<void>;

  // --- Carpetas del equipo --------------------------------------------------

  /**
   * Lo que hay en una ruta, para poder elegir sin escribirla.
   *
   * Sin ruta devuelve por dónde se empieza: los sitios conocidos del usuario y
   * las unidades. Existe porque **el navegador no ve el sistema de archivos**:
   * quien corre dentro del envoltorio tiene el diálogo nativo y no pasa por
   * aquí.
   *
   * Por omisión solo trae carpetas, que es lo que hace falta para guardar. Con
   * `files` trae además los archivos de esas extensiones —para elegir cuál
   * abrir— y con `marker` señala las carpetas que llevan ese archivo dentro, que
   * es lo que distingue un respaldo por carpetas de una carpeta cualquiera.
   */
  abstract browseFolders(path?: string, options?: BrowseOptions): Observable<FolderListing>;

  /** Une carpeta y nombre, y dice si eso se puede escribir o ya existe. */
  abstract resolveFolderTarget(folder: string, name: string): Observable<FolderTarget>;

  /** Crea una carpeta dentro de otra, sin salir del selector. */
  abstract createFolder(parent: string, name: string): Observable<FolderTarget>;

  // --- Asistente -------------------------------------------------------------

  /** Proveedores configurados y dónde se guardan sus claves. */
  abstract getAiProviders(): Observable<AiProviderList>;

  /** Crea o actualiza un proveedor. La clave solo viaja de ida. */
  abstract saveAiProvider(request: SaveAiProviderRequest): Observable<AiProvider>;

  abstract deleteAiProvider(id: string): Observable<void>;

  /**
   * Comprueba que se llega al proveedor, con lo que hay escrito y sin guardarlo.
   *
   * Como «Probar conexión»: descubrir que la clave está mal cuando ya se ha
   * escrito la pregunta es descubrirlo tarde.
   */
  abstract testAiProvider(request: SaveAiProviderRequest): Observable<AiProbeResult>;

  /**
   * Los modelos que ese proveedor tiene desplegados.
   *
   * Evita tener que saberse de memoria el identificador exacto —`glm-5.2`,
   * `deepseek-v4-pro`—: escribirlo mal no se nota al guardar, sino en la primera
   * pregunta, con un 404 que no dice cuál era el bueno.
   */
  abstract listAiModels(request: SaveAiProviderRequest): Observable<AiModelList>;

  /** Si ese programa esta instalado y con sesion iniciada. */
  abstract getCliSession(command: string, profileId?: string): Observable<CliSessionState>;

  /**
   * Abre la consola donde el programa pide las credenciales.
   *
   * El inicio de sesion ocurre **en el programa**, no en Druse: no hay forma de
   * que una aplicacion de terceros autentique una cuenta de Claude o de ChatGPT.
   *
   * `manual` es la orden equivalente, con su variable de entorno dentro. Viene
   * siempre, porque abrir una ventana de consola es lo unico de todo esto que
   * depende del escritorio que haya delante: donde no se pueda, ensenarla es lo
   * que diferencia una funcion terminable a mano de un boton muerto.
   */
  abstract startCliLogin(command: string, profileId?: string): Observable<CliLaunch>;

  /**
   * Pregunta al asistente y devuelve la respuesta por trozos.
   *
   * Siempre en streaming, incluso para respuestas cortas: una que tarda veinte
   * segundos en llegar entera parece colgada, y la misma apareciendo palabra a
   * palabra no. Cancelar la suscripción corta la petición.
   */
  abstract streamAiChat(request: AiChatRequest): Observable<AiStreamEvent>;
}

/** Qué clase de sitio es una entrada del selector, para pintarle su icono. */
export type FolderKind = 'Folder' | 'Drive' | 'Known';

/** Qué se quiere ver al listar una carpeta. */
export interface BrowseOptions {
  /** Extensiones de archivo que se enumeran, sin el punto. */
  readonly files?: readonly string[];
  /** Archivo cuya presencia marca una subcarpeta. */
  readonly marker?: string;
}

/** Una carpeta que se puede elegir. */
export interface FolderEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: FolderKind;
  /** Lleva dentro el archivo señalado: es un respaldo, no una carpeta cualquiera. */
  readonly marked?: boolean;
}

/** Un archivo que se puede elegir para abrirlo. */
export interface FileEntry {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly modifiedUtc: string;
}

/** Lo que hay dentro de una carpeta y por dónde se sale de ella. */
export interface FolderListing {
  readonly path: string;
  readonly parent?: string | null;
  /** Separador de este sistema: `\` en Windows y `/` en el resto. */
  readonly separator: string;
  readonly folders: readonly FolderEntry[];
  /** Los archivos pedidos, del más reciente al más antiguo. */
  readonly files: readonly FileEntry[];
  readonly canWrite: boolean;
  /** Por qué no se pudo leer, cuando no se pudo. */
  readonly error?: string | null;
}

/** Un destino ya compuesto, con lo que pasaría al usarlo. */
export interface FolderTarget {
  readonly path: string;
  readonly canWrite: boolean;
  /** Ya hay algo con ese nombre: se sobrescribiría. */
  readonly exists: boolean;
  readonly problem?: string | null;
}

/** Cómo está repartido el artefacto que se restaura. */
export interface RestoreRequest {
  readonly sessionId: string;
  readonly path: string;
  /**
   * Base **nueva** donde volcarlo, si se pidió una.
   *
   * Ausente es lo de siempre: aplicarlo sobre la base abierta. Con un nombre, el
   * proceso local la crea y restaura dentro; si ya existiera, se niega.
   */
  readonly newDatabase?: string;
  /** Instrucción desde la que se sigue. Cero es empezar de nuevo. */
  readonly resumeFrom?: number;
  /**
   * La huella que devolvió la inspección de este artefacto.
   *
   * Sin ella el proceso local no restaura: es lo que distingue «aplica esto, que
   * lo he mirado» de «aplica lo que haya en esa ruta». Entre inspeccionar y
   * aceptar cabe que el archivo cambie.
   */
  readonly fingerprint?: string;
}

/** Una tabla del artefacto que ya existe en el destino. */
export interface RestoreCollision {
  readonly table: string;
  /** Filas que tiene hoy, estimadas por el catálogo. */
  readonly rows?: number;
}

/** Por qué no se puede restaurar. */
export type RestoreRefusal =
  'DifferentEngine' | 'UnknownFormat' | 'ReadOnlyConnection' | 'Unreadable';

export interface RestoreRejection {
  readonly reason: RestoreRefusal;
  /** Ya viene escrito para enseñarlo tal cual. */
  readonly message: string;
}

/** El manifiesto del artefacto, tal y como se enseña antes de aplicarlo. */
export interface RestoreManifest {
  readonly formatVersion: number;
  readonly engine: string;
  readonly serverVersion: string;
  readonly database?: string;
  readonly createdAt: string;
  readonly tables: number;
  readonly tablesWithData: number;
  readonly rows: number;
  readonly outcome: BackupOutcome;
  readonly consistentSnapshot: boolean;
}

export interface RestoreInspection {
  readonly path: string;
  readonly layout: BackupLayout;
  /** Huella de este artefacto al mirarlo. Se devuelve al restaurar. */
  readonly fingerprint: string;
  readonly compressed: boolean;
  readonly manifest?: RestoreManifest;
  readonly statements: number;
  readonly tables: readonly string[];
  readonly collisions: readonly RestoreCollision[];
  readonly rejections: readonly RestoreRejection[];
  readonly warnings: readonly BackupWarning[];
  /** De qué base venía el respaldo, si el manifiesto lo dice. */
  readonly sourceDatabase?: string;
  /** Las bases que ya hay en este servidor, para no proponer un nombre cogido. */
  readonly databases: readonly string[];
  readonly canRestore: boolean;
}

export type RestoreStep = 'Reading' | 'Checking' | 'Applying' | 'Done';

export type RestoreOutcome = 'Running' | 'Completed' | 'Failed' | 'Cancelled';

/** Dónde se paró una restauración. */
export interface RestoreFailure {
  /** Instrucción que falló, contando desde uno. Es desde donde se reanuda. */
  readonly index: number;
  readonly statement: string;
  readonly message: string;
}

export interface RestoreProgress {
  readonly id: string;
  readonly step: RestoreStep;
  readonly outcome: RestoreOutcome;
  readonly currentObject?: string;
  readonly statementsDone: number;
  readonly statementsTotal: number;
  readonly rowsWritten: number;
  readonly elapsedMilliseconds: number;
  /** Hasta dónde se aplicó. */
  readonly applied: number;
  readonly failure?: RestoreFailure;
  readonly warnings: readonly BackupWarning[];
}

/** Qué nombra una parte de la selección guardada. */
export type BackupSelectorKind = 'Schema' | 'Table';

/**
 * Una parte de lo que un perfil se lleva.
 *
 * Un esquema se guarda **como esquema**: lo que se cree dentro después también
 * entra. Marcar tablas sueltas guarda sus nombres, y esas son las que pueden
 * faltar al abrirlo meses más tarde.
 */
export interface BackupSelector {
  readonly kind: BackupSelectorKind;
  readonly schema: string;
  readonly name?: string;
}

/** Lo que se manda al guardar un perfil. */
export interface BackupProfileInput {
  /** Ausente al crear uno nuevo; presente al actualizar o renombrar. */
  readonly id?: string;
  readonly name: string;
  readonly connectionId?: string;
  readonly database?: string;
  readonly selection: readonly BackupSelector[];
  readonly dataMode: BackupDataMode;
  readonly dataOverrides?: Readonly<Record<string, BackupDataMode>>;
  readonly filters?: Readonly<Record<string, BackupFilter>>;
  readonly layout: BackupLayout;
  readonly dataFormat: BackupDataFormat;
  readonly compress: boolean;
  readonly destination: string;
  /** Las tablas que resolvía al guardarlo, para saber después qué ha crecido. */
  readonly knownTables?: readonly string[];
}

export interface BackupProfile extends BackupProfileInput {
  readonly id: string;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  /** Nulo mientras no se haya lanzado nunca. */
  readonly lastRunAtUtc?: string | null;
}

/** Algo que el perfil pedía y hoy no está. */
export interface BackupProfileGap {
  readonly selector: BackupSelector;
  /** Ya viene escrito para enseñarlo tal cual. */
  readonly reason: string;
}

/** Un perfil traído al presente. */
export interface BackupProfileResolution {
  readonly profile: BackupProfile;
  readonly tables: readonly BackupTable[];
  readonly gaps: readonly BackupProfileGap[];
  /** Tablas nuevas dentro de un esquema que se eligió entero. */
  readonly added: readonly string[];
}

/** Qué se lleva un respaldo de una tabla. */
export type BackupDataMode = 'StructureOnly' | 'StructureAndData' | 'DataOnly';

/** Cómo se reparte el respaldo en archivos. */
export type BackupLayout = 'SingleFile' | 'FolderByKind';

/** Cómo se escriben las filas. */
export type BackupDataFormat = 'Inserts' | 'Csv';

/** Qué filas y qué columnas de una tabla entran. */
export interface BackupFilter {
  /** Condición sin el `WHERE` delante. */
  readonly where?: string;
  readonly maxRows?: number;
  readonly excludedColumns?: readonly string[];
}

export interface BackupTable {
  readonly id: string;
  readonly name: string;
  readonly database?: string;
  readonly schema?: string;
  /** Filas estimadas por el catálogo. Sirve para la barra, y es aproximada. */
  readonly approximateRowCount?: number;
}

/** En qué quedó un trabajo largo, según lo que el proceso local anotó de él. */
export type JobState = 'Running' | 'Finished' | 'Interrupted';

export type JobKind = 'Backup' | 'Restore' | 'Transfer';

/** Un trabajo largo del pasado, tal y como lo cuenta el proceso local. */
export interface JobSummary {
  readonly id: string;
  readonly kind: JobKind;
  /** Sobre qué trabajaba: el destino, el artefacto, la tabla. */
  readonly subject?: string;
  readonly state: JobState;
  /** Cómo acabó, con las palabras de su propia operación. */
  readonly outcome?: string;
  readonly startedAtUtc: string;
  readonly finishedAtUtc?: string;
}

export interface BackupRequest {
  readonly sessionId: string;
  readonly tables: readonly BackupTable[];
  /** Lo que se aplica a las tablas que no digan otra cosa. */
  readonly dataMode: BackupDataMode;
  /** Tablas que se salen de la regla general, por su nombre calificado. */
  readonly dataOverrides?: Readonly<Record<string, BackupDataMode>>;
  readonly filters?: Readonly<Record<string, BackupFilter>>;
  readonly layout: BackupLayout;
  readonly dataFormat: BackupDataFormat;
  readonly compress: boolean;
  /**
   * Escribir sobre el respaldo que ya hubiera en la carpeta de destino.
   *
   * Solo lo mira la salida por carpetas: un archivo o un `.zip` los nombra el
   * usuario en el diálogo del sistema, que ya pregunta antes de reemplazar. Sin
   * esto, un segundo respaldo a la misma carpeta se rechaza en vez de mezclarse
   * con el anterior.
   */
  readonly overwrite?: boolean;
  /** Ruta elegida con el selector del sistema. La escribe el proceso local. */
  readonly destination: string;
}

export interface BackupPreview {
  readonly statements: readonly string[];
  /** Se alcanzó el tope: hay más instrucciones que no se enseñan. */
  readonly truncated: boolean;
  readonly warnings: readonly BackupWarning[];
}

export interface BackupWarning {
  readonly subject: string;
  readonly message: string;
}

export interface BackupFailure {
  readonly subject: string;
  readonly message: string;
  /** La instrucción que lo provocó, cuando la hubo. */
  readonly statement?: string;
}

/** En qué anda el respaldo. */
export type BackupStep =
  | 'Resolving'
  | 'ReadingStructure'
  | 'WritingStructure'
  | 'WritingData'
  | 'WritingConstraints'
  | 'Packaging'
  | 'Done';

/**
 * Cómo acabó.
 *
 * `CompletedWithWarnings` no es un verde limpio: el usuario tiene que saber que
 * lo que tiene no es la copia completa que pidió.
 */
export type BackupOutcome =
  'Running' | 'Completed' | 'CompletedWithWarnings' | 'Failed' | 'Cancelled';

export interface BackupProgress {
  readonly id: string;
  readonly step: BackupStep;
  readonly outcome: BackupOutcome;
  /** Objeto que se está escribiendo, con su nombre propio. */
  readonly currentObject?: string;
  readonly objectsDone: number;
  readonly objectsTotal: number;
  readonly rowsDone: number;
  /**
   * Filas que se esperan de la tabla en curso, estimadas por el catálogo.
   *
   * Ausente significa **barra indeterminada con contador**, no cero: una barra
   * que llega al 90 % y se queda ahí es peor que no tener barra.
   */
  readonly rowsEstimated?: number;
  readonly totalRows: number;
  readonly elapsedMilliseconds: number;
  readonly warnings: readonly BackupWarning[];
  readonly failure?: BackupFailure;
  /** Dónde quedó, cuando terminó bien. */
  readonly path?: string;
  readonly bytes?: number;
}

// --- Traslado de datos entre tablas -----------------------------------------

/** Una tabla de un lado del traslado. */
export interface TransferTable {
  readonly id: string;
  readonly name: string;
  readonly database?: string;
  readonly schema?: string;
  /** Filas estimadas por el catálogo. Sirve para la barra, y es aproximada. */
  readonly approximateRowCount?: number;
}

/** Qué columna del origen va a cuál del destino. `target` vacío es «no se copia». */
export interface ColumnMapping {
  readonly source: string;
  readonly target: string | null;
}

/** Qué hace el traslado con lo que ya está en el destino. */
export type TransferMode = 'Insert' | 'Replace' | 'Upsert' | 'SkipExisting';

export interface TransferRequest {
  readonly sourceSessionId: string;
  readonly source: TransferTable;
  readonly targetSessionId: string;
  readonly target: TransferTable;
  readonly filter?: BackupFilter;
  /** Vacío significa emparejar por nombre. */
  readonly mappings?: readonly ColumnMapping[];
  readonly mode: TransferMode;
  /**
   * Qué columnas del destino identifican una fila.
   *
   * Vacío significa la clave primaria del destino. Solo se mira en los modos que
   * tienen que reconocer lo que ya está.
   */
  readonly keyColumns?: readonly string[];
  /** Tipos escritos a mano al crear la tabla, por columna del origen. */
  readonly typeOverrides?: Readonly<Record<string, string>>;
  /** Todos los lotes en una transacción. No es lo normal: ver el servicio. */
  readonly atomic: boolean;
  readonly batchSize: number;
  /** Copiar también los valores que genera el motor. */
  readonly keepIdentity: boolean;
  readonly confirmed: boolean;
  /** El nombre de la tabla escrito a mano, solo para `Replace`. */
  readonly replaceConfirmation?: string;
}

/** Varias tablas trasladadas en una pasada. */
export interface TransferSetRequest {
  readonly tables: readonly TransferRequest[];
  /**
   * Ordenar por las claves foráneas del destino: las padres antes que las hijas.
   *
   * Encendido salvo que se diga lo contrario, porque copiar una hija antes que su
   * padre es el rechazo más previsible de todos.
   */
  readonly ordered?: boolean;
}

/**
 * Una migración guardada para repetirla.
 *
 * Guarda **nombres** —conexión, base, esquema y tablas—, nunca identificadores de
 * sesión: se reabre meses después, cuando aquella sesión hace mucho que se cerró.
 */
export interface TransferProfile {
  /** Ausente al crear: lo pone el proceso local. */
  readonly id?: string;
  readonly name: string;
  readonly sourceConnectionId?: string;
  readonly sourceDatabase?: string;
  readonly sourceSchema?: string;
  readonly targetConnectionId?: string;
  readonly targetDatabase?: string;
  readonly targetSchema?: string;
  readonly tables: readonly string[];
  readonly mode: TransferMode;
  /** Lo que cada tabla hace distinto, por su nombre. Lo demás sigue a la pasada. */
  readonly tableOptions?: Readonly<Record<string, TransferTableOptions>>;
  readonly ordered: boolean;
  readonly atomic: boolean;
  readonly keepIdentity: boolean;
  readonly batchSize: number;
  readonly createdAtUtc?: string;
  readonly updatedAtUtc?: string;
  readonly lastRunAtUtc?: string | null;
}

/** Lo que una tabla concreta hace distinto del resto de la pasada. */
export interface TransferTableOptions {
  /** Su modo, o ausente para seguir el de la pasada. */
  readonly mode?: TransferMode;
  /** Su condición, sin `WHERE` delante. */
  readonly where?: string;
  /**
   * Con qué columnas se reconoce una fila que ya está.
   *
   * Vacío significa la clave primaria del destino. Es por tabla porque cada una
   * tiene la suya.
   */
  readonly keyColumns?: readonly string[];
}

/** Una tabla del perfil que hoy existe a los dos lados. */
export interface TransferProfilePair {
  readonly source: TransferTable;
  readonly target: TransferTable;
}

/** Lo que el perfil pedía y hoy no se puede migrar. */
export interface TransferProfileGap {
  readonly table: string;
  readonly reason: string;
}

/** El perfil traído al presente: lo que se puede migrar hoy, y lo que no. */
export interface TransferProfileResolution {
  readonly profile: TransferProfile;
  readonly tables: readonly TransferProfilePair[];
  readonly gaps: readonly TransferProfileGap[];
  readonly hasChanges: boolean;
}

/** En qué orden se copiarían las tablas, y cuáles se apuntan entre sí. */
export interface TransferSetOrder {
  /** Nombres calificados, en el orden en que se copiarían. */
  readonly tables: readonly string[];
  /** Las que están en un ciclo y van sin ordenar. Vacío es lo normal. */
  readonly cycles: readonly string[];
}

/**
 * Cuánto se conserva de un tipo al llevarlo a otro motor.
 *
 * `Approximate` es el caso que hay que leer: los datos caben, pero algo del tipo
 * no viaja. `None` es el que impide crear la tabla.
 */
export type TranslationFidelity = 'Exact' | 'Approximate' | 'None';

/** Cómo queda una columna al cambiar de motor. */
export interface TypeTranslation {
  readonly column: string;
  readonly sourceType: string;
  readonly targetType: string;
  readonly fidelity: TranslationFidelity;
  /** Qué se pierde. Ausente cuando no se pierde nada. */
  readonly note?: string;
}

export interface TransferIssue {
  readonly column: string;
  readonly message: string;
}

export interface TransferPreview {
  readonly mappings: readonly ColumnMapping[];
  /** Columnas obligatorias del destino que no llena nadie. */
  readonly missingRequired: readonly string[];
  /** Columnas del origen que no van a ninguna parte. */
  readonly unmatchedSource: readonly string[];
  readonly issues: readonly TransferIssue[];
  readonly rowsEstimated?: number;
  /** La consulta con la que se leerá el origen. */
  readonly select: string;
  readonly statements: readonly string[];
  /** Con qué columnas se reconoce una fila que ya está, ya resueltas. */
  readonly keyColumns: readonly string[];
  /** Qué tipo tendría cada columna al otro lado. Vacío dentro del mismo motor. */
  readonly translations: readonly TypeTranslation[];
}

export type TransferStep = 'ReadingStructure' | 'ClearingTarget' | 'CopyingRows' | 'Done';

export type TransferOutcome =
  'Running' | 'Completed' | 'CompletedWithWarnings' | 'Failed' | 'Cancelled';

export interface TransferFailure {
  readonly message: string;
  /** Filas confirmadas en el destino antes del fallo. */
  readonly rowsCommitted: number;
  readonly statement?: string;
}

export interface TransferProgress {
  readonly id: string;
  readonly step: TransferStep;
  readonly outcome: TransferOutcome;
  readonly currentObject?: string;
  readonly rowsCopied: number;
  /**
   * Estimación del catálogo, ausente cuando no la hay.
   *
   * Ausente significa **barra indeterminada con contador**, no cero.
   */
  readonly rowsEstimated?: number;
  readonly rowsSkipped: number;
  /** Filas de la tabla en curso; `rowsCopied` es el total de la pasada. */
  readonly tableRowsCopied: number;
  readonly tablesDone: number;
  /** Uno cuando se traslada una sola tabla, que sigue siendo lo corriente. */
  readonly tablesTotal: number;
  readonly batchesDone: number;
  readonly elapsedMilliseconds: number;
  readonly warnings: readonly BackupWarning[];
  readonly failure?: TransferFailure;
}

export type ExportFormat = 'csv' | 'xlsx';

export interface ExportRequest {
  readonly sessionId: string;
  readonly sql: string;
  readonly database?: string;
  readonly format: ExportFormat;
  readonly fileName?: string;
  /** `utf8bom`, `utf8` o `latin1`. Solo aplica a CSV. */
  readonly encoding?: string;
  readonly delimiter?: string;
  readonly includeHeaders?: boolean;
  readonly nullText?: string;
  readonly confirmDestructive?: boolean;
}

/** Datos para guardar un perfil. La contraseña solo viaja de ida. */
export interface SaveConnectionRequest {
  readonly profile: ConnectRequest['profile'];
  readonly password?: string;
  /** El usuario pidió recordar la contraseña. */
  readonly storePassword: boolean;
  /** Secreto del túnel, para el almacén del sistema. */
  readonly sshSecret?: string;
  /** El usuario pidió recordar el secreto del túnel. */
  readonly storeSshSecret?: boolean;
}
