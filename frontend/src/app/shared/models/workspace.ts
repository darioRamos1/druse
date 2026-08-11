/**
 * Modelos de presentación del shell.
 *
 * Son deliberadamente independientes de los DTO de la API: describen lo que la
 * pantalla necesita mostrar, no lo que el backend devuelve. Cuando exista el
 * cliente generado por OpenAPI (Fase 2) se traducirá hacia estos tipos, para que
 * un cambio en el contrato no arrastre a los componentes.
 */

/** Motores soportados. Nunca se ramifica por motor dentro de los componentes. */
export type DatabaseEngine = 'postgresql' | 'sqlserver' | 'mysql';

export type ConnectionState = 'connected' | 'disconnected' | 'connecting' | 'error';

/** Perfil de conexión tal y como se dibuja en la barra lateral. */
export interface ConnectionSummary {
  readonly id: string;
  readonly name: string;
  readonly engine: DatabaseEngine;
  readonly state: ConnectionState;
  readonly expanded: boolean;
}

/** Clase de objeto dentro del explorador. Determina el icono y las acciones. */
export type DatabaseObjectKind =
  | 'folder'
  | 'database'
  | 'schema'
  | 'table'
  | 'view'
  | 'function'
  | 'procedure';

/**
 * Nodo del explorador ya aplanado.
 *
 * El árbol se aplana a propósito: la lista virtualizada de la Fase 2 necesita
 * una secuencia, y el nivel de indentación se resuelve con `depth`.
 */
export interface ExplorerNode {
  readonly id: string;
  readonly label: string;
  readonly kind: DatabaseObjectKind;
  readonly depth: number;
  readonly expanded?: boolean;
  readonly expandable: boolean;
  /** Recuento de hijos o de filas, ya formateado para mostrar. */
  readonly badge?: string;
  readonly selected?: boolean;
  /** Texto atenuado tras la etiqueta, por ejemplo el esquema activo. */
  readonly hint?: string;
}

/** Pestaña de consulta abierta. */
export interface QueryTab {
  readonly id: string;
  readonly title: string;
  readonly active: boolean;
  /** Hay cambios sin guardar. */
  readonly dirty: boolean;
}

export type ColumnType = 'number' | 'text' | 'boolean' | 'timestamp' | 'uuid' | 'binary';

/** Columna de un conjunto de resultados. */
export interface ResultColumn {
  readonly name: string;
  /** Tipo tal y como lo reporta el motor: se muestra literal. */
  readonly dataType: string;
  readonly kind: ColumnType;
  /** Ancho en píxeles; `null` reparte el espacio sobrante. */
  readonly width: number | null;
  readonly sorted?: 'asc' | 'desc';
  /** Filtro local escrito por el usuario. */
  readonly filter?: string;
}

/**
 * Fila de resultados.
 *
 * Los valores llegan ya convertidos a texto: la conversión de tipos ocurre en el
 * backend, que es quien conoce el dialecto. `null` se distingue de la cadena
 * vacía porque debe mostrarse de forma diferenciada (plan §6).
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
