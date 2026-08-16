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
  TestConnectionResult,
} from '../../shared/models/workspace';

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
  readonly reason: 'readonlyconnection' | 'unconfirmeddestructive' | 'emptystatement';
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

  /** Prueba unas credenciales sin abrir sesión ni guardarlas. */
  abstract testConnection(request: ConnectRequest): Observable<TestConnectionResult>;

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
  abstract getTableStructure(
    sessionId: string,
    table: DatabaseObject,
  ): Observable<TableStructure>;

  /**
   * El SQL que crearía la tabla, para enseñarlo antes de ejecutarlo.
   *
   * Va por su propia ruta y no como una bandera de {@link createTable}: ver y
   * ejecutar son cosas distintas, igual que en la edición de filas.
   */
  abstract previewCreateTable(
    sessionId: string,
    table: TableDesign,
  ): Observable<readonly string[]>;

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
   * Exporta el resultado de una consulta.
   *
   * Se envía el SQL y no las filas que hay en pantalla: así se exporta el
   * resultado completo aunque la cuadrícula solo muestre las primeras.
   */
  abstract exportQuery(request: ExportRequest): Observable<Blob>;
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
