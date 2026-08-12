import { Observable } from 'rxjs';

import {
  DatabaseColumn,
  DatabaseEngine,
  DatabaseObject,
  EngineInfo,
  QueryHistoryEntry,
  QueryResult,
  SavedConnection,
  SecretStoreStatus,
  SessionInfo,
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
    readonly readOnly?: boolean;
    readonly sslMode?: string;
    readonly connectTimeoutSeconds?: number;
  };
  readonly password?: string;
}

export interface ExecuteQueryRequest {
  readonly sessionId: string;
  readonly sql: string;

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

  /**
   * Ejecuta SQL.
   *
   * Un rechazo por instrucción destructiva o por conexión de solo lectura llega
   * como error HTTP 409 con cuerpo {@link QueryRejected}, no como excepción de
   * transporte: es una respuesta legítima que la interfaz debe saber tratar.
   */
  abstract executeQuery(request: ExecuteQueryRequest): Observable<QueryResult>;

  abstract cancelQuery(executionId: string): Observable<void>;

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
}

/** Datos para guardar un perfil. La contraseña solo viaja de ida. */
export interface SaveConnectionRequest {
  readonly profile: ConnectRequest['profile'];
  readonly password?: string;
  /** El usuario pidió recordar la contraseña. */
  readonly storePassword: boolean;
}
