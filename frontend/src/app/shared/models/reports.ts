import { ServerMessage } from './workspace';

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
  /** El motivo con su clave, cuando lo escribe Druse y no el motor. */
  readonly localized?: ServerMessage | null;
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
  readonly localized?: ServerMessage | null;
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

export type ReportRunStatus = 'Succeeded' | 'Failed' | 'Canceled' | 'Interrupted';

export interface ReportRunSource {
  readonly alias: string;
  readonly failureCode: ReportSourceFailureCode | null;
  readonly message: string | null;
  readonly localized?: ServerMessage | null;
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
  /** El motivo con su clave; los intentos de antes del hito 6 no la traen. */
  readonly localized?: ServerMessage | null;
  readonly duplicateKeys: readonly string[];
  readonly rowCount: number;
  readonly sources: readonly ReportRunSource[];
}

// --- Hito 5: actualización programada ----------------------------------------

export type ReportScheduleFrequency = 'Daily' | 'Weekly';

export type ReportWeekDay =
  'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

/**
 * Cuándo se actualiza solo un conjunto. Al guardar solo cuentan la regla y la
 * pausa; el próximo horario, el reintento y `running` los pone el servidor.
 */
export interface ReportSchedule {
  readonly frequency: ReportScheduleFrequency;
  /** Hora local de la zona, `HH:mm`. */
  readonly time: string;
  readonly days: readonly ReportWeekDay[];
  /** Zona IANA, como la da el navegador. */
  readonly timeZone: string;
  readonly paused: boolean;
  readonly nextRunUtc?: string | null;
  readonly retryAtUtc?: string | null;
  readonly running?: boolean;
}

/** Lo que ocupa un conjunto en reports.db. */
export interface ReportStorageEntry {
  readonly datasetId: string;
  readonly name: string;
  readonly snapshotBytes: number;
  readonly runCount: number;
  readonly capturedAtUtc: string | null;
}

/** El espacio de Reportes BI, en bytes; la cuota cuenta solo los resultados. */
export interface ReportStorage {
  readonly fileBytes: number;
  readonly snapshotBytes: number;
  readonly quotaBytes: number;
  readonly datasets: readonly ReportStorageEntry[];
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

export type ReportTemplateScope = 'Report' | 'Panel' | 'Dashboard';

/** Una plantilla guardada. `model` es JSON de `TemplateDocument`. */
export interface SavedReportTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly scope: ReportTemplateScope;
  readonly model: string;
  readonly createdAtUtc?: string;
  readonly updatedAtUtc?: string;
}

// --- Hito 4.4: exportar un tablero o un panel ------------------------------

/** Tipo de celda, con los mismos nombres que `ReportExportCellType` en el servidor. */
export type ExportCellType = 'Text' | 'Number' | 'Date' | 'DateTime' | 'Boolean' | 'Percent';

export interface ExportColumn {
  readonly name: string;
  readonly type: ExportCellType;
}

export interface ExportTable {
  readonly columns: readonly ExportColumn[];
  readonly rows: readonly (readonly ReportValue[])[];
}

export interface ExportFilter {
  readonly label: string;
  readonly value: string;
}

export interface ExportPanel {
  readonly title: string;
  readonly description: string | null;
  readonly page: string;
  /** Posición en `datasets`. */
  readonly dataset: number;
  readonly figures: ExportTable;
  readonly chart: 'Bar' | 'Line' | null;
  readonly color: string | null;
  readonly notes: readonly string[];
  readonly indicator: {
    readonly value: number | null;
    readonly target: number | null;
    readonly ratio: number | null;
  } | null;
}

export interface ExportDataset {
  readonly name: string;
  readonly capturedAtUtc: string;
  readonly table: ExportTable;
}

/** Los textos fijos del libro, en el idioma de la interfaz. */
export interface ExportLabels {
  readonly summary: string;
  readonly generated: string;
  readonly filters: string;
  readonly noFilters: string;
  readonly panel: string;
  readonly page: string;
  readonly dataset: string;
  readonly capturedAt: string;
  readonly value: string;
  readonly target: string;
  readonly ratio: string;
  readonly data: string;
}

export interface ExportDocument {
  readonly title: string;
  readonly generatedAtUtc: string;
  readonly filters: readonly ExportFilter[];
  readonly panels: readonly ExportPanel[];
  readonly datasets: readonly ExportDataset[];
  readonly labels: ExportLabels;
}
