import { SavedCompositionRecord } from '../../core/application-gateway/application-gateway';
import { ReportColumn, ReportDataset, ReportDatasetPreview } from '../../shared/models/reports';
import {
  adoptExpectedColumns,
  applyComposition,
  draftProblems,
  newDataset,
  newSource,
  nextAlias,
  readVisualModel,
  sourceFingerprint,
  suggestKeys,
  toSqlMode,
  toVisualMode,
  visualWouldDiscardSql,
} from './report-draft';

function columna(name: string, clrType: string, ordinal = 0): ReportColumn {
  return { name, clrType, dataType: clrType, ordinal };
}

const composicion: SavedCompositionRecord = {
  id: 'comp-1',
  connectionId: 'conn-1',
  database: 'ventas',
  schema: 'dbo',
  table: 'ventas',
  name: 'Ventas por mes',
  model: JSON.stringify({
    sql: 'SELECT mes, municipio, SUM(importe) AS venta FROM dbo.ventas GROUP BY mes, municipio',
    state: { groupBy: ['mes', 'municipio'] },
  }),
};

function dosFuentes(): ReportDataset {
  return {
    ...newDataset('ds-1', 'Ventas y metas'),
    sources: [
      { ...newSource('Ventas', 'conn-1', 'ventas'), sql: 'SELECT 1 AS municipio' },
      { ...newSource('Metas', 'conn-2', 'metas'), sql: 'SELECT 1 AS municipio' },
    ],
    join: {
      keys: [{ left: 'municipio', right: 'municipio' }],
      kind: 'Left',
      cardinality: 'OneToOne',
    },
  };
}

describe('report-draft', () => {
  it('propone como claves las columnas con el mismo nombre y el mismo tipo', () => {
    const izquierda = [
      columna('mes', 'DateOnly'),
      columna('Municipio', 'String'),
      columna('venta', 'Decimal'),
    ];
    const derecha = [
      columna('mes', 'DateOnly'),
      columna('municipio', 'String'),
      columna('venta', 'Int32'),
    ];

    expect(suggestKeys(izquierda, derecha)).toEqual([
      { left: 'mes', right: 'mes' },
      { left: 'Municipio', right: 'municipio' },
    ]);
  });

  it('copia la composición elegida y conserva su estado al pasar a SQL', () => {
    const visual = applyComposition(newSource('Ventas', 'conn-1', 'ventas'), composicion);

    expect(visual.mode).toBe('Visual');
    expect(visual.sql).toContain('GROUP BY mes, municipio');
    expect(readVisualModel(visual)).toMatchObject({
      compositionId: 'comp-1',
      table: 'dbo.ventas',
      state: { groupBy: ['mes', 'municipio'] },
    });

    const sql = toSqlMode(visual);

    expect(sql.mode).toBe('Sql');
    expect(sql.visualModel).toBe(visual.visualModel);
    expect(visualWouldDiscardSql(sql)).toBe(false);
  });

  it('avisa antes de volver al modo visual si el SQL se editó a mano', () => {
    const editada = { ...toSqlMode(applyComposition(newSource('V', 'c', 'b'), composicion)) };
    const conCambio = { ...editada, sql: `${editada.sql} HAVING SUM(importe) > 0` };

    expect(visualWouldDiscardSql(conCambio)).toBe(true);
    // Solo espacios y un punto y coma final no cuentan como edición.
    expect(visualWouldDiscardSql({ ...editada, sql: `  ${editada.sql};\n` })).toBe(false);

    const vuelta = toVisualMode(conCambio);

    expect(vuelta.mode).toBe('Visual');
    expect(vuelta.sql).toBe(editada.sql);
  });

  it('dice qué falta antes de poder previsualizar', () => {
    expect(draftProblems(newDataset('x', 'Nuevo'))).toEqual(['reports.problem.noSources']);

    const sinUnion = { ...dosFuentes(), join: null };

    expect(draftProblems(sinUnion)).toEqual(['reports.problem.joinKeys']);

    const visualSinComposicion = dosFuentes();
    const fuentes = [
      { ...visualSinComposicion.sources[0], mode: 'Visual' as const },
      visualSinComposicion.sources[1],
    ];

    expect(draftProblems({ ...visualSinComposicion, sources: fuentes })).toEqual([
      'reports.problem.composition',
    ]);

    const aliasRepetido = dosFuentes();

    expect(
      draftProblems({
        ...aliasRepetido,
        sources: [aliasRepetido.sources[0], { ...aliasRepetido.sources[1], alias: ' ventas ' }],
      }),
    ).toEqual(['reports.problem.aliasRepeated']);

    expect(draftProblems(dosFuentes())).toEqual([]);
  });

  it('elige un alias libre para la fuente nueva', () => {
    const fuentes = [newSource('Fuente 2', 'c', 'b')];

    expect(nextAlias(fuentes, 'Fuente')).toBe('Fuente 3');
    expect(nextAlias([], 'Fuente')).toBe('Fuente 1');
  });

  it('solo guarda como esperadas las columnas de una vista previa que sigue vigente', () => {
    const dataset = dosFuentes();
    const preview: ReportDatasetPreview = {
      join: null,
      sources: dataset.sources.map((source) => ({
        alias: source.alias,
        succeeded: true,
        failureCode: null,
        message: null,
        columns: [columna('municipio', 'String')],
        sampleRows: [],
        rowCount: 0,
        truncated: false,
        schemaChanges: [],
        startedAtUtc: '2026-11-11T15:00:00Z',
        completedAtUtc: '2026-11-11T15:00:01Z',
      })),
    };
    const previa = new Map(
      dataset.sources.map((source) => [source.alias, sourceFingerprint(source)]),
    );
    const cambiada = {
      ...dataset,
      sources: [dataset.sources[0], { ...dataset.sources[1], sql: 'SELECT 2 AS otra' }],
    };

    const guardada = adoptExpectedColumns(cambiada, preview, previa);

    expect(guardada.sources[0].expectedColumns).toEqual([{ name: 'municipio', clrType: 'String' }]);
    expect(guardada.sources[1].expectedColumns).toEqual([]);
  });
});
