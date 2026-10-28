import { sqlitePlan } from './ai-plans';
import { EngineCapabilities, ResultSet } from '../../shared/models/workspace';

describe('Planes adjuntos al chat', () => {
  const capabilities = { aiPlanFormat: 'sqlite-query-plan' } as EngineCapabilities;
  const source = {
    connectionId: 'c1',
    connectionName: 'Prueba',
    database: 'prueba.db',
    engine: 'sqlite',
  };
  const set: ResultSet = {
    columns: ['id', 'parent', 'notused', 'detail'].map((name) => ({
      name,
      dataType: 'text',
      kind: 'text',
      width: null,
    })),
    rows: [
      { number: 1, values: ['3', '0', '0', 'SEARCH clientes USING INDEX ix_nombre (nombre=?)'] },
    ],
    totalRows: 1,
    durationMs: 1,
    truncated: false,
  };
  const sql = "EXPLAIN QUERY PLAN SELECT * FROM clientes WHERE nombre = 'Ana';";
  const make = (sets: readonly ResultSet[] = [set], command = sql, caps = capabilities) =>
    sqlitePlan(caps, source, command, 'e1', '2026-10-19T12:00:00Z', sets);

  it('conserva la consulta y los operadores sin interpretar su texto', () => {
    const result = make()!;
    expect(result.plan.sql).toBe(sql);
    expect(result.plan.text).toBe(
      'id\tparent\tnotused\tdetail\n3\t0\t0\tSEARCH clientes USING INDEX ix_nombre (nombre=?)',
    );
    expect(result.source).toEqual(source);
    expect(result.source).not.toBe(source);
  });

  it('no confunde resultados ordinarios, otros planes ni motores sin capacidad', () => {
    expect(make([set], 'SELECT 1;')).toBeNull();
    expect(make([set], 'EXPLAIN ANALYZE SELECT 1;')).toBeNull();
    expect(make([set], sql, {} as EngineCapabilities)).toBeNull();
    expect(make([{ ...set, columns: set.columns.slice(1) }])).toBeNull();
    expect(
      make([{ ...set, rows: [{ number: 1, values: ['x', '0', '0', 'SCAN clientes'] }] }]),
    ).toBeNull();
  });

  it('no presenta como completo un plan vacío, recortado o mezclado con otros resultados', () => {
    expect(make([{ ...set, rows: [] }])).toBeNull();
    expect(make([{ ...set, truncated: true }])).toBeNull();
    expect(make([set, set])).toBeNull();
    expect(make([{ ...set, rows: Array(201).fill(set.rows[0]) }])).toBeNull();
  });
});
