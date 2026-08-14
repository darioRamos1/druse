import { Observable } from 'rxjs';

import {
  AuthenticationMode,
  DatabaseColumn,
  DatabaseEngine,
  DatabaseObject,
  EngineInfo,
  QueryHistoryEntry,
  QueryResult,
  SavedConnection,
  SecretStoreStatus,
  SessionInfo,
  SshTunnel,
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

  /**
   * Ejecuta SQL.
   *
   * Un rechazo por instrucción destructiva o por conexión de solo lectura llega
   * como error HTTP 409 con cuerpo {@link QueryRejected}, no como excepción de
   * transporte: es una respuesta legítima que la interfaz debe saber tratar.
   */
  abstract executeQuery(request: ExecuteQueryRequest): Observable<QueryResult>;

  abstract cancelQuery(executionId: string): Observable<void>;

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
