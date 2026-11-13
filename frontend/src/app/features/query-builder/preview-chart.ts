import { ReportColumn, ReportSnapshot, ReportValue } from '../../shared/models/reports';
import { ResultSet } from '../../shared/models/workspace';
import {
  DEFAULT_APPEARANCE,
  Indicator,
  ReportSettings,
  Series,
  buildIndicator,
  buildSeries,
} from '../reports/report-chart';

/** La vista previa del compositor dibujada con las gráficas de Reportes. */
export interface PreviewChart {
  readonly category: string;
  readonly value: string;
  readonly series: Series;
  readonly indicator: Indicator;
}

/**
 * Qué se dibuja con un resultado: la última columna numérica es la cifra y la
 * primera que no lo es, la categoría.
 *
 * Es lo que deja una consulta con «Agrupar por» y «Valores»: los grupos
 * primero y las cifras al final. Sin ninguna columna numérica no hay gráfico
 * que hacer, y se dice en vez de inventar uno.
 *
 * Las filas llegan como texto; las cifras se leen con `Number`, que es como
 * las escribe la API (sin separadores de miles).
 */
export function previewChart(set: ResultSet): PreviewChart | null {
  const value = set.columns.map((column) => column.kind).lastIndexOf('number');

  if (value < 0) {
    return null;
  }

  const text = set.columns.findIndex(
    (column, index) => index !== value && column.kind !== 'number',
  );
  // Todas numéricas (un año agrupado y una suma, por ejemplo): la primera hace de categoría.
  const category = text >= 0 ? text : set.columns.findIndex((_, index) => index !== value);

  const columns: ReportColumn[] = set.columns.map((column, ordinal) => ({
    name: column.name,
    dataType: column.dataType,
    clrType: column.kind === 'number' ? 'Decimal' : 'String',
    ordinal,
  }));
  const rows = set.rows.map((row) =>
    row.values.map<ReportValue>((raw, index) => {
      if (raw === null) return null;
      if (index !== value) return raw;
      const number = Number(raw);
      return Number.isFinite(number) ? number : null;
    }),
  );
  const snapshot: ReportSnapshot = {
    datasetId: '',
    definitionVersion: 0,
    fromOlderDefinition: false,
    startedAtUtc: '',
    completedAtUtc: '',
    columns,
    rows,
    unmatchedLeftRows: 0,
    unmatchedRightRows: 0,
    repeatedColumns: [],
  };
  const settings: ReportSettings = {
    category: category < 0 ? null : set.columns[category].name,
    value: set.columns[value].name,
    aggregate: 'Sum',
    target: null,
    columns: [],
    sort: 'category',
    appearance: DEFAULT_APPEARANCE,
  };

  return {
    category: settings.category ?? '',
    value: settings.value!,
    series: buildSeries(snapshot, settings),
    indicator: buildIndicator(snapshot, settings),
  };
}
