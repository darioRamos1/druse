import { DatabaseEngine, KnownColumn } from '../../shared/models/workspace';
import { SQL_DIALECTS } from '../query-editor/sql-language/sql-dialects';
import {
  AggregateFunction,
  DatePeriod,
  FilterOperator,
  JoinType,
  QueryFilter,
  inSubquery,
} from '../query-editor/sql-language/sql-writer';
import {
  AggregateDraft,
  ConditionDraft,
  DEFAULT_ORDERS,
  ExpressionDraft,
  HavingDraft,
  ModelJoin,
  OrderDraft,
  SelectForm,
} from './query-model';

/**
 * Del SQL al modelo del compositor: lo contrario de `buildSelect`.
 *
 * Solo entiende el SELECT que el lienzo sabe dibujar. Lo que no entiende **no
 * se pierde**: una expresión de columna pasa a columna calculada a mano y una
 * condición, a condición a mano. Si lo que no entiende cambia la forma de la
 * consulta —WITH, UNION, una subconsulta en FROM, otra tabla principal, un
 * ORDER BY o un HAVING que el modelo no puede representar—, no se convierte
 * nada y se dice por qué: el SQL se queda como estaba.
 *
 * No es un analizador de SQL completo, ni lo pretende: el motor es quien sabe
 * si la consulta es válida. Aquí solo se reconoce la forma.
 */

// ── Tokens ──────────────────────────────────────────────────────────────────

type TokenKind = 'word' | 'quoted' | 'string' | 'number' | 'symbol';

interface Token {
  readonly kind: TokenKind;
  /** El texto tal como está escrito. */
  readonly text: string;
  /** Sin comillas ni escapes: el nombre o el valor. */
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

const SYMBOLS = [
  '<>',
  '!=',
  '<=',
  '>=',
  '||',
  '::',
  '(',
  ')',
  ',',
  '.',
  '*',
  ';',
  '=',
  '<',
  '>',
  '+',
  '-',
  '/',
  '%',
];

function tokenize(sql: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  const push = (kind: TokenKind, start: number, end: number, value: string) =>
    tokens.push({ kind, text: sql.slice(start, end), value, start, end });

  /** Lee hasta el cierre, donde el cierre doble es el carácter escapado. */
  const enclosed = (close: string): string | null => {
    let value = '';
    let j = i + 1;

    while (j < sql.length) {
      if (sql[j] === close) {
        if (sql[j + 1] === close) {
          value += close;
          j += 2;
          continue;
        }
        i = j + 1;
        return value;
      }
      value += sql[j];
      j++;
    }

    return null;
  };

  while (i < sql.length) {
    const c = sql[i];

    if (/\s/.test(c)) {
      i++;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (c === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close < 0) return null;
      i = close + 2;
    } else if (c === "'") {
      const start = i;
      const value = enclosed("'");
      if (value === null) return null;
      push('string', start, i, value);
    } else if (c === '"' || c === '`' || c === '[') {
      const start = i;
      const value = enclosed(c === '[' ? ']' : c);
      if (value === null) return null;
      push('quoted', start, i, value);
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(sql.slice(i))!;
      push('number', i, i + match[0].length, match[0]);
      i += match[0].length;
    } else if (/[A-Za-z_À-￿]/.test(c)) {
      const match = /^[A-Za-z_À-￿][A-Za-z0-9_$#À-￿]*/.exec(sql.slice(i))!;
      push('word', i, i + match[0].length, match[0]);
      i += match[0].length;
    } else {
      const symbol = SYMBOLS.find((item) => sql.startsWith(item, i));
      if (!symbol) return null;
      push('symbol', i, i + symbol.length, symbol);
      i += symbol.length;
    }
  }

  return tokens;
}

const isWord = (token: Token | undefined, ...words: string[]) =>
  token?.kind === 'word' && words.includes(token.value.toUpperCase());

const isSymbol = (token: Token | undefined, symbol: string) =>
  token?.kind === 'symbol' && token.value === symbol;

const isName = (token: Token | undefined) =>
  token !== undefined &&
  (token.kind === 'quoted' || (token.kind === 'word' && !KEYWORDS.has(token.value.toUpperCase())));

/** Palabras que nunca son un nombre suelto: cortan una cláusula o una expresión. */
const KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP',
  'BY',
  'HAVING',
  'ORDER',
  'LIMIT',
  'FETCH',
  'OFFSET',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'MINUS',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'OUTER',
  'CROSS',
  'ON',
  'AS',
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS',
  'NULL',
  'LIKE',
  'BETWEEN',
  'DISTINCT',
  'TOP',
  'FIRST',
  'ASC',
  'DESC',
  'WITH',
  'WINDOW',
  'QUALIFY',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'ROWS',
  'ROW',
  'ONLY',
  'NEXT',
  'USING',
  'NATURAL',
  'APPLY',
  'LATERAL',
]);

const CLAUSES = ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'FETCH', 'OFFSET'];
const SET_OPERATIONS = ['UNION', 'INTERSECT', 'EXCEPT', 'MINUS'];
const AGGREGATES: readonly AggregateFunction[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

// ── Resultado ───────────────────────────────────────────────────────────────

/** Por qué una consulta no se puede llevar al lienzo, como clave de idioma. */
export type ReadOnlyReason =
  | 'unreadable'
  | 'notSelect'
  | 'several'
  | 'with'
  | 'setOperation'
  | 'subqueryFrom'
  | 'otherTable'
  | 'unknownTable'
  | 'joinCondition'
  | 'select'
  | 'groupBy'
  | 'having'
  | 'orderBy';

/** Un cruce leído, con la tabla ya resuelta en el catálogo. */
export interface ParsedJoin extends ModelJoin {
  readonly tableId: string;
}

export type SqlToModel =
  | {
      readonly ok: true;
      readonly form: SelectForm;
      readonly joins: readonly ParsedJoin[];
      /** Cuántas piezas quedaron escritas a mano: se dice al convertir. */
      readonly handPieces: number;
    }
  | { readonly ok: false; readonly reason: ReadOnlyReason };

/** Una tabla del catálogo, para resolver las que nombra el SQL. */
export interface CatalogTable {
  readonly id: string;
  readonly schema: string | null;
  readonly name: string;
}

export interface SqlToModelContext {
  readonly engine: DatabaseEngine;
  readonly table: { readonly schema?: string | null; readonly name: string };
  readonly columns: readonly KnownColumn[];
  readonly tables: readonly CatalogTable[];
  /** Columnas ya cargadas de una tabla cruzada, por su id; `[]` si no se conocen. */
  readonly columnsOf: (tableId: string) => readonly KnownColumn[];
}

class ReadOnly extends Error {
  constructor(readonly reason: ReadOnlyReason) {
    super(reason);
  }
}

// ── Estructura del SELECT ───────────────────────────────────────────────────

interface TableRef {
  readonly schema: string | null;
  readonly name: string;
  readonly alias: string;
}

interface JoinClause extends TableRef {
  readonly type: JoinType;
  readonly on: readonly Token[];
}

interface SelectParts {
  readonly limitFirst: number | null;
  readonly distinct: boolean;
  readonly items: readonly Token[][];
  readonly from: TableRef;
  readonly joins: readonly JoinClause[];
  readonly where: readonly Token[] | null;
  readonly groupBy: readonly Token[][];
  readonly having: readonly Token[] | null;
  readonly orderBy: readonly Token[][];
  readonly limitLast: number | null;
}

/** Corta en las comas que no están dentro de paréntesis. */
function splitTop(tokens: readonly Token[]): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;

  for (const token of tokens) {
    if (isSymbol(token, '(')) depth++;
    if (isSymbol(token, ')')) depth--;
    if (depth === 0 && isSymbol(token, ',')) {
      parts.push([]);
      continue;
    }
    parts[parts.length - 1].push(token);
  }

  return parts.filter((part) => part.length > 0);
}

function parseSelect(sql: string): SelectParts {
  const all = tokenize(sql);

  if (!all) {
    throw new ReadOnly('unreadable');
  }

  // Un punto y coma final es lo normal; uno en medio son dos sentencias.
  const tokens = all.filter((token, index) => !(isSymbol(token, ';') && index === all.length - 1));

  if (tokens.some((token) => isSymbol(token, ';'))) throw new ReadOnly('several');
  if (isWord(tokens[0], 'WITH')) throw new ReadOnly('with');
  if (!isWord(tokens[0], 'SELECT')) throw new ReadOnly('notSelect');

  // Las cláusulas se reconocen solo fuera de paréntesis.
  let depth = 0;
  for (const token of tokens) {
    if (isSymbol(token, '(')) depth++;
    if (isSymbol(token, ')')) depth--;
    if (depth === 0 && isWord(token, ...SET_OPERATIONS)) throw new ReadOnly('setOperation');
  }

  let i = 1;
  let limitFirst: number | null = null;
  let distinct = false;

  // TOP y FIRST van delante; DISTINCT, antes o después según el motor.
  for (let round = 0; round < 2; round++) {
    if (isWord(tokens[i], 'TOP', 'FIRST') && tokens[i + 1]?.kind === 'number') {
      limitFirst = Number(tokens[i + 1].value);
      i += 2;
    }
    if (isWord(tokens[i], 'DISTINCT')) {
      distinct = true;
      i++;
    }
  }

  const clauseAt = (from: number, ...words: string[]) => {
    let level = 0;
    for (let j = from; j < tokens.length; j++) {
      if (isSymbol(tokens[j], '(')) level++;
      if (isSymbol(tokens[j], ')')) level--;
      if (level === 0 && isWord(tokens[j], ...words)) return j;
    }
    return tokens.length;
  };

  const fromAt = clauseAt(i, 'FROM');
  if (fromAt >= tokens.length) throw new ReadOnly('notSelect');
  const items = splitTop(tokens.slice(i, fromAt));

  i = fromAt + 1;
  if (isSymbol(tokens[i], '(')) throw new ReadOnly('subqueryFrom');
  const [from, afterFrom] = tableRef(tokens, i);
  i = afterFrom;

  const joins: JoinClause[] = [];
  while (
    i < tokens.length &&
    isWord(tokens[i], 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN')
  ) {
    let type: JoinType = 'INNER';
    if (isWord(tokens[i], 'LEFT')) type = 'LEFT';
    if (isWord(tokens[i], 'RIGHT')) type = 'RIGHT';
    if (isWord(tokens[i], 'FULL')) type = 'FULL OUTER';
    if (isWord(tokens[i], 'CROSS')) type = 'CROSS';
    while (i < tokens.length && !isWord(tokens[i], 'JOIN')) i++;
    i++;
    if (isSymbol(tokens[i], '(')) throw new ReadOnly('subqueryFrom');
    const [ref, afterRef] = tableRef(tokens, i);
    i = afterRef;
    let on: Token[] = [];
    if (type !== 'CROSS') {
      if (!isWord(tokens[i], 'ON')) throw new ReadOnly('joinCondition');
      const end = clauseAt(i + 1, ...CLAUSES, 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN');
      on = tokens.slice(i + 1, end);
      i = end;
    }
    joins.push({ ...ref, type, on });
  }

  if (i < tokens.length && isSymbol(tokens[i], ',')) throw new ReadOnly('joinCondition');

  const section = (word: string, second?: string): Token[] | null => {
    if (!isWord(tokens[i], word)) return null;
    i++;
    if (second) {
      if (!isWord(tokens[i], second)) throw new ReadOnly('unreadable');
      i++;
    }
    const end = clauseAt(i, ...CLAUSES);
    const part = tokens.slice(i, end);
    i = end;
    return part;
  };

  const where = section('WHERE');
  const groupBy = splitTop(section('GROUP', 'BY') ?? []);
  const having = section('HAVING');
  const orderBy = splitTop(section('ORDER', 'BY') ?? []);

  let limitLast: number | null = null;
  if (isWord(tokens[i], 'LIMIT') && tokens[i + 1]?.kind === 'number') {
    limitLast = Number(tokens[i + 1].value);
    i += 2;
  } else if (
    isWord(tokens[i], 'FETCH') &&
    isWord(tokens[i + 1], 'FIRST', 'NEXT') &&
    tokens[i + 2]?.kind === 'number' &&
    isWord(tokens[i + 3], 'ROWS', 'ROW') &&
    isWord(tokens[i + 4], 'ONLY')
  ) {
    limitLast = Number(tokens[i + 2].value);
    i += 5;
  }

  // OFFSET, WINDOW, QUALIFY…: el modelo no los tiene y no se pueden callar.
  if (i < tokens.length) throw new ReadOnly('orderBy');

  return { limitFirst, distinct, items, from, joins, where, groupBy, having, orderBy, limitLast };
}

/** `[bd.][esquema.]tabla [[AS] alias]` */
function tableRef(tokens: readonly Token[], start: number): [TableRef, number] {
  const names: string[] = [];
  let i = start;

  if (!isName(tokens[i])) throw new ReadOnly('unreadable');
  names.push(tokens[i].value);
  i++;
  while (isSymbol(tokens[i], '.') && isName(tokens[i + 1])) {
    names.push(tokens[i + 1].value);
    i += 2;
  }

  const name = names[names.length - 1];
  const schema = names.length > 1 ? names[names.length - 2] : null;
  let alias = name;

  if (isWord(tokens[i], 'AS') && isName(tokens[i + 1])) {
    alias = tokens[i + 1].value;
    i += 2;
  } else if (isName(tokens[i])) {
    alias = tokens[i].value;
    i++;
  }

  return [{ schema, name, alias }, i];
}

// ── Piezas sueltas ──────────────────────────────────────────────────────────

/** Texto de unos tokens tal como se escribió, con sus espacios y comentarios. */
function source(sql: string, tokens: readonly Token[]): string {
  return tokens.length === 0 ? '' : sql.slice(tokens[0].start, tokens[tokens.length - 1].end);
}

/** Quita un par de paréntesis que envuelva todo, como los que pone el generador. */
function unwrap(tokens: readonly Token[]): readonly Token[] {
  if (!isSymbol(tokens[0], '(') || !isSymbol(tokens[tokens.length - 1], ')')) {
    return tokens;
  }

  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (isSymbol(tokens[i], '(')) depth++;
    if (isSymbol(tokens[i], ')')) depth--;
    if (depth === 0 && i < tokens.length - 1) return tokens;
  }

  return tokens.slice(1, -1);
}

interface ColumnRef {
  readonly qualifier: string | null;
  readonly column: string;
}

/** `[calificador.]columna`, y nada más. */
function columnRef(tokens: readonly Token[]): ColumnRef | null {
  if (tokens.length === 1 && isName(tokens[0])) {
    return { qualifier: null, column: tokens[0].value };
  }

  if (tokens.length === 3 && isName(tokens[0]) && isSymbol(tokens[1], '.') && isName(tokens[2])) {
    return { qualifier: tokens[0].value, column: tokens[2].value };
  }

  return null;
}

/** `FUNCIÓN([DISTINCT] * | columna)` con una de las cinco funciones del compositor. */
function aggregateCall(
  tokens: readonly Token[],
): { fn: AggregateFunction; distinct: boolean; arg: ColumnRef | '*' } | null {
  const fn = tokens[0]?.kind === 'word' ? tokens[0].value.toUpperCase() : '';

  if (
    !AGGREGATES.includes(fn as AggregateFunction) ||
    !isSymbol(tokens[1], '(') ||
    !isSymbol(tokens[tokens.length - 1], ')')
  ) {
    return null;
  }

  let inner = tokens.slice(2, -1);
  const distinct = isWord(inner[0], 'DISTINCT');
  if (distinct) inner = inner.slice(1);

  if (inner.length === 1 && isSymbol(inner[0], '*')) {
    return { fn: fn as AggregateFunction, distinct, arg: '*' };
  }

  const ref = columnRef(inner);
  return ref ? { fn: fn as AggregateFunction, distinct, arg: ref } : null;
}

/** Dónde se cierra el paréntesis que se abre en `open`; -1 si no está o no se cierra. */
function closingParen(tokens: readonly Token[], open: number): number {
  if (!isSymbol(tokens[open], '(')) return -1;

  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (isSymbol(tokens[i], '(')) depth++;
    if (isSymbol(tokens[i], ')')) depth--;
    if (depth === 0) return i;
  }

  return -1;
}

function containsAggregate(tokens: readonly Token[]): boolean {
  return tokens.some(
    (token, index) =>
      token.kind === 'word' &&
      AGGREGATES.includes(token.value.toUpperCase() as AggregateFunction) &&
      isSymbol(tokens[index + 1], '('),
  );
}

/** Separa `expresión [AS] alias`. */
function selectItem(tokens: readonly Token[]): { expr: readonly Token[]; alias: string | null } {
  const n = tokens.length;

  if (n >= 3 && isWord(tokens[n - 2], 'AS') && isName(tokens[n - 1])) {
    return { expr: tokens.slice(0, n - 2), alias: tokens[n - 1].value };
  }

  // Alias sin AS: solo detrás de algo que cierra una expresión.
  const before = tokens[n - 2];
  if (
    n >= 2 &&
    isName(tokens[n - 1]) &&
    (isSymbol(before, ')') || before.kind === 'quoted' || isName(before)) &&
    !(n === 2 && isName(before))
  ) {
    return { expr: tokens.slice(0, n - 1), alias: tokens[n - 1].value };
  }

  // `columna alias` también vale.
  if (n === 2 && isName(tokens[0]) && isName(tokens[1])) {
    return { expr: tokens.slice(0, 1), alias: tokens[1].value };
  }

  return { expr: tokens, alias: null };
}

/** Compara texto de SQL sin espacios ni mayúsculas: así se reconoce lo que escribe un dialecto. */
function sameSql(a: string, b: string): boolean {
  return a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
}

// ── Condiciones ─────────────────────────────────────────────────────────────

type BoolNode =
  | { readonly kind: 'leaf'; readonly tokens: readonly Token[] }
  | { readonly kind: 'group'; readonly node: BoolNode; readonly tokens: readonly Token[] }
  | {
      readonly kind: 'bin';
      readonly op: 'AND' | 'OR';
      readonly left: BoolNode;
      readonly right: BoolNode;
      readonly tokens: readonly Token[];
    };

/** AND une más que OR, como en SQL. BETWEEN … AND … no es una conjunción. */
function parseBool(tokens: readonly Token[]): BoolNode {
  let i = 0;

  const span = (from: number, to: number) => tokens.slice(from, to);

  const primary = (): BoolNode => {
    const start = i;

    if (isSymbol(tokens[i], '(')) {
      let depth = 0;
      let j = i;
      for (; j < tokens.length; j++) {
        if (isSymbol(tokens[j], '(')) depth++;
        if (isSymbol(tokens[j], ')')) depth--;
        if (depth === 0) break;
      }
      const next = tokens[j + 1];
      if (next === undefined || isWord(next, 'AND', 'OR')) {
        const inner = parseBool(tokens.slice(i + 1, j));
        i = j + 1;
        return { kind: 'group', node: inner, tokens: span(start, i) };
      }
    }

    let depth = 0;
    let between = false;
    for (; i < tokens.length; i++) {
      const token = tokens[i];
      if (isSymbol(token, '(')) depth++;
      if (isSymbol(token, ')')) depth--;
      if (depth > 0) continue;
      if (isWord(token, 'BETWEEN')) between = true;
      else if (isWord(token, 'AND') && between) between = false;
      else if (isWord(token, 'AND', 'OR')) break;
    }

    return { kind: 'leaf', tokens: span(start, i) };
  };

  const and = (): BoolNode => {
    const start = i;
    let left = primary();
    while (isWord(tokens[i], 'AND')) {
      i++;
      const right = primary();
      left = { kind: 'bin', op: 'AND', left, right, tokens: span(start, i) };
    }
    return left;
  };

  const start = i;
  let left = and();
  while (isWord(tokens[i], 'OR')) {
    i++;
    const right = and();
    left = { kind: 'bin', op: 'OR', left, right, tokens: span(start, i) };
  }

  if (i < tokens.length || left.tokens.length === 0) {
    // Algo que no se sabe partir: entero, como una sola pieza.
    return { kind: 'leaf', tokens: span(start, tokens.length) };
  }

  return left;
}

/**
 * La cadena que escribe el generador: cada conjunción se aplica a todo lo
 * anterior, con paréntesis donde cambia. Un lado derecho que no es una
 * condición suelta va entero, como una pieza: así no cambia lo que significa.
 */
function chain(node: BoolNode): { node: BoolNode; conjunction: 'AND' | 'OR' }[] {
  if (node.kind === 'group') return chain(node.node);
  if (node.kind === 'leaf') return [{ node, conjunction: 'AND' }];
  return [...chain(node.left), { node: node.right, conjunction: node.op }];
}

// ── Traducción ──────────────────────────────────────────────────────────────

interface Box {
  readonly key: string;
  readonly alias: string;
  readonly joinId: number | null;
  readonly columns: readonly KnownColumn[];
}

/**
 * Lleva un SELECT al modelo del compositor.
 *
 * Antes de llamarla conviene cargar las columnas de las tablas que cruza
 * (`referencedTables`): sin ellas, los nombres se quedan como están escritos,
 * que en Oracle es en mayúsculas.
 */
export function sqlToModel(sql: string, context: SqlToModelContext): SqlToModel {
  try {
    return translate(sql, parseSelect(sql), context);
  } catch (error) {
    if (error instanceof ReadOnly) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

/** Las tablas que cruza un SELECT, para cargar sus columnas antes de traducirlo. */
export function referencedTables(
  sql: string,
  tables: readonly CatalogTable[],
): readonly CatalogTable[] {
  try {
    const parts = parseSelect(sql);
    return parts.joins.flatMap((join) => {
      const found = findTable(tables, join);
      return found ? [found] : [];
    });
  } catch {
    return [];
  }
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

function findTable(tables: readonly CatalogTable[], ref: TableRef): CatalogTable | null {
  return (
    tables.find(
      (table) =>
        sameName(table.name, ref.name) &&
        (ref.schema === null || sameName(table.schema, ref.schema)),
    ) ?? null
  );
}

/** El nombre de la columna como lo tiene el catálogo; si no está, como se escribió. */
function canonical(columns: readonly KnownColumn[], name: string): string {
  return (
    columns.find((column) => column.name === name)?.name ??
    columns.find((column) => sameName(column.name, name))?.name ??
    name
  );
}

function translate(sql: string, parts: SelectParts, context: SqlToModelContext): SqlToModel {
  const { engine } = context;
  const dialect = SQL_DIALECTS[engine];

  if (
    !sameName(parts.from.name, context.table.name) ||
    (parts.from.schema !== null &&
      context.table.schema &&
      !sameName(parts.from.schema, context.table.schema))
  ) {
    throw new ReadOnly('otherTable');
  }

  // Las cajas: la principal y un cruce por JOIN, con ids en orden.
  const boxes: Box[] = [
    { key: 'base', alias: parts.from.alias, joinId: null, columns: context.columns },
  ];
  const joins: Omit<ParsedJoin, 'chosen'>[] = [];

  parts.joins.forEach((join, index) => {
    const found = findTable(context.tables, join);
    if (!found) throw new ReadOnly('unknownTable');

    const id = index + 1;
    const columns = context.columnsOf(found.id);
    const box: Box = { key: `join:${id}`, alias: join.alias, joinId: id, columns };
    let leftJoinId: number | null = null;
    let leftColumn = '';
    let rightColumn = '';

    if (join.type !== 'CROSS') {
      const on = unwrap(join.on);
      const eq = on.findIndex((token) => isSymbol(token, '='));
      const a = eq > 0 ? columnRef(on.slice(0, eq)) : null;
      const b = eq > 0 ? columnRef(on.slice(eq + 1)) : null;
      if (!a || !b || !a.qualifier || !b.qualifier) throw new ReadOnly('joinCondition');

      const [mine, other] = sameName(a.qualifier, join.alias) ? [a, b] : [b, a];
      const left = boxes.find((item) => sameName(item.alias, other.qualifier));
      if (!sameName(mine.qualifier, join.alias) || !left) throw new ReadOnly('joinCondition');

      leftJoinId = left.joinId;
      leftColumn = canonical(left.columns, other.column);
      rightColumn = canonical(columns, mine.column);
    }

    boxes.push(box);
    joins.push({
      id,
      type: join.type,
      tableId: found.id,
      schema: found.schema ?? '',
      table: found.name,
      leftJoinId,
      leftColumn,
      rightColumn,
    });
  });

  const hasJoins = joins.length > 0;

  /**
   * El texto de una pieza que queda a mano, con los alias del compositor.
   *
   * El compositor reescribe los alias —`t0` la principal, `t1`… los cruces, y
   * ninguno sin cruces—, así que un `c.nombre` escrito a mano dejaría de
   * existir en la consulta convertida. Se cambia solo el calificador; el resto
   * del texto, con sus espacios, se queda como estaba.
   */
  const handText = (tokens: readonly Token[]): string => {
    let text = '';
    let cursor = tokens[0]?.start ?? 0;
    let skip = -1;

    tokens.forEach((token, index) => {
      // El punto de un calificador que se ha quitado.
      if (index === skip) return;

      text += sql.slice(cursor, token.start);
      cursor = token.end;

      const qualifies =
        isName(token) &&
        isSymbol(tokens[index + 1], '.') &&
        !isSymbol(tokens[index - 1], '.') &&
        tokens[index + 2] !== undefined;
      const box = qualifies
        ? (boxes.find((item) => sameName(item.alias, token.value)) ??
          (sameName(token.value, context.table.name) ? boxes[0] : undefined))
        : undefined;

      if (!box) {
        text += token.text;
        return;
      }

      if (!hasJoins) {
        // Sin cruces la consulta no lleva alias: se escribe la columna sola.
        cursor = tokens[index + 1].end;
        skip = index + 1;
        return;
      }

      text += dialect.quote(box.joinId === null ? 't0' : `t${box.joinId}`);
    });

    return text;
  };

  /** La caja de una referencia: por su calificador, o la principal sin él. */
  const boxOf = (ref: ColumnRef): Box | null =>
    ref.qualifier === null
      ? boxes[0]
      : (boxes.find((box) => sameName(box.alias, ref.qualifier)) ??
        // Sin alias, el calificador es el nombre de la tabla.
        (sameName(ref.qualifier, context.table.name) ? boxes[0] : null));

  const keyOf = (ref: ColumnRef): string | null => {
    const box = boxOf(ref);
    if (!box) return null;
    const column = canonical(box.columns, ref.column);
    return box.joinId === null ? `base:${column}` : `join:${box.joinId}:${column}`;
  };

  /**
   * Si una expresión es el periodo de fecha de una columna, tal como lo escribe
   * este motor.
   *
   * Se prueba con cada columna que aparece en la expresión, escrita como la
   * escribiría el generador: con el alias del SQL, con el suyo (`t0`, `t1`…) y
   * sin calificar. Si alguna coincide, es ese periodo de esa columna.
   */
  const datePeriod = (tokens: readonly Token[]): { key: string; period: DatePeriod } | null => {
    const text = source(sql, tokens);

    for (let i = 0; i < tokens.length; i++) {
      for (const width of [3, 1]) {
        const ref = columnRef(tokens.slice(i, i + width));
        const box = ref ? boxOf(ref) : null;
        if (!ref || !box) continue;

        const column = canonical(box.columns, ref.column);
        const key = box.joinId === null ? `base:${column}` : `join:${box.joinId}:${column}`;
        const own = box.joinId === null ? 't0' : `t${box.joinId}`;
        const forms = [
          `${dialect.quote(box.alias)}.${dialect.quote(column)}`,
          `${dialect.quote(own)}.${dialect.quote(column)}`,
          dialect.quote(column),
          source(sql, tokens.slice(i, i + width)),
        ];

        for (const form of forms) {
          for (const period of ['day', 'month', 'quarter', 'year'] as const) {
            if (sameSql(dialect.dateTrunc(form, period), text)) return { key, period };
          }
        }
      }
    }

    return null;
  };

  // ── SELECT ──
  const chosen: string[] = [];
  const joinChosen = new Map<number, string[]>();
  const selectKeys: string[] = [];
  const periods: Record<string, DatePeriod> = {};
  const aggregates: AggregateDraft[] = [];
  const expressions: ExpressionDraft[] = [];
  let starred = false;

  for (const item of parts.items) {
    const { expr, alias } = selectItem(item);

    if (expr.length === 1 && isSymbol(expr[0], '*')) {
      starred = true;
      continue;
    }
    if (expr.length === 3 && isSymbol(expr[2], '*') && isSymbol(expr[1], '.')) {
      starred = true;
      continue;
    }

    const ref = alias === null ? columnRef(expr) : null;
    if (ref) {
      const box = boxOf(ref);
      if (!box) throw new ReadOnly('select');
      const column = canonical(box.columns, ref.column);
      if (box.joinId === null) chosen.push(column);
      else joinChosen.set(box.joinId, [...(joinChosen.get(box.joinId) ?? []), column]);
      selectKeys.push(keyOf(ref)!);
      continue;
    }

    const call = aggregateCall(expr);
    if (call) {
      const key = call.arg === '*' ? '*' : keyOf(call.arg);
      if (key !== null) {
        aggregates.push({
          id: aggregates.length + 1,
          function: call.fn,
          columnKey: key,
          alias: alias ?? '',
          distinct: call.distinct,
        });
        continue;
      }
    }

    const period = datePeriod(expr);
    if (period) {
      periods[period.key] = period.period;
      continue;
    }

    const inner = unwrap(expr);
    expressions.push({
      id: expressions.length + 1,
      alias: alias ?? '',
      sql: handText(inner),
      aggregate: containsAggregate(inner),
    });
  }

  // ── GROUP BY ──
  const groupByKeys: string[] = [];
  for (const item of parts.groupBy) {
    const ref = columnRef(item);
    const key = ref ? keyOf(ref) : null;
    if (key) {
      groupByKeys.push(key);
      continue;
    }
    const period = datePeriod(item);
    if (period) {
      groupByKeys.push(period.key);
      periods[period.key] = period.period;
      continue;
    }
    // Una expresión agrupada vale si es una columna calculada que ya está en el SELECT.
    const text = handText(unwrap(item));
    const expression = expressions.find((candidate) => sameSql(candidate.sql, text));
    if (expression && !expression.aggregate) continue;
    throw new ReadOnly('groupBy');
  }

  const grouped =
    parts.groupBy.length > 0 ||
    aggregates.length > 0 ||
    expressions.some((expression) => expression.aggregate);

  if (grouped) {
    // Con GROUP BY, el SELECT son los grupos: una columna suelta que no esté
    // agrupada no la acepta el motor, y el modelo no sabe escribirla.
    for (const key of selectKeys) {
      if (!groupByKeys.includes(key)) throw new ReadOnly('groupBy');
    }
    for (const key of Object.keys(periods)) {
      if (!groupByKeys.includes(key)) throw new ReadOnly('groupBy');
    }
  } else if (Object.keys(periods).length > 0) {
    // Un periodo sin agrupar no es algo que el modelo escriba: queda a mano.
    throw new ReadOnly('select');
  }

  if (starred && (chosen.length > 0 || joinChosen.size > 0)) {
    // `*` junto a columnas: el modelo no lo escribe.
    throw new ReadOnly('select');
  }

  // ── WHERE ──
  const filters: QueryFilter[] = [];
  const conditions: ConditionDraft[] = [];

  if (parts.where && parts.where.length > 0) {
    for (const { node, conjunction } of chain(parseBool(parts.where))) {
      // Detrás de una condición a mano todo va a mano: el generador las escribe
      // al final, y adelantar un filtro cambiaría dónde caen los paréntesis.
      const filter =
        conditions.length === 0 && node.kind === 'leaf' ? leafFilter(node.tokens) : null;

      if (filter) {
        filters.push(filters.length === 0 ? filter : { ...filter, conjunction });
      } else {
        const tokens = node.kind === 'group' ? node.tokens.slice(1, -1) : unwrap(node.tokens);
        conditions.push({ id: conditions.length + 1, sql: handText(tokens), conjunction });
      }
    }
  }

  function leafFilter(tokens: readonly Token[]): QueryFilter | null {
    // La columna: de la tabla principal, que es de donde son los filtros.
    let at = 0;
    let ref: ColumnRef | null = null;
    for (const width of [3, 1]) {
      const candidate = columnRef(tokens.slice(0, width));
      if (candidate && boxOf(candidate)?.joinId === null) {
        ref = candidate;
        at = width;
        break;
      }
    }
    if (!ref) return null;

    const column = canonical(context.columns, ref.column);
    const rest = tokens.slice(at);
    const value = (part: readonly Token[]): string | null => {
      if (part.length === 1 && part[0].kind === 'number') return part[0].value;
      if (part.length === 2 && isSymbol(part[0], '-') && part[1].kind === 'number') {
        return `-${part[1].value}`;
      }
      // Un texto que parece número lo escribiría sin comillas: no se toca.
      if (part.length === 1 && part[0].kind === 'string') {
        const text = part[0].value;
        return text.trim().length > 0 && Number.isFinite(Number(text.trim())) ? null : text;
      }
      return null;
    };

    if (isWord(rest[0], 'IS')) {
      if (rest.length === 2 && isWord(rest[1], 'NULL'))
        return { column, operator: 'IS NULL', value: null };
      if (rest.length === 3 && isWord(rest[1], 'NOT') && isWord(rest[2], 'NULL')) {
        return { column, operator: 'IS NOT NULL', value: null };
      }
      return null;
    }

    const not = isWord(rest[0], 'NOT');
    const body = not ? rest.slice(1) : rest;

    if (isWord(body[0], 'LIKE')) {
      const text = value(body.slice(1));
      return text === null ? null : { column, operator: not ? 'NOT LIKE' : 'LIKE', value: text };
    }

    if (isWord(body[0], 'IN') && isSymbol(body[1], '(') && isSymbol(body[body.length - 1], ')')) {
      const inner = body.slice(2, -1);
      const operator: FilterOperator = not ? 'NOT IN' : 'IN';
      if (isWord(inner[0], 'SELECT')) {
        const query = source(sql, inner);
        return inSubquery(query) === query
          ? { column, operator, value: query, inSource: 'query' }
          : null;
      }
      return { column, operator, value: source(sql, inner), inSource: 'list' };
    }

    if (not) return null;

    if (isWord(body[0], 'BETWEEN')) {
      const and = body.findIndex((token) => isWord(token, 'AND'));
      const from = and > 0 ? value(body.slice(1, and)) : null;
      const to = and > 0 ? value(body.slice(and + 1)) : null;
      return from !== null && to !== null
        ? { column, operator: 'BETWEEN', value: from, valueTo: to }
        : null;
    }

    const operator = body[0]?.kind === 'symbol' ? body[0].value : '';
    if (!['=', '<>', '>', '>=', '<', '<='].includes(operator)) return null;

    const other = columnRef(body.slice(1));
    if (other && boxOf(other)?.joinId === null) {
      return {
        column,
        operator: operator as FilterOperator,
        value: null,
        compareColumn: canonical(context.columns, other.column),
      };
    }

    const text = value(body.slice(1));
    return text === null ? null : { column, operator: operator as FilterOperator, value: text };
  }

  // ── HAVING ──
  const having: HavingDraft[] = [];
  if (parts.having && parts.having.length > 0) {
    for (const { node, conjunction } of chain(parseBool(parts.having))) {
      if (node.kind !== 'leaf') throw new ReadOnly('having');
      const tokens = node.tokens;
      const close = closingParen(tokens, 1);
      const call = close > 0 ? aggregateCall(tokens.slice(0, close + 1)) : null;
      const operator = tokens[close + 1]?.value ?? '';
      const rest = tokens.slice(close + 2);
      const literal =
        rest.length === 1 && rest[0].kind === 'number'
          ? rest[0].value
          : rest.length === 2 && isSymbol(rest[0], '-') && rest[1].kind === 'number'
            ? `-${rest[1].value}`
            : null;
      const key = call ? (call.arg === '*' ? '*' : keyOf(call.arg)) : null;
      const aggregate = call
        ? aggregates.find(
            (item) =>
              item.function === call.fn &&
              item.columnKey === key &&
              item.distinct === call.distinct,
          )
        : undefined;

      if (!aggregate || !['=', '<>', '>', '>=', '<', '<='].includes(operator) || literal === null) {
        throw new ReadOnly('having');
      }

      having.push({
        id: having.length + 1,
        aggregateId: aggregate.id,
        operator: operator as FilterOperator,
        value: literal,
        conjunction: having.length === 0 ? 'AND' : conjunction,
      });
    }
  }

  // ── ORDER BY ──
  const orders: OrderDraft[] = [];
  for (const item of parts.orderBy) {
    let expr = item;
    let descending = false;
    if (isWord(expr[expr.length - 1], 'DESC', 'ASC')) {
      descending = isWord(expr[expr.length - 1], 'DESC');
      expr = expr.slice(0, -1);
    }

    let target: string | null = null;
    const ref = columnRef(expr);

    if (grouped) {
      const key = ref ? keyOf(ref) : (datePeriod(expr)?.key ?? null);
      const call = aggregateCall(expr);
      if (key && groupByKeys.includes(key)) {
        target = `group:${key}`;
      } else if (call) {
        const argKey = call.arg === '*' ? '*' : keyOf(call.arg);
        const aggregate = aggregates.find(
          (candidate) =>
            candidate.function === call.fn &&
            candidate.columnKey === argKey &&
            candidate.distinct === call.distinct,
        );
        if (aggregate) target = `aggregate:${aggregate.id}`;
      }
    } else if (ref && boxOf(ref)?.joinId === null) {
      target = `column:${canonical(context.columns, ref.column)}`;
    }

    if (target === null) throw new ReadOnly('orderBy');
    orders.push({ id: orders.length + 1, target, descending });
  }

  // ── Juntar ──
  const form: SelectForm = {
    chosen,
    filters,
    grouped,
    groupByKeys,
    groupPeriods: Object.fromEntries(groupByKeys.map((key) => [key, periods[key] ?? 'none'])),
    aggregates,
    having,
    orders: orders.length > 0 ? orders : DEFAULT_ORDERS,
    limit: parts.limitFirst ?? parts.limitLast,
    distinct: parts.distinct,
    expressions,
    conditions,
  };

  return {
    ok: true,
    form,
    joins: joins.map((join) => ({ ...join, chosen: joinChosen.get(join.id) ?? [] })),
    handPieces: expressions.length + conditions.length,
  };
}
