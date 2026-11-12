import { ReportColumn } from '../../shared/models/reports';
import {
  cellCount,
  cellType,
  datasetTable,
  exportFileName,
  panelFigures,
  toCsv,
} from './report-export-model';

function columna(name: string, clrType: string, ordinal = 0): ReportColumn {
  return { name, clrType, dataType: clrType, ordinal };
}

const etiqueta = (name: string) => name.replace('izquierda.', 'Ventas.');
const textos = { target: 'Meta', ratio: 'Cumplimiento' };

describe('report-export-model', () => {
  it('tipa cada columna por su tipo .NET', () => {
    expect(cellType(columna('a', 'Decimal'))).toBe('Number');
    expect(cellType(columna('a', 'Int64'))).toBe('Number');
    expect(cellType(columna('a', 'DateOnly'))).toBe('Date');
    expect(cellType(columna('a', 'DateTimeOffset'))).toBe('DateTime');
    expect(cellType(columna('a', 'Boolean'))).toBe('Boolean');
    // Los códigos son texto: el cero inicial no se pierde en Excel.
    expect(cellType(columna('a', 'String'))).toBe('Text');
  });

  it('escribe las barras como categoría y cifra, con la categoría tipada', () => {
    const tabla = panelFigures(
      {
        visual: 'Line',
        series: {
          points: [
            { label: '2026-01-01', value: 220 },
            { label: null, value: 5 },
          ],
          missing: [],
        },
        indicator: null,
        table: null,
        valueLabel: 'Suma · Ventas.venta',
        categoryLabel: 'Ventas.mes',
        categoryColumn: columna('izquierda.mes', 'DateOnly'),
        label: etiqueta,
      },
      textos,
    );

    expect(tabla).toEqual({
      columns: [
        { name: 'Ventas.mes', type: 'Date' },
        { name: 'Suma · Ventas.venta', type: 'Number' },
      ],
      rows: [
        ['2026-01-01', 220],
        [null, 5],
      ],
    });
  });

  it('escribe el indicador con meta y cumplimiento, o solo la cifra sin meta', () => {
    const base = {
      visual: 'Indicator' as const,
      series: null,
      table: null,
      valueLabel: 'Suma',
      categoryLabel: '',
      categoryColumn: null,
      label: etiqueta,
    };
    const conMeta = panelFigures(
      {
        ...base,
        indicator: {
          value: 180,
          target: 300,
          ratio: 0.6,
          zeroTarget: false,
          withoutTarget: 1,
          missing: [],
        },
      },
      textos,
    );
    const sinMeta = panelFigures(
      {
        ...base,
        indicator: {
          value: 7,
          target: null,
          ratio: null,
          zeroTarget: false,
          withoutTarget: 0,
          missing: [],
        },
      },
      textos,
    );

    expect(conMeta.columns.map((column) => [column.name, column.type])).toEqual([
      ['Suma', 'Number'],
      ['Meta', 'Number'],
      ['Cumplimiento', 'Percent'],
    ]);
    expect(conMeta.rows).toEqual([[180, 300, 0.6]]);
    expect(sinMeta).toEqual({ columns: [{ name: 'Suma', type: 'Number' }], rows: [[7]] });
  });

  it('escribe la tabla con los nombres visibles de sus columnas', () => {
    const tabla = panelFigures(
      {
        visual: 'Table',
        series: null,
        indicator: null,
        table: {
          columns: [
            columna('izquierda.municipio', 'String'),
            columna('izquierda.venta', 'Decimal', 1),
          ],
          rows: [['05001', 80]],
        },
        valueLabel: '',
        categoryLabel: '',
        categoryColumn: null,
        label: etiqueta,
      },
      textos,
    );

    expect(tabla.columns.map((column) => column.name)).toEqual([
      'Ventas.municipio',
      'Ventas.venta',
    ]);
    expect(tabla.rows).toEqual([['05001', 80]]);
  });

  it('el CSV conserva ceros iniciales, escapa comillas y neutraliza fórmulas', () => {
    const tabla = datasetTable(
      [
        columna('municipio', 'String'),
        columna('venta', 'Decimal', 1),
        columna('nota', 'String', 2),
        columna('activo', 'Boolean', 3),
      ],
      [
        ['05001', 80.5, 'dijo "hola", y se fue', true],
        ['08001', -3, '=HYPERLINK("http://x")', false],
        ['11001', null, '+34 600', null],
      ],
      (name) => name,
    );

    expect(toCsv(tabla)).toBe(
      [
        'municipio,venta,nota,activo',
        '05001,80.5,"dijo ""hola"", y se fue",true',
        '08001,-3,"\'=HYPERLINK(""http://x"")",false',
        '11001,,"\'+34 600",',
        '',
      ].join('\r\n'),
    );
  });

  it('cuenta las celdas de paneles y conjuntos para avisar antes del límite', () => {
    const tabla = {
      columns: [
        { name: 'a', type: 'Text' as const },
        { name: 'b', type: 'Number' as const },
      ],
      rows: [
        ['x', 1],
        ['y', 2],
      ],
    };

    expect(
      cellCount({
        panels: [
          {
            title: '',
            description: null,
            page: '',
            dataset: 0,
            figures: tabla,
            chart: null,
            color: null,
            notes: [],
            indicator: null,
          },
        ],
        datasets: [{ name: '', capturedAtUtc: '', table: tabla }],
      }),
    ).toBe(8);
  });

  it('propone un nombre de archivo sin caracteres prohibidos', () => {
    expect(exportFileName('Ventas: enero/2026', 'xlsx')).toBe('Ventas enero 2026.xlsx');
    expect(exportFileName('  ', 'csv')).toBe('reporte.csv');
  });
});
