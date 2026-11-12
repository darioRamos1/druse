import { InputKind, KnownColumn } from '../../shared/models/workspace';
import {
  AggregateFilter,
  AggregateFunction,
  DatePeriod,
  FilterOperator,
  JoinType,
  QueryFilter,
  QueryJoin,
  SelectAggregate,
  SelectColumn,
  SelectOrder,
  SelectSpec,
  inSubquery,
} from '../query-editor/sql-language/sql-writer';

/**
 * El modelo de un SELECT del compositor, sin Angular.
 *
 * Hasta ahora vivía repartido en las señales del componente, y cualquier otra
 * forma de editar la misma consulta —el lienzo visual— habría tenido que copiar
 * sus reglas. Aquí están una sola vez: quien edita llama a estas funciones y el
 * SQL sale siempre de `toSelectSpec`, se edite desde donde se edite.
 *
 * Todo es inmutable: cada operación devuelve un modelo nuevo.
 */

export interface AggregateDraft {
  readonly id: number;
  readonly function: AggregateFunction;
  readonly columnKey: '*' | string;
  readonly alias: string;
  readonly distinct: boolean;
}

export interface HavingDraft {
  readonly id: number;
  readonly aggregateId: number;
  readonly operator: FilterOperator;
  readonly value: string | null;
  readonly conjunction: 'AND' | 'OR';
}

export interface OrderDraft {
  readonly id: number;
  /** `column:nombre`, `group:clave` o `aggregate:id`; vacío mientras no se elige. */
  readonly target: string;
  readonly descending: boolean;
}

/** Un cruce del modelo. `table` vacío: la tabla aún no se conoce y el cruce no cuenta. */
export interface ModelJoin {
  readonly id: number;
  readonly type: JoinType;
  readonly schema: string;
  readonly table: string;
  /** `null` representa la tabla principal; un número, un JOIN anterior. */
  readonly leftJoinId: number | null;
  readonly leftColumn: string;
  readonly rightColumn: string;
  readonly chosen: readonly string[];
}

/** Todo lo del SELECT que no son los cruces. */
export interface SelectForm {
  readonly chosen: readonly string[];
  readonly filters: readonly QueryFilter[];
  readonly grouped: boolean;
  readonly groupByKeys: readonly string[];
  readonly groupPeriods: Readonly<Record<string, DatePeriod | 'none' | undefined>>;
  readonly aggregates: readonly AggregateDraft[];
  readonly having: readonly HavingDraft[];
  readonly orders: readonly OrderDraft[];
  readonly limit: number | null;
  readonly distinct: boolean;
}

export interface SelectModel extends SelectForm {
  readonly joins: readonly ModelJoin[];
}

/** Lo que el modelo necesita saber del catálogo: la tabla y las columnas ya cargadas. */
export interface ModelCatalog {
  readonly table: { readonly schema?: string; readonly name: string };
  readonly columns: readonly KnownColumn[];
  /** Columnas de cada cruce, por su id. Falta mientras se cargan. */
  readonly joinColumns: ReadonlyMap<number, readonly KnownColumn[]>;
}

/** Una columna que se puede agrupar, agregar u ordenar, con su referencia en el SQL. */
export interface QueryColumnOption {
  readonly key: string;
  readonly label: string;
  readonly reference: string | SelectColumn;
  readonly column: KnownColumn;
}

/** Algo que impide generar la consulta, como clave de idioma y sus valores. */
export type ModelProblem =
  | { readonly key: 'builder.inQueryInvalid' }
  | { readonly key: 'builder.needsGroupOrAggregate' }
  | { readonly key: 'builder.needsConcreteColumn' }
  | {
      readonly key: 'builder.needsNumeric';
      readonly function: AggregateFunction;
      readonly column: string;
    }
  | { readonly key: 'builder.needsDate'; readonly period: DatePeriod; readonly column: string };

export const DEFAULT_ORDERS: readonly OrderDraft[] = [{ id: 1, target: '', descending: false }];

export function emptySelectForm(): SelectForm {
  return {
    chosen: [],
    filters: [],
    grouped: false,
    groupByKeys: [],
    groupPeriods: {},
    aggregates: [],
    having: [],
    orders: DEFAULT_ORDERS,
    limit: 100,
    distinct: false,
  };
}

/** Quita los cruces: lo que queda es lo que guarda el formulario. */
export function formOf(model: SelectModel): SelectForm {
  const { joins: _joins, ...form } = model;
  return form;
}

// ── Columnas ────────────────────────────────────────────────────────────────

export function isNumericColumn(column: KnownColumn): boolean {
  return /\b(tinyint|smallint|integer|int|int2|int4|int8|bigint|serial|decimal|numeric|number|real|float|float4|float8|double|money)\b/i.test(
    column.dataType,
  );
}

export function isDateColumn(column: KnownColumn): boolean {
  return (
    column.inputKind === 'date' ||
    column.inputKind === 'datetime' ||
    column.inputKind === 'datetimeOffset' ||
    /(date|datetime2?|smalldatetime|timestamp)/i.test(column.dataType)
  );
}

/** `IS NULL` y `IS NOT NULL` no llevan valor. */
export function needsValue(operator: FilterOperator): boolean {
  return operator !== 'IS NULL' && operator !== 'IS NOT NULL';
}

/** Lista separada por comas o subconsulta. */
export function isList(operator: FilterOperator): boolean {
  return operator === 'IN' || operator === 'NOT IN';
}

function joined(join: ModelJoin): boolean {
  return join.table.length > 0;
}

/** Alias con el que el SQL nombra cada cruce: su posición entre todos, no solo los válidos. */
function joinAlias(joins: readonly ModelJoin[], id: number): string {
  return `t${joins.findIndex((candidate) => candidate.id === id) + 1}`;
}

/** Los cruces que llegan al SQL. Uno sin tabla se salta, pero no mueve los alias de los demás. */
export function toQueryJoins(joins: readonly ModelJoin[]): QueryJoin[] {
  return joins.flatMap((join, index) =>
    joined(join)
      ? [
          {
            type: join.type,
            schema: join.schema || undefined,
            table: join.table,
            alias: `t${index + 1}`,
            leftAlias: join.leftJoinId === null ? 't0' : joinAlias(joins, join.leftJoinId),
            leftColumn: join.leftColumn,
            rightColumn: join.rightColumn,
          },
        ]
      : [],
  );
}

/** Columnas disponibles para agrupar, agregar y ordenar, incluidas las de los cruces válidos. */
export function queryColumns(
  model: SelectModel,
  catalog: ModelCatalog,
): readonly QueryColumnOption[] {
  const aliases = toQueryJoins(model.joins).length > 0;
  const base = catalog.columns.map((column) => ({
    key: `base:${column.name}`,
    label: aliases ? `t0 · ${column.name}` : column.name,
    reference: aliases ? ({ alias: 't0', column: column.name } as SelectColumn) : column.name,
    column,
  }));
  const fromJoins = model.joins.flatMap((join, index) =>
    joined(join)
      ? (catalog.joinColumns.get(join.id) ?? []).map((column) => ({
          key: `join:${join.id}:${column.name}`,
          label: `t${index + 1} · ${column.name}`,
          reference: { alias: `t${index + 1}`, column: column.name },
          column,
        }))
      : [],
  );

  return [...base, ...fromJoins];
}

function findOption(
  options: readonly QueryColumnOption[],
  key: string,
): QueryColumnOption | undefined {
  return options.find((option) => option.key === key);
}

// ── SQL ─────────────────────────────────────────────────────────────────────

function selectedColumns(model: SelectModel): readonly (string | SelectColumn)[] {
  if (model.joins.length === 0) {
    return model.chosen;
  }

  return [
    ...model.chosen.map((column) => ({ alias: 't0', column })),
    ...model.joins.flatMap((join, index) =>
      join.chosen.map((column) => ({ alias: `t${index + 1}`, column })),
    ),
  ];
}

export function toAggregate(
  aggregate: AggregateDraft,
  options: readonly QueryColumnOption[],
): SelectAggregate | undefined {
  const column =
    aggregate.columnKey === '*' ? '*' : findOption(options, aggregate.columnKey)?.reference;

  return column
    ? {
        function: aggregate.function,
        column,
        alias: aggregate.alias.trim() || undefined,
        distinct: aggregate.distinct,
      }
    : undefined;
}

function toHaving(model: SelectModel, options: readonly QueryColumnOption[]): AggregateFilter[] {
  return model.having.flatMap((filter) => {
    const draft = model.aggregates.find((aggregate) => aggregate.id === filter.aggregateId);
    const aggregate = draft ? toAggregate(draft, options) : undefined;

    return aggregate
      ? [
          {
            aggregate,
            operator: filter.operator,
            value: filter.value,
            conjunction: filter.conjunction,
          },
        ]
      : [];
  });
}

function toOrders(model: SelectModel, options: readonly QueryColumnOption[]): SelectOrder[] {
  const result: SelectOrder[] = [];

  for (const order of model.orders) {
    if (!order.target) {
      continue;
    }

    if (order.target.startsWith('column:')) {
      result.push({
        expression: order.target.slice('column:'.length),
        descending: order.descending,
      });
      continue;
    }

    if (order.target.startsWith('aggregate:')) {
      const id = Number(order.target.slice('aggregate:'.length));
      const draft = model.aggregates.find((aggregate) => aggregate.id === id);
      const aggregate = draft ? toAggregate(draft, options) : undefined;
      if (aggregate) {
        result.push({ expression: aggregate, descending: order.descending });
      }
      continue;
    }

    const key = order.target.slice('group:'.length);
    const option = findOption(options, key);
    const period = model.groupPeriods[key] ?? 'none';

    if (!option) {
      continue;
    }

    result.push({
      expression:
        period === 'none'
          ? option.reference
          : { column: option.reference, period, alias: `${option.column.name}_${period}` },
      descending: order.descending,
    });
  }

  return result;
}

/** Lo que `buildSelect` necesita para escribir la consulta. */
export function toSelectSpec(model: SelectModel, catalog: ModelCatalog): SelectSpec {
  const options = queryColumns(model, catalog);
  const queryJoins = toQueryJoins(model.joins);
  const grouped = model.grouped;
  const plainGroups = grouped
    ? model.groupByKeys.flatMap((key) => {
        const option = findOption(options, key);
        return option && (model.groupPeriods[key] ?? 'none') === 'none' ? [option.reference] : [];
      })
    : [];

  return {
    schema: catalog.table.schema,
    table: catalog.table.name,
    alias: queryJoins.length > 0 ? 't0' : undefined,
    columns: grouped ? plainGroups : queryJoins.length > 0 ? selectedColumns(model) : model.chosen,
    joins: queryJoins,
    filters: model.filters.filter((filter) => filter.column.length > 0),
    groupBy: grouped ? plainGroups : undefined,
    dateGroups: grouped
      ? model.groupByKeys.flatMap((key) => {
          const option = findOption(options, key);
          const period = model.groupPeriods[key] ?? 'none';
          return option && period !== 'none'
            ? [{ column: option.reference, period, alias: `${option.column.name}_${period}` }]
            : [];
        })
      : undefined,
    aggregates: grouped
      ? model.aggregates.flatMap((aggregate) => {
          const converted = toAggregate(aggregate, options);
          return converted ? [converted] : [];
        })
      : [],
    having: grouped ? toHaving(model, options) : undefined,
    orders: toOrders(model, options),
    limit: model.limit,
    // Con GROUP BY cada grupo ya sale una sola vez: DISTINCT no añadiría nada.
    distinct: !grouped && model.distinct,
  };
}

// ── Validación ──────────────────────────────────────────────────────────────

/**
 * Algún filtro sin su valor.
 *
 * Ejecutar entonces enseñaría un error de sintaxis por cada campo que se está a
 * medio escribir.
 */
export function hasPendingValues(model: SelectModel): boolean {
  return [...model.filters, ...(model.grouped ? model.having : [])].some(
    (filter) =>
      needsValue(filter.operator) &&
      !(filter as QueryFilter).compareColumn &&
      (filter.value === null ||
        (isList(filter.operator) && !filter.value?.trim()) ||
        (filter.operator === 'BETWEEN' && (filter as QueryFilter).valueTo == null)),
  );
}

export function validate(model: SelectModel, catalog: ModelCatalog): readonly ModelProblem[] {
  const problems: ModelProblem[] = [];

  for (const filter of model.filters) {
    if (
      isList(filter.operator) &&
      filter.inSource === 'query' &&
      filter.value?.trim() &&
      !inSubquery(filter.value)
    ) {
      problems.push({ key: 'builder.inQueryInvalid' });
    }
  }

  if (!model.grouped) {
    return problems;
  }

  if (model.groupByKeys.length === 0 && model.aggregates.length === 0) {
    problems.push({ key: 'builder.needsGroupOrAggregate' });
  }

  const options = queryColumns(model, catalog);

  for (const aggregate of model.aggregates) {
    const column = findOption(options, aggregate.columnKey)?.column;

    if (
      column &&
      (aggregate.function === 'SUM' || aggregate.function === 'AVG') &&
      !isNumericColumn(column)
    ) {
      problems.push({
        key: 'builder.needsNumeric',
        function: aggregate.function,
        column: column.name,
      });
    }

    if (aggregate.distinct && aggregate.columnKey === '*') {
      problems.push({ key: 'builder.needsConcreteColumn' });
    }
  }

  for (const key of model.groupByKeys) {
    const period = model.groupPeriods[key] ?? 'none';
    const column = findOption(options, key)?.column;
    if (period !== 'none' && column && !isDateColumn(column)) {
      problems.push({ key: 'builder.needsDate', period, column: column.name });
    }
  }

  return problems;
}

// ── Etiquetas y tipos de valor ─────────────────────────────────────────────

export function aggregateLabel(
  aggregate: AggregateDraft,
  options: readonly QueryColumnOption[],
): string {
  const column =
    aggregate.columnKey === '*' ? '*' : (findOption(options, aggregate.columnKey)?.label ?? '?');

  return `${aggregate.function}(${column})${aggregate.alias ? ` · ${aggregate.alias}` : ''}`;
}

export function aggregateLabelForOrder(
  aggregate: AggregateDraft,
  options: readonly QueryColumnOption[],
): string {
  const column =
    aggregate.columnKey === '*' ? '*' : (findOption(options, aggregate.columnKey)?.label ?? '?');
  return `${aggregate.function}(${aggregate.distinct ? 'DISTINCT ' : ''}${column})`;
}

/** Por qué se puede ordenar: las columnas sin agrupar; con GROUP BY, grupos y cálculos. */
export function orderOptions(
  model: SelectModel,
  catalog: ModelCatalog,
): readonly { readonly value: string; readonly label: string }[] {
  if (!model.grouped) {
    return catalog.columns.map((column) => ({
      value: `column:${column.name}`,
      label: column.name,
    }));
  }

  const options = queryColumns(model, catalog);
  const chosen = new Set(model.groupByKeys);

  return [
    ...options
      .filter((column) => chosen.has(column.key))
      .map((column) => ({ value: `group:${column.key}`, label: column.label })),
    ...model.aggregates.map((aggregate) => ({
      value: `aggregate:${aggregate.id}`,
      label: aggregateLabelForOrder(aggregate, options),
    })),
  ];
}

export function havingKind(
  model: SelectModel,
  catalog: ModelCatalog,
  filter: HavingDraft,
): InputKind {
  const aggregate = model.aggregates.find((item) => item.id === filter.aggregateId);

  if (!aggregate || aggregate.function === 'COUNT') {
    return 'integer';
  }

  if (aggregate.function === 'SUM' || aggregate.function === 'AVG') {
    return 'decimal';
  }

  return findOption(queryColumns(model, catalog), aggregate.columnKey)?.column.inputKind ?? 'text';
}

/** Con qué control se pide el valor de un filtro. `IN` espera una lista: texto libre. */
export function filterKind(filter: QueryFilter, columns: readonly KnownColumn[]): InputKind {
  if (isList(filter.operator)) {
    return 'text';
  }

  return columns.find((column) => column.name === filter.column)?.inputKind ?? 'text';
}

// ── Operaciones ─────────────────────────────────────────────────────────────

function nextId(items: readonly { readonly id: number }[]): number {
  return Math.max(0, ...items.map((item) => item.id)) + 1;
}

/** Sin ninguna marcada se escribe `*`, que es lo que se quiere al empezar. */
export function toggleColumn(model: SelectModel, name: string): SelectModel {
  return {
    ...model,
    chosen: model.chosen.includes(name)
      ? model.chosen.filter((item) => item !== name)
      : [...model.chosen, name],
  };
}

export function chooseColumns(model: SelectModel, names: readonly string[]): SelectModel {
  return { ...model, chosen: [...new Set([...model.chosen, ...names])] };
}

export function clearColumns(model: SelectModel): SelectModel {
  return { ...model, chosen: [] };
}

export function setDistinct(model: SelectModel, distinct: boolean): SelectModel {
  return { ...model, distinct };
}

/** Un límite que no es un número positivo quita el límite. */
export function setLimit(model: SelectModel, value: string): SelectModel {
  const number = Number.parseInt(value, 10);
  return { ...model, limit: Number.isFinite(number) && number > 0 ? number : null };
}

function preferredAggregateColumn(
  model: SelectModel,
  options: readonly QueryColumnOption[],
  fn: AggregateFunction,
): string {
  const preferred =
    fn === 'SUM' || fn === 'AVG'
      ? (options.find((option) => isNumericColumn(option.column) && !option.column.isPrimaryKey) ??
        options.find((option) => isNumericColumn(option.column)))
      : options.find((option) => model.chosen.includes(option.column.name));
  return preferred?.key ?? options[0]?.key ?? '';
}

/**
 * Añade un cálculo. Sin agrupar, activa la agrupación sin columnas: es un
 * total general, y GROUP BY se elige por separado.
 */
export function addAggregate(
  model: SelectModel,
  catalog: ModelCatalog,
  fn: AggregateFunction,
  defaultAlias: string,
): SelectModel {
  const base: SelectModel = model.grouped
    ? model
    : { ...model, grouped: true, groupByKeys: [], orders: DEFAULT_ORDERS };
  const options = queryColumns(base, catalog);
  const id = nextId(base.aggregates);

  return {
    ...base,
    aggregates: [
      ...base.aggregates,
      {
        id,
        function: fn,
        columnKey: fn === 'COUNT' ? '*' : preferredAggregateColumn(base, options, fn),
        alias: id === 1 ? defaultAlias : `${defaultAlias}_${id}`,
        distinct: false,
      },
    ],
  };
}

export function patchAggregate(
  model: SelectModel,
  id: number,
  patch: Partial<AggregateDraft>,
): SelectModel {
  return {
    ...model,
    aggregates: model.aggregates.map((aggregate) =>
      aggregate.id === id ? { ...aggregate, ...patch } : aggregate,
    ),
  };
}

/** Al dejar de contar, `*` ya no vale: se propone una columna que tenga sentido. */
export function changeAggregateFunction(
  model: SelectModel,
  catalog: ModelCatalog,
  id: number,
  value: AggregateFunction,
): SelectModel {
  const aggregate = model.aggregates.find((item) => item.id === id);

  if (!aggregate) {
    return model;
  }

  return patchAggregate(model, id, {
    function: value,
    columnKey:
      value !== 'COUNT' && aggregate.columnKey === '*'
        ? preferredAggregateColumn(model, queryColumns(model, catalog), value)
        : aggregate.columnKey,
  });
}

/** Se lleva con él sus condiciones HAVING y deja sin destino el orden que lo usaba. */
export function removeAggregate(model: SelectModel, id: number): SelectModel {
  return {
    ...model,
    aggregates: model.aggregates.filter((aggregate) => aggregate.id !== id),
    having: model.having.filter((filter) => filter.aggregateId !== id),
    orders: model.orders.map((order) =>
      order.target === `aggregate:${id}` ? { ...order, target: '' } : order,
    ),
  };
}

export function toggleGrouping(
  model: SelectModel,
  catalog: ModelCatalog,
  defaultAlias: string,
): SelectModel {
  const grouped = !model.grouped;
  let next: SelectModel = { ...model, grouped, orders: DEFAULT_ORDERS };

  if (!grouped) {
    return next;
  }

  if (next.groupByKeys.length === 0) {
    const options = queryColumns(next, catalog);
    const selected = next.chosen
      .map((name) => `base:${name}`)
      .filter((key) => options.some((column) => column.key === key));
    const first = options[0]?.key;
    next = { ...next, groupByKeys: selected.length > 0 ? selected : first ? [first] : [] };
  }

  return next.aggregates.length === 0 ? addAggregate(next, catalog, 'COUNT', defaultAlias) : next;
}

export function toggleGroupColumn(model: SelectModel, key: string): SelectModel {
  const groupByKeys = model.groupByKeys.includes(key)
    ? model.groupByKeys.filter((item) => item !== key)
    : [...model.groupByKeys, key];

  return {
    ...model,
    groupByKeys,
    orders: model.orders.map((order) =>
      order.target === `group:${key}` && !groupByKeys.includes(key)
        ? { ...order, target: '' }
        : order,
    ),
  };
}

export function clearGroupColumns(model: SelectModel): SelectModel {
  return {
    ...model,
    groupByKeys: [],
    orders: model.orders.map((order) =>
      order.target.startsWith('group:') ? { ...order, target: '' } : order,
    ),
  };
}

export function setGroupPeriod(
  model: SelectModel,
  key: string,
  period: DatePeriod | 'none',
): SelectModel {
  return { ...model, groupPeriods: { ...model.groupPeriods, [key]: period } };
}

/** Quita lo que apuntaba a columnas que ya no existen, tras cambiar o quitar un cruce. */
export function pruneGrouping(model: SelectModel, catalog: ModelCatalog): SelectModel {
  const validKeys = new Set(queryColumns(model, catalog).map((column) => column.key));
  const removed = new Set(
    model.aggregates
      .filter((aggregate) => aggregate.columnKey !== '*' && !validKeys.has(aggregate.columnKey))
      .map((aggregate) => aggregate.id),
  );

  return {
    ...model,
    groupByKeys: model.groupByKeys.filter((key) => validKeys.has(key)),
    aggregates: model.aggregates.filter((aggregate) => !removed.has(aggregate.id)),
    having: model.having.filter((filter) => !removed.has(filter.aggregateId)),
  };
}

export function addHaving(model: SelectModel): SelectModel {
  const aggregate = model.aggregates[0];

  if (!aggregate) {
    return model;
  }

  return {
    ...model,
    having: [
      ...model.having,
      {
        id: nextId(model.having),
        aggregateId: aggregate.id,
        operator: '>',
        value: null,
        conjunction: 'AND',
      },
    ],
  };
}

export function patchHaving(
  model: SelectModel,
  id: number,
  patch: Partial<HavingDraft>,
): SelectModel {
  return {
    ...model,
    having: model.having.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)),
  };
}

export function removeHaving(model: SelectModel, id: number): SelectModel {
  return { ...model, having: model.having.filter((filter) => filter.id !== id) };
}

export function addOrder(model: SelectModel): SelectModel {
  return {
    ...model,
    orders: [...model.orders, { id: nextId(model.orders), target: '', descending: false }],
  };
}

export function patchOrder(
  model: SelectModel,
  id: number,
  patch: Partial<OrderDraft>,
): SelectModel {
  return {
    ...model,
    orders: model.orders.map((order) => (order.id === id ? { ...order, ...patch } : order)),
  };
}

export function removeOrder(model: SelectModel, id: number): SelectModel {
  return { ...model, orders: model.orders.filter((order) => order.id !== id) };
}

/**
 * Un filtro nuevo sobre la primera columna.
 *
 * `null` y no `''`: sin rellenar, el SQL lo marca como pendiente. Con cadena
 * vacía salía `"id" = ''`, una condición que parece completa.
 */
export function addFilter(model: SelectModel, catalog: ModelCatalog): SelectModel {
  return {
    ...model,
    filters: [
      ...model.filters,
      { column: catalog.columns[0]?.name ?? '', operator: '=', value: null, conjunction: 'AND' },
    ],
  };
}

export function removeFilter(model: SelectModel, index: number): SelectModel {
  return { ...model, filters: model.filters.filter((_, i) => i !== index) };
}

/** Pasar de un operador de lista a uno de valor, o al revés, vacía el valor: no se entienden. */
export function patchFilter(
  model: SelectModel,
  index: number,
  patch: Partial<QueryFilter>,
): SelectModel {
  return {
    ...model,
    filters: model.filters.map((filter, i) => {
      if (i !== index) return filter;
      if (patch.operator && isList(patch.operator) !== isList(filter.operator)) {
        return { ...filter, ...patch, value: null, compareColumn: null, inSource: 'list' };
      }
      return { ...filter, ...patch };
    }),
  };
}

// ── Lo que se guarda ────────────────────────────────────────────────────────

/**
 * Versión del formato guardado.
 *
 * 1 son las composiciones anteriores, sin número. La 2 añade la versión y las
 * posiciones del lienzo; se leen las dos sin migrar nada.
 */
export const COMPOSITION_FORMAT = 2;

/** Dónde quedó cada caja en el lienzo, por clave de tabla. */
export type CanvasLayout = Readonly<Record<string, { readonly x: number; readonly y: number }>>;

/** Un cruce tal como se guarda: lo justo para volver a montarlo. */
export interface SavedJoin extends ModelJoin {
  readonly tableId: string;
}

/**
 * El formulario de un SELECT, para poder volver a él.
 *
 * Antes solo se guardaba el SQL, y cargar una composición la dejaba como texto:
 * cambiar un filtro obligaba a rehacerla entera desde el formulario vacío.
 */
export interface CompositionState extends Omit<SelectForm, 'distinct'> {
  readonly version?: number;
  readonly joins: readonly SavedJoin[];
  /** Falta en las guardadas antes de que existiera. */
  readonly distinct?: boolean;
  /** El SQL retocado a mano, si lo estaba al guardar. */
  readonly sqlOverride: string | null;
  /** Falta en las que nunca se abrieron en el lienzo: se colocan solas. */
  readonly layout?: CanvasLayout;
}

export function compositionState(
  form: SelectForm,
  joins: readonly SavedJoin[],
  sqlOverride: string | null,
  layout?: CanvasLayout,
): CompositionState {
  return {
    version: COMPOSITION_FORMAT,
    chosen: form.chosen,
    joins,
    filters: form.filters,
    grouped: form.grouped,
    groupByKeys: form.groupByKeys,
    groupPeriods: form.groupPeriods,
    aggregates: form.aggregates,
    having: form.having,
    orders: form.orders,
    limit: form.limit,
    distinct: form.distinct,
    sqlOverride,
    ...(layout ? { layout } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Lee un estado guardado, de cualquier versión.
 *
 * Lo que falte toma el valor de un formulario vacío. Un valor que no es un
 * estado devuelve `null`: quien lo pidió lo trata como si no hubiera estado.
 */
export function readCompositionState(value: unknown): CompositionState | null {
  if (!isRecord(value)) {
    return null;
  }

  const empty = emptySelectForm();
  const form: SelectForm = {
    chosen: list<string>(value['chosen']),
    filters: list<QueryFilter>(value['filters']),
    grouped: value['grouped'] === true,
    groupByKeys: list<string>(value['groupByKeys']),
    groupPeriods: isRecord(value['groupPeriods'])
      ? (value['groupPeriods'] as SelectForm['groupPeriods'])
      : {},
    aggregates: list<AggregateDraft>(value['aggregates']),
    having: list<HavingDraft>(value['having']),
    orders: Array.isArray(value['orders']) ? (value['orders'] as OrderDraft[]) : empty.orders,
    limit:
      typeof value['limit'] === 'number' || value['limit'] === null
        ? (value['limit'] as number | null)
        : empty.limit,
    distinct: value['distinct'] === true,
  };
  const layout = isRecord(value['layout']) ? (value['layout'] as CanvasLayout) : undefined;

  return {
    ...compositionState(
      form,
      list<SavedJoin>(value['joins']),
      typeof value['sqlOverride'] === 'string' ? value['sqlOverride'] : null,
      layout,
    ),
    version: typeof value['version'] === 'number' ? value['version'] : 1,
  };
}
