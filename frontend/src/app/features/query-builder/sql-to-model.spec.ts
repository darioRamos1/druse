import { describe, expect, it } from 'vitest';

import { DatabaseEngine, KnownColumn } from '../../shared/models/workspace';
import { SQL_DIALECTS } from '../query-editor/sql-language/sql-dialects';
import { buildSelect } from '../query-editor/sql-language/sql-writer';
import { ModelCatalog, SelectModel, emptySelectForm, toSelectSpec } from './query-model';
import { CatalogTable, SqlToModelContext, referencedTables, sqlToModel } from './sql-to-model';

function col(name: string, dataType: string, extra: Partial<KnownColumn> = {}): KnownColumn {
  return { name, dataType, isNullable: true, isPrimaryKey: false, ...extra };
}

const VENTAS = [
  col('id', 'integer', { isPrimaryKey: true }),
  col('mes', 'date', { inputKind: 'date' }),
  col('municipio_id', 'varchar(5)'),
  col('importe', 'numeric(10,2)'),
  col('nota', 'text'),
];
const MUNICIPIOS = [col('id', 'varchar(5)', { isPrimaryKey: true }), col('nombre', 'text')];
const REGIONES = [col('id', 'integer'), col('region', 'text')];

const TABLES: CatalogTable[] = [
  { id: 'tbl-ventas', schema: 'ventas', name: 'ventas' },
  { id: 'tbl-municipios', schema: 'ventas', name: 'municipios' },
  { id: 'tbl-regiones', schema: 'ventas', name: 'regiones' },
];
const COLUMNS: Record<string, readonly KnownColumn[]> = {
  'tbl-municipios': MUNICIPIOS,
  'tbl-regiones': REGIONES,
};

const ENGINES = Object.keys(SQL_DIALECTS) as DatabaseEngine[];

function context(engine: DatabaseEngine): SqlToModelContext {
  return {
    engine,
    table: { schema: 'ventas', name: 'ventas' },
    columns: VENTAS,
    tables: TABLES,
    columnsOf: (id) => COLUMNS[id] ?? [],
  };
}

function model(patch: Partial<SelectModel> = {}): SelectModel {
  return { ...emptySelectForm(), joins: [], ...patch };
}

function catalog(model: SelectModel): ModelCatalog {
  const byName: Record<string, readonly KnownColumn[]> = {
    municipios: MUNICIPIOS,
    regiones: REGIONES,
  };
  return {
    table: { schema: 'ventas', name: 'ventas' },
    columns: VENTAS,
    joinColumns: new Map(model.joins.map((join) => [join.id, byName[join.table] ?? []])),
  };
}

function write(engine: DatabaseEngine, value: SelectModel): string {
  return buildSelect(engine, toSelectSpec(value, catalog(value)));
}

/** Escribe, lee y vuelve a escribir: tiene que salir el mismo SQL. */
function roundTrip(engine: DatabaseEngine, value: SelectModel): { sql: string; again: string } {
  const sql = write(engine, value);
  const read = sqlToModel(sql, context(engine));

  if (!read.ok) {
    throw new Error(`${engine}: no se pudo leer (${read.reason})\n${sql}`);
  }

  return { sql, again: write(engine, { ...read.form, joins: read.joins }) };
}

const CRUCE = {
  id: 1,
  type: 'LEFT' as const,
  schema: 'ventas',
  table: 'municipios',
  leftJoinId: null,
  leftColumn: 'municipio_id',
  rightColumn: 'id',
  chosen: ['nombre'],
};

const CASOS: Record<string, SelectModel> = {
  'columnas, DISTINCT, límite y orden': model({
    chosen: ['mes', 'importe'],
    distinct: true,
    limit: 25,
    orders: [
      { id: 1, target: 'column:mes', descending: true },
      { id: 2, target: 'column:importe', descending: false },
    ],
  }),
  'todas las columnas y sin límite': model({ limit: null }),
  'todos los operadores, con AND y OR mezclados': model({
    chosen: ['id'],
    filters: [
      { column: 'importe', operator: '>=', value: '10' },
      { column: 'importe', operator: '<', value: '-5', conjunction: 'OR' },
      { column: 'nota', operator: 'LIKE', value: '%nor%', conjunction: 'AND' },
      { column: 'nota', operator: 'NOT LIKE', value: "it's", conjunction: 'AND' },
      {
        column: 'mes',
        operator: 'BETWEEN',
        value: '2026-01-01',
        valueTo: '2026-03-31',
        conjunction: 'OR',
      },
      { column: 'id', operator: 'IN', value: '1, 2, 3', inSource: 'list', conjunction: 'AND' },
      { column: 'id', operator: 'NOT IN', value: '4', inSource: 'list', conjunction: 'AND' },
      {
        column: 'municipio_id',
        operator: 'IN',
        value: "SELECT id FROM municipios WHERE nombre = 'Ana'",
        inSource: 'query',
        conjunction: 'AND',
      },
      { column: 'nota', operator: 'IS NULL', value: null, conjunction: 'OR' },
      { column: 'nota', operator: 'IS NOT NULL', value: null, conjunction: 'AND' },
      { column: 'id', operator: '<>', value: null, compareColumn: 'importe', conjunction: 'AND' },
      { column: 'nota', operator: '=', value: 'Norte', conjunction: 'AND' },
    ],
  }),
  'cruces encadenados y un CROSS': model({
    chosen: ['importe'],
    joins: [
      CRUCE,
      {
        id: 2,
        type: 'INNER',
        schema: 'ventas',
        table: 'regiones',
        leftJoinId: 1,
        leftColumn: 'id',
        rightColumn: 'id',
        chosen: ['region'],
      },
      {
        id: 3,
        type: 'CROSS',
        schema: 'ventas',
        table: 'regiones',
        leftJoinId: null,
        leftColumn: '',
        rightColumn: '',
        chosen: [],
      },
    ],
  }),
  'agrupado por columna y por mes, con HAVING y órdenes': model({
    joins: [CRUCE],
    grouped: true,
    groupByKeys: ['join:1:nombre', 'base:mes'],
    groupPeriods: { 'base:mes': 'month' },
    aggregates: [
      { id: 1, function: 'COUNT', columnKey: '*', alias: 'filas', distinct: false },
      { id: 2, function: 'SUM', columnKey: 'base:importe', alias: 'venta', distinct: false },
      { id: 3, function: 'COUNT', columnKey: 'base:nota', alias: '', distinct: true },
    ],
    having: [
      { id: 1, aggregateId: 2, operator: '>', value: '100', conjunction: 'AND' },
      { id: 2, aggregateId: 1, operator: '>=', value: '2', conjunction: 'OR' },
    ],
    orders: [
      { id: 1, target: 'aggregate:2', descending: true },
      { id: 2, target: 'group:base:mes', descending: false },
      { id: 3, target: 'group:join:1:nombre', descending: false },
    ],
    filters: [{ column: 'mes', operator: '>=', value: '2026-01-01' }],
  }),
  'total general': model({
    grouped: true,
    aggregates: [
      { id: 1, function: 'AVG', columnKey: 'base:importe', alias: 'media', distinct: false },
    ],
  }),
  'agrupado por trimestre y año': model({
    grouped: true,
    groupByKeys: ['base:mes'],
    groupPeriods: { 'base:mes': 'quarter' },
    aggregates: [{ id: 1, function: 'MAX', columnKey: 'base:importe', alias: '', distinct: false }],
  }),
};

describe('sqlToModel', () => {
  describe('ida y vuelta: escribir, leer y escribir da el mismo SQL', () => {
    for (const [name, value] of Object.entries(CASOS)) {
      it(name, () => {
        for (const engine of ENGINES) {
          const { sql, again } = roundTrip(engine, value);
          expect(again, `${engine}\n${sql}`).toBe(sql);
        }
      });
    }

    it('por día y por año, en cada motor', () => {
      for (const period of ['day', 'year'] as const) {
        const value = model({
          grouped: true,
          groupByKeys: ['base:mes'],
          groupPeriods: { 'base:mes': period },
          aggregates: [{ id: 1, function: 'COUNT', columnKey: '*', alias: '', distinct: false }],
        });
        for (const engine of ENGINES) {
          const { sql, again } = roundTrip(engine, value);
          expect(again, `${engine}\n${sql}`).toBe(sql);
        }
      }
    });
  });

  describe('lo que no entiende queda escrito a mano', () => {
    it('una expresión pasa a columna calculada, con su alias', () => {
      const read = sqlToModel(
        `SELECT "id", CASE WHEN "importe" > 100 THEN 'alto' ELSE 'bajo' END AS "tramo" FROM "ventas"."ventas"`,
        context('postgresql'),
      );

      expect(read.ok && read.form.expressions).toEqual([
        {
          id: 1,
          alias: 'tramo',
          sql: `CASE WHEN "importe" > 100 THEN 'alto' ELSE 'bajo' END`,
          aggregate: false,
        },
      ]);
      expect(read.ok && read.handPieces).toBe(1);
    });

    it('un cálculo sobre el grupo se reconoce como tal', () => {
      const read = sqlToModel(
        `SELECT "municipio_id", SUM("importe") / NULLIF(COUNT(*), 0) AS "media" FROM "ventas"."ventas" GROUP BY "municipio_id"`,
        context('postgresql'),
      );

      expect(read.ok && read.form.grouped).toBe(true);
      expect(read.ok && read.form.expressions[0]).toMatchObject({
        alias: 'media',
        aggregate: true,
      });
    });

    it('una condición sobre otra tabla, o un número entre comillas, queda a mano', () => {
      const read = sqlToModel(
        `SELECT * FROM "ventas"."ventas" AS "t0" LEFT JOIN "ventas"."municipios" AS "t1" ON "t0"."municipio_id" = "t1"."id"
         WHERE "t0"."importe" > 5 AND "t1"."nombre" = 'Ana' AND "t0"."municipio_id" = '05001'`,
        context('postgresql'),
      );

      expect(read.ok && read.form.filters).toEqual([
        { column: 'importe', operator: '>', value: '5' },
      ]);
      expect(read.ok && read.form.conditions.map((item) => item.sql)).toEqual([
        `"t1"."nombre" = 'Ana'`,
        `"t0"."municipio_id" = '05001'`,
      ]);
    });

    it('lo que queda a mano usa los alias del compositor, que son los que tendrá la consulta', () => {
      const conCruce = sqlToModel(
        `SELECT v.mes, UPPER(m.nombre) AS nombre FROM ventas v JOIN municipios m ON v.municipio_id = m.id
         WHERE m.nombre <> 'Nadie'`,
        context('postgresql'),
      );

      expect(conCruce.ok && conCruce.form.expressions[0].sql).toBe('UPPER("t1".nombre)');
      expect(conCruce.ok && conCruce.form.conditions[0].sql).toBe(`"t1".nombre <> 'Nadie'`);

      // Sin cruces la consulta no lleva alias: la columna queda sola.
      const sinCruce = sqlToModel(
        `SELECT v.mes FROM ventas v WHERE v.importe * 2 > v.id`,
        context('postgresql'),
      );

      expect(sinCruce.ok && sinCruce.form.conditions[0].sql).toBe('importe * 2 > id');
    });

    it('A OR B AND C no se convierte en (A OR B) AND C', () => {
      const read = sqlToModel(
        `SELECT * FROM ventas WHERE importe > 1 OR importe < 0 AND nota IS NULL`,
        context('postgresql'),
      );

      expect(read.ok && read.form.filters).toEqual([
        { column: 'importe', operator: '>', value: '1' },
      ]);
      expect(read.ok && read.form.conditions).toEqual([
        { id: 1, sql: 'importe < 0 AND nota IS NULL', conjunction: 'OR' },
      ]);
    });

    it('en Oracle, los nombres en mayúsculas vuelven a los del catálogo', () => {
      const read = sqlToModel(
        'SELECT T0.MES, T1.NOMBRE FROM VENTAS.VENTAS T0 INNER JOIN VENTAS.MUNICIPIOS T1 ON T0.MUNICIPIO_ID = T1.ID FETCH FIRST 5 ROWS ONLY',
        context('oracle'),
      );

      expect(read.ok && read.form.chosen).toEqual(['mes']);
      expect(read.ok && read.joins[0]).toMatchObject({
        table: 'municipios',
        leftColumn: 'municipio_id',
        rightColumn: 'id',
        chosen: ['nombre'],
      });
      expect(read.ok && read.form.limit).toBe(5);
    });
  });

  describe('lo que cambia la forma deja el SQL como está', () => {
    const cases: [string, string][] = [
      ['with', 'WITH x AS (SELECT 1) SELECT * FROM ventas'],
      ['setOperation', 'SELECT id FROM ventas UNION SELECT id FROM ventas'],
      ['subqueryFrom', 'SELECT * FROM (SELECT * FROM ventas) v'],
      ['otherTable', 'SELECT * FROM municipios'],
      ['unknownTable', 'SELECT * FROM ventas t0 JOIN otra t1 ON t0.id = t1.id'],
      [
        'joinCondition',
        'SELECT * FROM ventas t0 JOIN municipios t1 ON t0.id = t1.id AND t1.nombre = 1',
      ],
      ['several', 'SELECT * FROM ventas; DELETE FROM ventas'],
      ['notSelect', 'DELETE FROM ventas'],
      ['orderBy', 'SELECT * FROM ventas OFFSET 5'],
      [
        'orderBy',
        'SELECT * FROM ventas t0 JOIN municipios t1 ON t0.municipio_id = t1.id ORDER BY t1.nombre',
      ],
      ['groupBy', 'SELECT nota, COUNT(*) FROM ventas GROUP BY mes'],
      ['having', 'SELECT COUNT(*) FROM ventas HAVING SUM(importe) > 1'],
      ['unreadable', "SELECT 'sin cerrar FROM ventas"],
    ];

    for (const [reason, sql] of cases) {
      it(`${reason}: ${sql}`, () => {
        expect(sqlToModel(sql, context('postgresql'))).toEqual({ ok: false, reason });
      });
    }
  });

  it('dice qué tablas cruza, para cargar sus columnas antes', () => {
    expect(
      referencedTables(
        'SELECT * FROM ventas t0 JOIN municipios t1 ON t0.municipio_id = t1.id CROSS JOIN otra',
        TABLES,
      ).map((table) => table.id),
    ).toEqual(['tbl-municipios']);
  });
});
