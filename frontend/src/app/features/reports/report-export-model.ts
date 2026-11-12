import {
  ExportCellType,
  ExportDocument,
  ExportTable,
  ReportColumn,
  ReportValue,
  ReportVisualKind,
} from '../../shared/models/reports';
import { Indicator, Series, isNumericColumn } from './report-chart';

export type {
  ExportCellType,
  ExportColumn,
  ExportDataset,
  ExportDocument,
  ExportFilter,
  ExportLabels,
  ExportPanel,
  ExportTable,
} from '../../shared/models/reports';

/**
 * Exportar un tablero o un panel de Reportes.
 *
 * Todo se calcula aquí, con los filtros activos y sobre los resultados
 * guardados: lo que sale en el archivo es exactamente lo que se ve. El
 * servidor solo escribe el libro de Excel; el CSV se escribe aquí mismo.
 */

/** El mismo tope que aplica el servidor: se avisa antes de pedir el libro. */
export const MAX_EXPORT_CELLS = 2_000_000;

/**
 * Los tonos claros de la paleta, para pintar las series en Excel.
 *
 * Un libro se abre sobre fondo blanco: se usan los valores del tema claro de
 * `_report-palette.scss`, no los del tema en que se esté viendo Druse.
 */
export const PRINT_PALETTE: Readonly<Record<string, string>> = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  yellow: '#eda100',
  magenta: '#e87ba4',
  green: '#008300',
  violet: '#6250d6',
  red: '#e34948',
};

export function cellType(column: ReportColumn): ExportCellType {
  if (isNumericColumn(column)) return 'Number';
  if (column.clrType === 'DateOnly') return 'Date';
  if (column.clrType === 'DateTime' || column.clrType === 'DateTimeOffset') return 'DateTime';
  if (column.clrType === 'Boolean') return 'Boolean';
  return 'Text';
}

/** Lo que hace falta de un panel para escribir sus cifras. */
export interface FigureSource {
  readonly visual: ReportVisualKind;
  readonly series: Series | null;
  readonly indicator: Indicator | null;
  readonly table: { readonly columns: readonly ReportColumn[]; readonly rows: readonly (readonly ReportValue[])[] } | null;
  readonly valueLabel: string;
  readonly categoryLabel: string;
  /** La columna de la categoría, para tipar la primera columna de barras y líneas. */
  readonly categoryColumn: ReportColumn | null;
  /** El nombre con que se enseña una columna (`Ventas.mes` en vez de `izquierda.mes`). */
  readonly label: (name: string) => string;
}

/**
 * Lo que dibuja el panel, como tabla.
 *
 * Barras y líneas: una fila por categoría con su cifra agregada. Indicador: la
 * cifra, la meta y el cumplimiento. Tabla: sus columnas y filas. Es lo mismo
 * que «Ver como tabla», y sobre esta tabla se reconstruye el gráfico en Excel.
 */
export function panelFigures(source: FigureSource, texts: { readonly target: string; readonly ratio: string }): ExportTable {
  if ((source.visual === 'Bar' || source.visual === 'Line') && source.series) {
    const category = source.categoryColumn ? cellType(source.categoryColumn) : 'Text';

    return {
      columns: [
        { name: source.categoryLabel, type: category },
        { name: source.valueLabel, type: 'Number' },
      ],
      rows: source.series.points.map((point) => [point.label, point.value]),
    };
  }

  if (source.visual === 'Indicator' && source.indicator) {
    const indicator = source.indicator;

    return indicator.target === null && !indicator.zeroTarget
      ? { columns: [{ name: source.valueLabel, type: 'Number' }], rows: [[indicator.value]] }
      : {
          columns: [
            { name: source.valueLabel, type: 'Number' },
            { name: texts.target, type: 'Number' },
            { name: texts.ratio, type: 'Percent' },
          ],
          rows: [[indicator.value, indicator.target, indicator.ratio]],
        };
  }

  if (source.table) {
    return {
      columns: source.table.columns.map((column) => ({ name: source.label(column.name), type: cellType(column) })),
      rows: source.table.rows,
    };
  }

  return { columns: [], rows: [] };
}

/** Todas las columnas de un resultado (ya filtrado), con su nombre visible y su tipo. */
export function datasetTable(
  columns: readonly ReportColumn[],
  rows: readonly (readonly ReportValue[])[],
  label: (name: string) => string,
): ExportTable {
  return { columns: columns.map((column) => ({ name: label(column.name), type: cellType(column) })), rows };
}

export function cellCount(document: Pick<ExportDocument, 'panels' | 'datasets'>): number {
  const count = (table: ExportTable) => table.columns.length * table.rows.length;

  return (
    document.panels.reduce((total, panel) => total + count(panel.figures), 0) +
    document.datasets.reduce((total, dataset) => total + count(dataset.table), 0)
  );
}

/**
 * Una tabla en CSV, con las mismas reglas que la exportación de resultados.
 *
 * Coma como separador y fin de línea CRLF (RFC 4180); los números con punto,
 * para que se puedan volver a leer en cualquier idioma. El texto que una hoja
 * de cálculo tomaría por fórmula (`=`, `+`, `-`, `@`) sale con un apóstrofo
 * delante: ese texto viene de la base de datos y no lo escribió Druse.
 */
export function toCsv(table: ExportTable): string {
  const lines = [
    table.columns.map((column) => quote(column.name, false)),
    ...table.rows.map((row) => row.map((value) => cell(value))),
  ];

  return lines.map((line) => line.join(',')).join('\r\n') + '\r\n';
}

function cell(value: ReportValue): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return quote(value, true);
}

const FORMULA_START = /^[=+\-@\t\r]/;

function quote(text: string, escapeFormula: boolean): string {
  const formula = escapeFormula && FORMULA_START.test(text);
  const value = formula ? `'${text}` : text;

  return formula || /[",\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** El CSV listo para guardar, con BOM: Excel en Windows lo necesita para leer bien los acentos. */
export function csvBlob(table: ExportTable): Blob {
  return new Blob(['﻿', toCsv(table)], { type: 'text/csv;charset=utf-8' });
}

/** Un nombre de archivo sin caracteres que algún sistema rechace. */
export function exportFileName(name: string, extension: string): string {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

  return `${safe || 'reporte'}.${extension}`;
}
