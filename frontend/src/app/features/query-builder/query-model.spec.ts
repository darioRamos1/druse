import { describe, expect, it } from 'vitest';

import { DatabaseEngine, KnownColumn } from '../../shared/models/workspace';
import { SQL_DIALECTS } from '../query-editor/sql-language/sql-dialects';
import { buildSelect } from '../query-editor/sql-language/sql-writer';
import {
  COMPOSITION_FORMAT,
  ModelCatalog,
  SelectModel,
  addAggregate,
  addFilter,
  changeAggregateFunction,
  clearGroupColumns,
  compositionState,
  emptySelectForm,
  hasPendingValues,
  orderOptions,
  patchFilter,
  pruneGrouping,
  queryColumns,
  readCompositionState,
  removeAggregate,
  toQueryJoins,
  toSelectSpec,
  toggleGroupColumn,
  toggleGrouping,
  validate,
} from './query-model';

function col(name: string, dataType: string, extra: Partial<KnownColumn> = {}): KnownColumn {
  return { name, dataType, isNullable: true, isPrimaryKey: false, ...extra };
}

const VENTAS = [
  col('id', 'integer', { isPrimaryKey: true, isNullable: false }),
  col('mes', 'date', { inputKind: 'date' }),
  col('municipio_id', 'varchar(5)'),
  col('importe', 'numeric(10,2)', { inputKind: 'decimal' }),
];
const MUNICIPIOS = [col('id', 'varchar(5)', { isPrimaryKey: true }), col('nombre', 'varchar(80)')];

const ENGINES = Object.keys(SQL_DIALECTS) as DatabaseEngine[];

function catalog(joinColumns: [number, readonly KnownColumn[]][] = []): ModelCatalog {
  return {
    table: { schema: 'ventas', name: 'ventas' },
    columns: VENTAS,
    joinColumns: new Map(joinColumns),
  };
}

function model(patch: Partial<SelectModel> = {}): SelectModel {
  return { ...emptySelectForm(), joins: [], ...patch };
}

const CRUCE: SelectModel['joins'][number] = {
  id: 1,
  type: 'LEFT',
  schema: 'ventas',
  table: 'municipios',
  leftJoinId: null,
  leftColumn: 'municipio_id',
  rightColumn: 'id',
  chosen: ['nombre'],
};

describe('query-model', () => {
  describe('SQL', () => {
    it('escribe lo mismo que la especificación a mano en todos los motores', () => {
      const ventasPorMunicipio = model({
        joins: [CRUCE],
        grouped: true,
        groupByKeys: ['join:1:nombre', 'base:mes'],
        groupPeriods: { 'base:mes': 'month' },
        aggregates: [
          { id: 1, function: 'SUM', columnKey: 'base:importe', alias: 'venta', distinct: false },
        ],
        having: [{ id: 1, aggregateId: 1, operator: '>', value: '50', conjunction: 'AND' }],
        filters: [
          { column: 'mes', operator: '>=', value: '2026-01-01' },
          { column: '', operator: '=', value: 'sin columna' },
        ],
        orders: [{ id: 1, target: 'aggregate:1', descending: true }],
        limit: 10,
      });
      const venta = {
        function: 'SUM',
        column: { alias: 't0', column: 'importe' },
        alias: 'venta',
        distinct: false,
      } as const;

      for (const engine of ENGINES) {
        const spec = toSelectSpec(ventasPorMunicipio, catalog([[1, MUNICIPIOS]]));

        expect(buildSelect(engine, spec), engine).toBe(
          buildSelect(engine, {
            schema: 'ventas',
            table: 'ventas',
            alias: 't0',
            columns: [{ alias: 't1', column: 'nombre' }],
            joins: [
              {
                type: 'LEFT',
                schema: 'ventas',
                table: 'municipios',
                alias: 't1',
                leftAlias: 't0',
                leftColumn: 'municipio_id',
                rightColumn: 'id',
              },
            ],
            filters: [{ column: 'mes', operator: '>=', value: '2026-01-01' }],
            groupBy: [{ alias: 't1', column: 'nombre' }],
            dateGroups: [
              { column: { alias: 't0', column: 'mes' }, period: 'month', alias: 'mes_month' },
            ],
            aggregates: [venta],
            having: [{ aggregate: venta, operator: '>', value: '50', conjunction: 'AND' }],
            orders: [{ expression: venta, descending: true }],
            limit: 10,
            distinct: false,
          }),
        );
      }
    });

    it('sin cruces escribe las columnas sin alias y respeta DISTINCT', () => {
      const spec = toSelectSpec(model({ chosen: ['mes'], distinct: true }), catalog());

      expect(spec.alias).toBeUndefined();
      expect(spec.columns).toEqual(['mes']);
      expect(spec.distinct).toBe(true);
    });

    it('con GROUP BY no escribe DISTINCT: cada grupo ya sale una vez', () => {
      const spec = toSelectSpec(model({ grouped: true, distinct: true }), catalog());

      expect(spec.distinct).toBe(false);
    });

    it('un cruce sin tabla no llega al SQL, pero no mueve los alias de los demás', () => {
      const pendiente = { ...CRUCE, id: 1, table: '' };
      const segundo = { ...CRUCE, id: 2 };
      const joins = toQueryJoins([pendiente, segundo]);

      expect(joins).toHaveLength(1);
      expect(joins[0].alias).toBe('t2');
    });

    it('un cruce encadenado parte del alias del cruce anterior', () => {
      const tercero = { ...CRUCE, id: 7, leftJoinId: 1, leftColumn: 'id' };

      expect(toQueryJoins([CRUCE, tercero])[1].leftAlias).toBe('t1');
    });

    it('las columnas de un cruce solo se ofrecen cuando ya están cargadas', () => {
      const conCruce = model({ joins: [CRUCE] });

      expect(queryColumns(conCruce, catalog()).map((option) => option.key)).not.toContain(
        'join:1:nombre',
      );
      expect(queryColumns(conCruce, catalog([[1, MUNICIPIOS]]))[4]).toMatchObject({
        key: 'join:1:id',
        label: 't1 · id',
      });
    });
  });

  describe('validación', () => {
    it('pide una fecha para agrupar por periodo y números para SUM', () => {
      const problems = validate(
        model({
          grouped: true,
          groupByKeys: ['base:municipio_id'],
          groupPeriods: { 'base:municipio_id': 'year' },
          aggregates: [
            { id: 1, function: 'SUM', columnKey: 'base:municipio_id', alias: '', distinct: false },
            { id: 2, function: 'COUNT', columnKey: '*', alias: '', distinct: true },
          ],
        }),
        catalog(),
      );

      expect(problems).toEqual([
        { key: 'builder.needsNumeric', function: 'SUM', column: 'municipio_id' },
        { key: 'builder.needsConcreteColumn' },
        { key: 'builder.needsDate', period: 'year', column: 'municipio_id' },
      ]);
    });

    it('rechaza un IN con varias consultas separadas por punto y coma', () => {
      const problems = validate(
        model({
          filters: [
            {
              column: 'id',
              operator: 'IN',
              inSource: 'query',
              value: 'SELECT 1; SELECT 2',
            },
          ],
        }),
        catalog(),
      );

      expect(problems).toEqual([{ key: 'builder.inQueryInvalid' }]);
    });

    it('un BETWEEN sin su segundo extremo queda pendiente', () => {
      const between = model({ filters: [{ column: 'id', operator: 'BETWEEN', value: '1' }] });

      expect(hasPendingValues(between)).toBe(true);
      expect(
        hasPendingValues(
          model({ filters: [{ column: 'id', operator: 'BETWEEN', value: '1', valueTo: '9' }] }),
        ),
      ).toBe(false);
    });
  });

  describe('operaciones', () => {
    it('agrupar parte de las columnas marcadas y añade un recuento', () => {
      const next = toggleGrouping(model({ chosen: ['mes'] }), catalog(), 'cantidad');

      expect(next.grouped).toBe(true);
      expect(next.groupByKeys).toEqual(['base:mes']);
      expect(next.aggregates).toEqual([
        { id: 1, function: 'COUNT', columnKey: '*', alias: 'cantidad', distinct: false },
      ]);
    });

    it('un cálculo sin agrupar es un total general', () => {
      const next = addAggregate(model({ chosen: ['mes'] }), catalog(), 'SUM', 'cantidad');

      expect(next.grouped).toBe(true);
      expect(next.groupByKeys).toEqual([]);
      // SUM prefiere una columna numérica que no sea la clave.
      expect(next.aggregates[0].columnKey).toBe('base:importe');
      expect(addAggregate(next, catalog(), 'MAX', 'cantidad').aggregates[1].alias).toBe(
        'cantidad_2',
      );
    });

    it('al dejar de contar, * se cambia por una columna con sentido', () => {
      const conRecuento = addAggregate(model(), catalog(), 'COUNT', 'cantidad');

      expect(
        changeAggregateFunction(conRecuento, catalog(), 1, 'AVG').aggregates[0].columnKey,
      ).toBe('base:importe');
    });

    it('quitar un cálculo se lleva su HAVING y deja sin destino su orden', () => {
      const next = removeAggregate(
        model({
          aggregates: [{ id: 1, function: 'COUNT', columnKey: '*', alias: '', distinct: false }],
          having: [{ id: 1, aggregateId: 1, operator: '>', value: '1', conjunction: 'AND' }],
          orders: [{ id: 1, target: 'aggregate:1', descending: false }],
        }),
        1,
      );

      expect(next.aggregates).toEqual([]);
      expect(next.having).toEqual([]);
      expect(next.orders[0].target).toBe('');
    });

    it('desagrupar una columna o vaciar los grupos suelta los órdenes que la usaban', () => {
      const agrupado = model({
        grouped: true,
        groupByKeys: ['base:mes'],
        orders: [{ id: 1, target: 'group:base:mes', descending: false }],
      });

      expect(toggleGroupColumn(agrupado, 'base:mes').orders[0].target).toBe('');
      expect(clearGroupColumns(agrupado).orders[0].target).toBe('');
    });

    it('cambiar entre un operador de lista y uno de valor vacía el valor', () => {
      const conFiltro = addFilter(model(), catalog());

      expect(conFiltro.filters[0]).toEqual({
        column: 'id',
        operator: '=',
        value: null,
        conjunction: 'AND',
      });

      const conValor = patchFilter(conFiltro, 0, { value: '3' });
      const enLista = patchFilter(conValor, 0, { operator: 'IN' });

      expect(enLista.filters[0]).toMatchObject({ value: null, inSource: 'list' });
      expect(patchFilter(conValor, 0, { operator: '>' }).filters[0].value).toBe('3');
    });

    it('al quitar un cruce olvida los grupos y cálculos que apuntaban a él', () => {
      const conCruce = model({
        joins: [CRUCE],
        grouped: true,
        groupByKeys: ['join:1:nombre', 'base:mes'],
        aggregates: [
          { id: 1, function: 'COUNT', columnKey: 'join:1:id', alias: '', distinct: false },
          { id: 2, function: 'COUNT', columnKey: '*', alias: '', distinct: false },
        ],
        having: [{ id: 1, aggregateId: 1, operator: '>', value: '1', conjunction: 'AND' }],
      });
      const next = pruneGrouping({ ...conCruce, joins: [] }, catalog());

      expect(next.groupByKeys).toEqual(['base:mes']);
      expect(next.aggregates.map((aggregate) => aggregate.id)).toEqual([2]);
      expect(next.having).toEqual([]);
    });

    it('agrupado, se ordena por los grupos y los cálculos', () => {
      const options = orderOptions(
        model({
          grouped: true,
          groupByKeys: ['base:mes'],
          aggregates: [{ id: 3, function: 'COUNT', columnKey: '*', alias: '', distinct: true }],
        }),
        catalog(),
      );

      expect(options).toEqual([
        { value: 'group:base:mes', label: 'mes' },
        { value: 'aggregate:3', label: 'COUNT(DISTINCT *)' },
      ]);
    });
  });

  describe('estado guardado', () => {
    it('lee una composición de antes de la versión: sin DISTINCT ni posiciones', () => {
      const antigua = {
        chosen: ['mes'],
        joins: [],
        filters: [],
        grouped: false,
        groupByKeys: [],
        groupPeriods: {},
        aggregates: [],
        having: [],
        orders: [{ id: 1, target: 'column:mes', descending: true }],
        limit: null,
        sqlOverride: null,
      };

      expect(readCompositionState(antigua)).toMatchObject({
        version: 1,
        chosen: ['mes'],
        distinct: false,
        limit: null,
        orders: antigua.orders,
      });
      expect(readCompositionState(antigua)?.layout).toBeUndefined();
    });

    it('guarda la versión actual y conserva las posiciones del lienzo', () => {
      const layout = { 'ventas.ventas': { x: 10, y: 20 } };
      const saved = compositionState(emptySelectForm(), [], 'SELECT 1', layout);
      const leida = readCompositionState(JSON.parse(JSON.stringify(saved)));

      expect(saved.version).toBe(COMPOSITION_FORMAT);
      expect(leida).toEqual(saved);
    });

    it('lo que no es un estado se ignora en vez de romper el formulario', () => {
      expect(readCompositionState(null)).toBeNull();
      expect(readCompositionState('SELECT 1')).toBeNull();
      expect(readCompositionState([])).toBeNull();
      expect(readCompositionState({ chosen: 'mes' })?.chosen).toEqual([]);
    });
  });
});
