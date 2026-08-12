/**
 * Modelos de presentación del shell.
 *
 * Son deliberadamente independientes de los DTO de la API: describen lo que la
 * pantalla necesita mostrar. El gateway traduce entre ambos, de modo que un
 * cambio en el contrato no arrastre a los componentes.
 */

/** Motores soportados. Nunca se ramifica por motor dentro de los componentes. */
export type DatabaseEngine = 'postgresql' | 'sqlserver' | 'mysql';

export type ConnectionState = 'connected' | 'disconnected' | 'connecting' | 'error';

/** Motor disponible, según lo que declara la API. */
export interface EngineInfo {
  readonly id: DatabaseEngine;
  readonly name: string;
  readonly defaultPort: number;
}

/** Entorno al que apunta una conexión. Cambia su color y sus advertencias. */
export type ConnectionEnvironment = 'development' | 'testing' | 'production';

/**
 * Perfil guardado en la base local.
 *
 * Nunca lleva contraseña: solo si hay una guardada, que es lo que hace falta
 * para decidir si pedirla al conectar.
 */
export interface SavedConnection {
  readonly id: string;
  readonly name: string;
  readonly engine: DatabaseEngine;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly environment: ConnectionEnvironment;
  readonly readOnly: boolean;
  readonly hasStoredPassword: boolean;
}

/** Dónde se guardan las contraseñas en esta máquina. */
export interface SecretStoreStatus {
  readonly available: boolean;
  readonly description: string;
}

/** Entrada del historial local de ejecuciones. */
export interface QueryHistoryEntry {
  readonly id: string;
  readonly connectionId?: string;
  readonly connectionName: string;
  readonly database: string;
  readonly sql: string;
  readonly executedAtUtc: string;
  readonly durationMs: number;
  readonly succeeded: boolean;
  readonly rowCount?: number;
  readonly errorMessage?: string;
}

/** Perfil de conexión tal y como se dibuja en la barra lateral. */
export interface ConnectionSummary {
  readonly id: string;
  readonly name: string;
  readonly engine: DatabaseEngine;
  readonly state: ConnectionState;
  readonly expanded: boolean;
  /** Presente mientras hay una sesión abierta. */
  readonly sessionId?: string;
  /** Motivo del último fallo, para mostrarlo junto a la conexión. */
  readonly error?: string;
  readonly environment: ConnectionEnvironment;
  readonly readOnly: boolean;
  /** El perfil está guardado en la base local y sobrevive al reinicio. */
  readonly saved: boolean;
  readonly hasStoredPassword: boolean;
  readonly database: string;
}

/** Datos con los que se abre o se guarda una conexión. */
export interface ConnectionForm {
  /** Presente al editar un perfil ya guardado. */
  readonly id?: string;
  readonly name: string;
  readonly engine: DatabaseEngine;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly readOnly: boolean;
  readonly environment: ConnectionEnvironment;
  /** Guardar el perfil en la base local. */
  readonly save: boolean;
  /** Recordar la contraseña en el almacén del sistema. */
  readonly storePassword: boolean;
}

export interface SessionInfo {
  readonly sessionId: string;
  readonly engine: DatabaseEngine;
  readonly serverVersion: string;
  readonly database: string;
  readonly readOnly: boolean;
}

export interface TestConnectionResult {
  readonly succeeded: boolean;
  readonly serverVersion?: string;
  readonly errorMessage?: string;
  readonly errorCode?: string;
  readonly durationMs: number;
}

/** Clase de objeto dentro del explorador. Determina el icono y las acciones. */
export type DatabaseObjectKind =
  | 'folder'
  | 'database'
  | 'schema'
  | 'table'
  | 'view'
  | 'function'
  | 'procedure'
  | 'column';

/** Nodo tal y como lo devuelve la API. */
export interface DatabaseObject {
  readonly id: string;
  readonly name: string;
  readonly kind: DatabaseObjectKind;
  readonly database?: string;
  readonly schema?: string;
  readonly hasChildren: boolean;
  readonly approximateRowCount?: number;
}

export interface DatabaseColumn {
  readonly name: string;
  readonly dataType: string;
  readonly isNullable: boolean;
  readonly isPrimaryKey: boolean;
  readonly defaultValue?: string;
  readonly ordinal: number;
}

/**
 * Nodo del explorador ya aplanado para pintarlo.
 *
 * El árbol se aplana porque la lista necesita una secuencia; el nivel se resuelve
 * con `depth`.
 */
export interface ExplorerNode {
  readonly id: string;
  readonly label: string;
  readonly kind: DatabaseObjectKind;
  readonly depth: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  /** Se están pidiendo sus hijos. */
  readonly loading: boolean;
  readonly badge?: string;
  readonly selected?: boolean;
  readonly hint?: string;
  /** Objeto original, para volver a pedir sus hijos. */
  readonly source: DatabaseObject;
  /** Conexión a la que pertenece. */
  readonly connectionId: string;
}

/** Tabla o vista conocida, para el autocompletado. */
export interface KnownRelation {
  readonly schema: string;
  readonly name: string;
  readonly kind: 'table' | 'view';
  /** Nombre calificado tal y como se escribiría en la consulta. */
  readonly qualified: string;
  /** Columnas, si el usuario llegó a expandirla. */
  readonly columns: readonly string[];
}

/**
 * Lo que el editor sabe del esquema.
 *
 * Contiene solo lo que el explorador ya cargó: sugerir lo que no se ha pedido
 * exigiría consultar el catálogo en cada pulsación.
 */
export interface SchemaIndex {
  readonly schemas: readonly string[];
  readonly relations: readonly KnownRelation[];
}

/** Pestaña de consulta abierta. */
export interface QueryTab {
  readonly id: string;
  readonly title: string;
  readonly active: boolean;
  readonly dirty: boolean;
  readonly sql: string;
  /** Conexión contra la que se ejecuta. */
  readonly connectionId?: string;
}

export type ColumnType = 'number' | 'text' | 'boolean' | 'timestamp' | 'uuid' | 'binary';

/** Columna de un conjunto de resultados. */
export interface ResultColumn {
  readonly name: string;
  readonly dataType: string;
  readonly kind: ColumnType;
  /** Ancho en píxeles; `null` reparte el espacio sobrante. */
  readonly width: number | null;
  readonly sorted?: 'asc' | 'desc';
  readonly filter?: string;
}

/**
 * Fila de resultados.
 *
 * `null` se distingue de la cadena vacía porque debe mostrarse de forma
 * diferenciada (plan §6).
 */
export interface ResultRow {
  readonly number: number;
  readonly values: readonly (string | null)[];
}

export interface ResultSet {
  readonly columns: readonly ResultColumn[];
  readonly rows: readonly ResultRow[];
  readonly totalRows: number;
  readonly durationMs: number;
  /** Se alcanzó el límite de filas y quedaron más sin leer. */
  readonly truncated: boolean;
}

export type QueryState = 'succeeded' | 'failed' | 'canceled' | 'running';

export interface QueryMessage {
  readonly text: string;
  readonly severity: 'info' | 'warning' | 'error';
}

export interface QueryError {
  readonly message: string;
  readonly code?: string;
  readonly position?: number;
  readonly line?: number;
}

export interface QueryResult {
  readonly executionId: string;
  readonly state: QueryState;
  readonly resultSets: readonly ResultSet[];
  readonly messages: readonly QueryMessage[];
  readonly rowsAffected?: number;
  readonly durationMs: number;
  readonly error?: QueryError;
}

/** Estado de la sesión que se refleja en la barra inferior. */
export interface SessionStatus {
  readonly connected: boolean;
  readonly engine: DatabaseEngine;
  readonly engineVersion: string;
  readonly database: string;
  readonly user: string;
  readonly lastDurationMs: number | null;
}
