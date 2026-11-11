import { ReportColumn, ReportSnapshot, ReportValue } from '../../shared/models/reports';
import {
  ReportSettings,
  buildIndicator,
  buildSeries,
  defaultSettings,
  parseSettings,
  repeatedInUse,
  tableView,
} from './report-chart';

function columna(name: string, clrType: string, ordinal: number): ReportColumn {
  return { name, clrType, dataType: clrType, ordinal };
}

const columnas = [
  columna('izquierda.mes', 'DateOnly', 0),
  columna('izquierda.municipio', 'String', 1),
  columna('izquierda.venta', 'Decimal', 2),
  columna('derecha.meta', 'Decimal', 3),
];

function resultado(rows: readonly (readonly ReportValue[])[], repeated: readonly string[] = []): ReportSnapshot {
  return {
    datasetId: 'ds-1',
    definitionVersion: 1,
    fromOlderDefinition: false,
    startedAtUtc: '2026-11-11T15:00:00Z',
    completedAtUtc: '2026-11-11T15:00:02Z',
    columns: columnas,
    rows,
    unmatchedLeftRows: 0,
    unmatchedRightRows: 0,
    repeatedColumns: repeated,
  };
}

/** El escenario del plan: enero con tres municipios, uno sin meta. */
const enero = resultado([
  ['2026-01-01', '05001', 80, 100],
  ['2026-01-01', '08001', 100, 200],
  ['2026-01-01', '11001', 40, null],
]);

function ajustes(patch: Partial<ReportSettings>): ReportSettings {
  return { ...defaultSettings('Bar', columnas), ...patch };
}

describe('report-chart', () => {
  it('el indicador de cumplimiento da 60 % y cuenta aparte el municipio sin meta', () => {
    const indicador = buildIndicator(enero, ajustes({ value: 'izquierda.venta', target: 'derecha.meta' }));

    expect(indicador.value).toBe(180);
    expect(indicador.target).toBe(300);
    expect(indicador.ratio).toBeCloseTo(0.6, 10);
    expect(indicador.withoutTarget).toBe(1);
  });

  it('sin meta, el indicador agrega la cifra de todas las filas', () => {
    expect(buildIndicator(enero, ajustes({ value: 'izquierda.venta', target: null })).value).toBe(220);
    expect(
      buildIndicator(enero, ajustes({ value: 'izquierda.venta', target: null, aggregate: 'Average' })).value,
    ).toBeCloseTo(73.333, 2);
  });

  it('una meta cero no inventa un porcentaje', () => {
    const indicador = buildIndicator(
      resultado([['2026-01-01', '05001', 80, 0]]),
      ajustes({ value: 'izquierda.venta', target: 'derecha.meta' }),
    );

    expect(indicador.ratio).toBeNull();
    expect(indicador.zeroTarget).toBe(true);
  });

  it('agrupa por mes y suma, en orden cronológico, con el vacío al final', () => {
    const dos = resultado([
      ['2026-02-01', '05001', 10, 100],
      ['2026-01-01', '05001', 80, 100],
      ['2026-01-01', '08001', 100, 200],
      [null, '11001', 5, null],
    ]);

    expect(buildSeries(dos, ajustes({ category: 'izquierda.mes', value: 'izquierda.venta' })).points).toEqual([
      { label: '2026-01-01', value: 180 },
      { label: '2026-02-01', value: 10 },
      { label: null, value: 5 },
    ]);
    expect(
      buildSeries(dos, ajustes({ category: 'izquierda.mes', value: 'izquierda.venta', aggregate: 'Count' })).points,
    ).toEqual([
      { label: '2026-01-01', value: 2 },
      { label: '2026-02-01', value: 1 },
      { label: null, value: 1 },
    ]);
  });

  it('ordena por cifra si se pide y conserva los ceros iniciales de los códigos', () => {
    const series = buildSeries(enero, ajustes({ category: 'izquierda.municipio', value: 'izquierda.venta', sort: 'valueDesc' }));

    expect(series.points.map((point) => point.label)).toEqual(['08001', '05001', '11001']);
  });

  it('dice qué columnas elegidas ya no están en el resultado', () => {
    const series = buildSeries(enero, ajustes({ category: 'izquierda.region', value: 'izquierda.venta' }));

    expect(series.points).toEqual([]);
    expect(series.missing).toEqual(['izquierda.region']);
  });

  it('avisa si se suma una cifra repetida del lado «uno», no si se cuenta', () => {
    const repetido = resultado(enero.rows, ['derecha.meta']);

    expect(repeatedInUse(repetido, ajustes({ value: 'derecha.meta', aggregate: 'Sum' }))).toEqual(['derecha.meta']);
    expect(repeatedInUse(repetido, ajustes({ value: 'derecha.meta', aggregate: 'Count' }))).toEqual([]);
    expect(repeatedInUse(repetido, ajustes({ value: 'izquierda.venta', target: 'derecha.meta' }))).toEqual([
      'derecha.meta',
    ]);
  });

  it('propone categoría y cifra, y lee ajustes rotos sin fallar', () => {
    expect(defaultSettings('Bar', columnas)).toMatchObject({
      category: 'izquierda.mes',
      value: 'izquierda.venta',
    });
    expect(defaultSettings('Indicator', columnas)).toMatchObject({
      value: 'izquierda.venta',
      target: 'derecha.meta',
    });
    expect(parseSettings('{roto', 'Bar', columnas)).toEqual(defaultSettings('Bar', columnas));
    expect(parseSettings('{"aggregate":"Mediana","sort":"valueDesc"}', 'Bar', columnas)).toMatchObject({
      aggregate: 'Sum',
      sort: 'valueDesc',
    });
  });

  it('la tabla enseña solo las columnas elegidas, en su orden', () => {
    const tabla = tableView(enero, ajustes({ columns: ['izquierda.venta', 'izquierda.municipio'] }));

    expect(tabla.columns.map((column) => column.name)).toEqual(['izquierda.venta', 'izquierda.municipio']);
    expect(tabla.rows[0]).toEqual([80, '05001']);
  });
});
