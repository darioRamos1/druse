import {
  ReportColumn,
  ReportDataset,
  ReportSnapshot,
  SavedReport,
} from '../../shared/models/reports';
import {
  PaletteColor,
  ReportAppearance,
  ReportSettings,
  buildIndicator,
  buildSeries,
  tableView,
} from './report-chart';
import { ColorSource, DashboardFilter, DashboardPanel } from './report-dashboard-model';

/** Lo que pinta un panel, ya calculado con los filtros activos. */
export interface PanelView {
  readonly panel: DashboardPanel;
  readonly report: SavedReport | null;
  readonly dataset: ReportDataset | null;
  readonly snapshot: ReportSnapshot | null;
  readonly title: string;
  readonly unbound: readonly string[];
  readonly repeated: readonly string[];
  readonly label: (name: string) => string;
  readonly series: ReturnType<typeof buildSeries> | null;
  readonly indicator: ReturnType<typeof buildIndicator> | null;
  readonly table: ReturnType<typeof tableView> | null;
  readonly valueLabel: string;
  readonly categoryLabel: string;
  readonly appearance: ReportAppearance;
  /** El color resuelto y de dónde viene: panel, reporte, tablero o tema. */
  readonly color: PaletteColor | null;
  readonly colorSource: ColorSource;
  readonly categoryColors: ReadonlyMap<string | null, PaletteColor> | null;
  /** Pulsar una barra filtra el tablero: hay un filtro vinculado a su categoría. */
  readonly pickFilter: DashboardFilter | null;
  /** La categoría elegida en ese filtro; `undefined` si no hay ninguna. */
  readonly picked: string | null | undefined;
  /** Los ajustes ya leídos; `null` si el panel no tiene reporte o datos. */
  readonly settings: ReportSettings | null;
  /** La columna de la categoría en el resultado, para tipar lo que se exporta. */
  readonly categoryColumn: ReportColumn | null;
}
