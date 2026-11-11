/**
 * Conjuntos de datos de Reportes BI, tal como los publica la API local.
 *
 * Los enums viajan por nombre. Las credenciales nunca: una fuente solo dice qué
 * conexión guardada usa, y el servidor resuelve la contraseña con el llavero.
 */

export type ReportSourceMode = 'Sql' | 'Visual';
export type ReportJoinKind = 'Inner' | 'Left';

/** `ManyToOne`: la izquierda puede repetir la clave y la derecha es el lado «uno». */
export type ReportJoinCardinality = 'OneToOne' | 'ManyToOne';

export interface ReportExpectedColumn {
  readonly name: string;
  readonly clrType: string;
}

export interface ReportSource {
  readonly alias: string;
  readonly connectionId: string;
  readonly database: string;
  readonly mode: ReportSourceMode;
  readonly sql: string;
  /** Copia del estado del compositor (`{ sql, state, compositionId, name }`), en JSON. */
  readonly visualModel?: string | null;
  readonly expectedColumns: readonly ReportExpectedColumn[];
}

export interface ReportJoinKey {
  readonly left: string;
  readonly right: string;
}

export interface ReportJoin {
  readonly keys: readonly ReportJoinKey[];
  readonly kind: ReportJoinKind;
  readonly cardinality: ReportJoinCardinality;
}

export interface ReportDataset {
  readonly id: string;
  readonly name: string;
  /** La pone el servidor; sube cuando cambian las fuentes o la unión. */
  readonly version: number;
  readonly sources: readonly ReportSource[];
  readonly join: ReportJoin | null;
  readonly createdAtUtc?: string;
  readonly updatedAtUtc?: string;
}

export interface ReportColumn {
  readonly name: string;
  readonly dataType: string;
  readonly clrType: string;
  readonly ordinal: number;
}

/** Valores tipados tal como los serializa .NET: números, texto ISO, booleanos o null. */
export type ReportValue = string | number | boolean | null;

export type ReportSourceFailureCode =
  | 'connection-missing'
  | 'password-missing'
  | 'ssh-secret-missing'
  | 'engine-unsupported'
  | 'invalid-query'
  | 'database-error';

export interface ReportSchemaChange {
  readonly column: string;
  readonly kind: 'Missing' | 'Added' | 'TypeChanged';
  readonly expected: string | null;
  readonly actual: string | null;
}

export interface ReportSourcePreview {
  readonly alias: string;
  readonly succeeded: boolean;
  readonly failureCode: ReportSourceFailureCode | null;
  readonly message: string | null;
  readonly columns: readonly ReportColumn[];
  readonly sampleRows: readonly (readonly ReportValue[])[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly schemaChanges: readonly ReportSchemaChange[];
  readonly startedAtUtc: string;
  readonly completedAtUtc: string;
}

export interface ReportJoinPreview {
  readonly succeeded: boolean;
  readonly message: string | null;
  readonly duplicateKeys: readonly string[];
  readonly columns: readonly ReportColumn[];
  readonly sampleRows: readonly (readonly ReportValue[])[];
  readonly rowCount: number;
  readonly matchedRows: number;
  readonly unmatchedLeftRows: number;
  readonly unmatchedRightRows: number;
  readonly repeatedColumns: readonly string[];
  readonly isSample: boolean;
}

export interface ReportDatasetPreview {
  readonly sources: readonly ReportSourcePreview[];
  readonly join: ReportJoinPreview | null;
}

export interface ReportDatabaseList {
  readonly databases: readonly string[];
  readonly failureCode: ReportSourceFailureCode | null;
  readonly message: string | null;
}

// --- Hito 3: resultado guardado, intentos y reportes ------------------------

export type ReportRunStatus = 'Succeeded' | 'Failed' | 'Canceled';

export interface ReportRunSource {
  readonly alias: string;
  readonly failureCode: ReportSourceFailureCode | null;
  readonly message: string | null;
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly startedAtUtc: string;
  readonly completedAtUtc: string;
}

export interface ReportRun {
  readonly id: string;
  readonly definitionVersion: number;
  readonly origin: 'Manual' | 'Scheduled';
  readonly status: ReportRunStatus;
  readonly startedAtUtc: string;
  readonly completedAtUtc: string;
  readonly message: string | null;
  readonly duplicateKeys: readonly string[];
  readonly rowCount: number;
  readonly sources: readonly ReportRunSource[];
}

export interface ReportRefresh {
  readonly outcome: 'Refreshed' | 'Failed';
  readonly run: ReportRun | null;
}

/** El último resultado bueno; se lee sin conexión a los orígenes. */
export interface ReportSnapshot {
  readonly datasetId: string;
  readonly definitionVersion: number;
  readonly fromOlderDefinition: boolean;
  readonly startedAtUtc: string;
  readonly completedAtUtc: string;
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly (readonly ReportValue[])[];
  readonly unmatchedLeftRows: number;
  readonly unmatchedRightRows: number;
  readonly repeatedColumns: readonly string[];
}

export type ReportVisualKind = 'Table' | 'Bar' | 'Line' | 'Indicator';

export interface SavedReport {
  readonly id: string;
  readonly datasetId: string;
  readonly name: string;
  readonly visual: ReportVisualKind;
  /** JSON de `ReportSettings`. */
  readonly settings: string;
  readonly createdAtUtc?: string;
  readonly updatedAtUtc?: string;
}

/** Un tablero guardado. `model` es JSON de `DashboardModel`. */
export interface SavedDashboard {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly createdAtUtc?: string;
  readonly updatedAtUtc?: string;
}
