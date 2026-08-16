/**
 * Modelos de presentación del shell.
 *
 * Son deliberadamente independientes de los DTO de la API: describen lo que la
 * pantalla necesita mostrar. El gateway traduce entre ambos, de modo que un
 * cambio en el contrato no arrastre a los componentes.
 */

/** Motores soportados. Nunca se ramifica por motor dentro de los componentes. */
export type DatabaseEngine = 'postgresql' | 'sqlserver' | 'mysql' | 'informix';

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
 * Cómo se identifica el usuario ante el motor.
 *
 * `windows` usa la identidad de la sesión de Windows: no hay usuario ni
 * contraseña que escribir, ni que guardar. Solo la admite SQL Server.
 */
export type AuthenticationMode = 'password' | 'windows';

/**
 * Exigencia de cifrado del transporte hasta el motor.
 *
 * `prefer` cifra si el servidor lo ofrece y acepta su certificado sin
 * verificarlo; `require` no se conforma con menos que un certificado válido.
 * Es independiente del túnel SSH: uno protege el camino hasta el servidor
 * intermedio y el otro, la conversación con la base.
 */
export type SslMode = 'disable' | 'prefer' | 'require';

/**
 * Cómo se identifica Druse ante el servidor SSH intermedio.
 *
 * Nada que ver con {@link AuthenticationMode}: el servidor de salto y la base de
 * datos son dos sistemas distintos, con dos cuentas distintas.
 */
export type SshAuthenticationMode = 'password' | 'privatekey' | 'keyboardinteractive';

/**
 * Servidor intermedio por el que viaja la conexión.
 *
 * Nunca lleva contraseña ni passphrase: esos secretos van aparte, igual que los
 * de la base.
 */
export interface SshTunnel {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly authentication: SshAuthenticationMode;
  /** Ruta del archivo de clave privada. Solo con `privatekey`. */
  readonly privateKeyPath: string;
  readonly connectTimeoutSeconds?: number;
}

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
  readonly authentication: AuthenticationMode;
  readonly environment: ConnectionEnvironment;
  readonly readOnly: boolean;
  readonly hasStoredPassword: boolean;
  readonly sslMode: SslMode;
  /** Ausente cuando la conexión va directa al motor. */
  readonly sshTunnel?: SshTunnel;
  readonly hasStoredSshSecret?: boolean;
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
  /**
   * La sesión se perdió sola: el servidor la cerró, se cayó la red o el proceso
   * local se reinició.
   *
   * Se distingue de un error cualquiera porque tiene una salida concreta —volver
   * a abrirla— y porque el usuario no hizo nada para provocarlo.
   */
  readonly lost?: boolean;
  readonly environment: ConnectionEnvironment;
  readonly readOnly: boolean;
  /** El perfil está guardado en la base local y sobrevive al reinicio. */
  readonly saved: boolean;
  readonly hasStoredPassword: boolean;
  readonly database: string;
  /** Sin contraseña que pedir cuando es `windows`. */
  readonly authentication: AuthenticationMode;
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
  /** Vacío cuando {@link authentication} es `windows`. */
  readonly username: string;
  /**
   * Vacía cuando {@link authentication} es `windows`.
   *
   * Ausente significa «no la toques»: es lo que se envía al editar un perfil sin
   * escribir una contraseña nueva, porque el formulario nunca puede mostrar la
   * que ya está guardada. La cadena vacía sí la retira.
   */
  readonly password?: string;
  readonly authentication: AuthenticationMode;
  readonly sslMode: SslMode;
  readonly readOnly: boolean;
  readonly environment: ConnectionEnvironment;
  /** Guardar el perfil en la base local. */
  readonly save: boolean;
  /** Recordar la contraseña en el almacén del sistema. */
  readonly storePassword: boolean;
  /** Servidor intermedio, o ausente para ir directo al motor. */
  readonly sshTunnel?: SshTunnel;
  /** Contraseña del usuario SSH, o passphrase de su clave privada. */
  readonly sshSecret?: string;
  /** Código de un solo uso del servidor SSH. Nunca se guarda. */
  readonly sshVerificationCode?: string;
  /** Recordar el secreto del túnel en el almacén del sistema. */
  readonly storeSshSecret?: boolean;
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
  'folder' | 'database' | 'schema' | 'table' | 'view' | 'function' | 'procedure' | 'column';

/** Nodo tal y como lo devuelve la API. */
export interface DatabaseObject {
  readonly id: string;
  readonly name: string;
  readonly kind: DatabaseObjectKind;
  readonly database?: string;
  readonly schema?: string;
  /** Tipo completo cuando el objeto es una columna. */
  readonly dataType?: string;
  readonly hasChildren: boolean;
  readonly approximateRowCount?: number;
}

export interface DatabaseColumn {
  readonly name: string;
  readonly dataType: string;
  readonly isNullable: boolean;
  readonly isPrimaryKey: boolean;
  readonly isGenerated?: boolean;
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

/**
 * Columna conocida por el editor.
 *
 * Lleva el tipo y no solo el nombre porque de eso viven las tres ayudas del
 * editor: el tipo a la derecha del desplegable, el tooltip al pasar el ratón y
 * el aviso de una columna que no existe.
 */
export interface KnownColumn {
  readonly name: string;
  readonly dataType: string;
  readonly isNullable: boolean;
  readonly isPrimaryKey: boolean;
  readonly isGenerated?: boolean;
  /** Expresión que ejecuta el servidor; no es un valor literal para copiar. */
  readonly defaultValue?: string | null;
}

/** Tabla o vista conocida, para el autocompletado. */
export interface KnownRelation {
  readonly connectionId?: string;
  readonly connectionName?: string;
  readonly database?: string;
  readonly schema: string;
  readonly name: string;
  readonly kind: 'table' | 'view';
  /** Nombre calificado tal y como se escribiría en la consulta. */
  readonly qualified: string;
  /** Columnas, si alguien las pidió ya. Vacío no significa «no tiene». */
  readonly columns: readonly KnownColumn[];
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

/**
 * Columna tal y como la describe quien diseña la tabla.
 *
 * No es {@link DatabaseColumn}: aquella cuenta lo que el motor ya tiene, y esta
 * lo que se quiere que tenga.
 */
export interface TableColumnDesign {
  readonly name: string;
  /** Tipo en el dialecto del motor, tal y como se escribirá. */
  readonly dataType: string;
  readonly isNullable: boolean;
  readonly isPrimaryKey: boolean;
  /** El motor genera el valor: identidad, serial o autoincremento. */
  readonly isIdentity: boolean;
  /** Expresión por omisión, ya escrita en SQL. */
  readonly defaultValue?: string;
}

/** Sentido en el que se recorre una columna dentro de un índice. */
export type IndexDirection = 'asc' | 'desc';

/** Qué hace el motor con las filas hijas cuando la padre se borra o cambia. */
export type ForeignKeyAction = 'noAction' | 'cascade' | 'setNull' | 'setDefault';

export interface IndexColumnDesign {
  readonly name: string;
  readonly direction: IndexDirection;
}

/** Índice que se quiere tener. */
export interface IndexDesign {
  readonly name: string;
  readonly columns: readonly IndexColumnDesign[];
  readonly isUnique: boolean;
  /** Columnas guardadas en la hoja sin formar parte de la clave. */
  readonly includedColumns?: readonly string[];
  /** Condición que limita las filas indizadas, ya escrita en SQL. */
  readonly filter?: string;
  /** Estructura del índice cuando el motor ofrece varias. */
  readonly method?: string;
}

export interface ForeignKeyDesign {
  readonly name: string;
  readonly columns: readonly string[];
  readonly referencedSchema?: string;
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly onDelete: ForeignKeyAction;
  readonly onUpdate: ForeignKeyAction;
}

export interface UniqueConstraintDesign {
  readonly name: string;
  readonly columns: readonly string[];
}

export interface CheckConstraintDesign {
  readonly name: string;
  readonly expression: string;
}

export interface PrimaryKeyDesign {
  readonly name?: string;
  readonly columns: readonly string[];
}

/**
 * Lo que el motor admite al definir un índice.
 *
 * El formulario se dibuja a partir de esto y nunca preguntando por el motor: es
 * lo que permite ofrecer `INCLUDE` donde existe sin que la vista sepa contra qué
 * está conectada.
 */
export interface IndexCapabilities {
  readonly supportsIncludedColumns: boolean;
  readonly supportsFilter: boolean;
  readonly supportsSortDirection: boolean;
  readonly supportsCheckConstraints: boolean;
  readonly methods: readonly string[];
  readonly foreignKeyActions: readonly ForeignKeyAction[];
}

/** Índice tal y como está hoy en el catálogo. */
export interface DatabaseIndex {
  readonly name: string;
  readonly columns: readonly IndexColumnDesign[];
  readonly isUnique: boolean;
  /** Lo sostiene una restricción: no se puede borrar suelto. */
  readonly isConstraintIndex: boolean;
  readonly isPrimaryKey: boolean;
  readonly includedColumns: readonly string[];
  readonly filter?: string;
  readonly method?: string;
}

export interface DatabaseForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly referencedSchema?: string;
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly onDelete: ForeignKeyAction;
  readonly onUpdate: ForeignKeyAction;
}

/** Restricción leída del catálogo. `expression` solo la traen las de comprobación. */
export interface DatabaseConstraint {
  readonly name: string;
  readonly columns: readonly string[];
  readonly expression?: string;
}

/** Todo lo que sostiene una tabla además de sus columnas. */
/** Por dónde entra o sale un valor de un procedimiento. */
export type RoutineParameterDirection = 'input' | 'output' | 'inputOutput' | 'return';

export interface RoutineParameter {
  readonly name: string;
  readonly dataType: string;
  readonly direction: RoutineParameterDirection;
  readonly ordinal: number;

  /** Se puede omitir porque el motor pone un valor. */
  readonly hasDefault: boolean;
}

/** Lo que hace falta para poder llamar a un procedimiento. */
export interface RoutineSignature {
  readonly name: string;
  readonly schema?: string;
  readonly isFunction: boolean;
  readonly parameters: readonly RoutineParameter[];
  readonly returnType?: string;
}

export interface TableStructure {
  readonly primaryKey?: DatabaseConstraint;
  readonly indexes: readonly DatabaseIndex[];
  readonly foreignKeys: readonly DatabaseForeignKey[];
  readonly uniqueConstraints: readonly DatabaseConstraint[];
  readonly checkConstraints: readonly DatabaseConstraint[];
}

/** Tabla que se va a crear. */
export interface TableDesign {
  readonly database?: string;
  readonly schema?: string;
  readonly name: string;
  readonly columns: readonly TableColumnDesign[];
  readonly indexes?: readonly IndexDesign[];
  readonly foreignKeys?: readonly ForeignKeyDesign[];
  readonly uniqueConstraints?: readonly UniqueConstraintDesign[];
  readonly checkConstraints?: readonly CheckConstraintDesign[];
}

/** Columna existente y cómo debe quedar; si el nombre cambia, es un renombrado. */
export interface ColumnAlteration {
  readonly currentName: string;
  readonly column: TableColumnDesign;
}

/**
 * Cambios pedidos sobre una tabla que ya existe.
 *
 * Son operaciones explícitas y no la tabla resultante: comparar el antes con el
 * después obligaría a adivinar qué pasó con cada columna, y adivinar mal
 * significa borrar una que solo se había renombrado.
 */
export interface TableAlteration {
  readonly table: DatabaseObject;
  readonly newName?: string;
  readonly addedColumns: readonly TableColumnDesign[];
  readonly alteredColumns: readonly ColumnAlteration[];
  readonly droppedColumns: readonly string[];

  readonly addedIndexes?: readonly IndexDesign[];
  /** Índices que se rehacen: se borra el actual y se crea el nuevo. */
  readonly alteredIndexes?: readonly IndexAlteration[];
  readonly droppedIndexes?: readonly string[];

  readonly addedForeignKeys?: readonly ForeignKeyDesign[];
  readonly droppedForeignKeys?: readonly string[];

  readonly addedUniqueConstraints?: readonly UniqueConstraintDesign[];
  readonly droppedUniqueConstraints?: readonly string[];

  readonly addedCheckConstraints?: readonly CheckConstraintDesign[];
  readonly droppedCheckConstraints?: readonly string[];

  readonly newPrimaryKey?: PrimaryKeyDesign;
  readonly droppedPrimaryKeyName?: string;
}

/** Índice existente y cómo debe quedar. */
export interface IndexAlteration {
  readonly currentName: string;
  readonly index: IndexDesign;
}

/** Un cambio pendiente sobre una celda. `null` es NULL. */
export interface CellEdit {
  /** Número de fila dentro del resultado que se está viendo. */
  readonly row: number;
  readonly column: string;
  readonly value: string | null;
}

/**
 * Tabla sobre la que se puede editar el resultado que hay en pantalla.
 *
 * Solo existe cuando el resultado viene de una tabla concreta y su clave
 * primaria está entre las columnas: sin eso no hay forma de señalar una fila.
 */
export interface EditableTable {
  readonly table: DatabaseObject;
  readonly keyColumns: readonly string[];
}

/** Pestaña de consulta abierta. */
export interface QueryTab {
  readonly id: string;
  readonly title: string;
  readonly active: boolean;
  readonly dirty: boolean;
  readonly sql: string;
  /** Identificador opaco del archivo conservado por el host de escritorio. */
  readonly documentId?: string;
  readonly fileName?: string;
  /** Conexión contra la que se ejecuta. */
  readonly connectionId?: string;
  /** Base contra la que se ejecuta, si la pestaña nació del explorador. */
  readonly database?: string;
  /**
   * Tabla de la que salió la pestaña, cuando se abrió desde el explorador.
   *
   * Es lo que permite editar su resultado: sin saber de qué tabla vienen las
   * filas no hay a dónde escribir. Una consulta escrita a mano no la tiene.
   */
  readonly sourceTable?: DatabaseObject;
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
