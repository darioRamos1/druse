import { describe, expect, it } from 'vitest';

import { ResultColumn, ResultSet } from '../../shared/models/workspace';
import { previewChart } from './preview-chart';

function column(name: string, kind: ResultColumn['kind']): ResultColumn {
  return { name, dataType: kind === 'number' ? 'numeric' : 'text', kind } as ResultColumn;
}

function result(columns: ResultColumn[], rows: (string | null)[][]): ResultSet {
  return {
    columns,
    rows: rows.map((values, index) => ({ number: index + 1, values })),
    totalRows: rows.length,
    durationMs: 1,
    truncated: false,
  };
}

describe('previewChart', () => {
  it('los grupos son la categoría y la última cifra, el valor', () => {
    const chart = previewChart(
      result(
        [column('municipio', 'text'), column('filas', 'number'), column('venta', 'number')],
        [
          ['11001', '1', '40'],
          ['05001', '1', '80'],
          ['08001', '2', '100'],
        ],
      ),
    )!;

    expect(chart.category).toBe('municipio');
    expect(chart.value).toBe('venta');
    // Ordenado por categoría, como en Reportes: los códigos con ceros iniciales intactos.
    expect(chart.series.points).toEqual([
      { label: '05001', value: 80 },
      { label: '08001', value: 100 },
      { label: '11001', value: 40 },
    ]);
    expect(chart.indicator.value).toBe(220);
  });

  it('sin columnas de texto, la primera numérica hace de categoría', () => {
    const chart = previewChart(
      result([column('anio', 'number'), column('total', 'number')], [['2026', '5']]),
    )!;

    expect(chart.category).toBe('anio');
    expect(chart.series.points).toEqual([{ label: '2026', value: 5 }]);
  });

  it('sin ninguna cifra no hay gráfico', () => {
    expect(previewChart(result([column('nombre', 'text')], [['Ana']]))).toBeNull();
  });
});
