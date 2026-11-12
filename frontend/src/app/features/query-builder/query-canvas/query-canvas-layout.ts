import { KnownColumn } from '../../../shared/models/workspace';
import { JoinType } from '../../query-editor/sql-language/sql-writer';
import { CanvasLayout } from '../query-model';

/**
 * Geometría del lienzo del compositor, sin Angular.
 *
 * No reutiliza la colocación del diagrama a propósito: allí cada caja es una
 * tabla, y aquí una misma tabla puede salir dos veces con alias distintos. Las
 * cajas se colocan por niveles: la principal a la izquierda y cada cruce a la
 * derecha de la caja de la que parte.
 */

export const BASE_KEY = 'base';
export const BOX_WIDTH = 236;
export const HEAD_HEIGHT = 36;
export const ROW_HEIGHT = 26;
/** Cuántas columnas enseña una caja sin buscar. Más, y el lienzo deja de verse entero. */
export const MAX_ROWS = 12;
/** Fila del pie que avisa de las columnas ocultas. */
export const MORE_HEIGHT = 26;
const GAP_X = 104;
const GAP_Y = 32;
const PAD = 24;

export function joinKey(id: number): string {
  return `join:${id}`;
}

/** Una caja del lienzo: la tabla principal o un cruce. */
export interface CanvasBox {
  readonly key: string;
  /** `t0`, `t1`…, o vacío sin cruces: entonces el SQL no usa alias. */
  readonly alias: string;
  /** Nombre completo, con esquema: para lectores de pantalla y el título. */
  readonly label: string;
  /** Lo que cabe en la cabecera: la tabla sin esquema. */
  readonly name: string;
  readonly columns: readonly KnownColumn[];
  readonly chosen: readonly string[];
  /** `null` en la tabla principal. */
  readonly joinId: number | null;
  /** Tipo de cruce; un CROSS no tiene línea, así que no se puede sacar de ella. */
  readonly type: JoinType | null;
  /** De qué caja parte el cruce; `null` en la principal. */
  readonly leftKey: string | null;
  readonly loading: boolean;
}

/** La línea de un cruce, de la columna de la caja de origen a la del cruce. */
export interface CanvasLink {
  readonly joinId: number;
  readonly key: string;
  readonly leftKey: string;
  readonly leftColumn: string;
  readonly rightColumn: string;
  readonly type: string;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Las columnas que se ven en una caja.
 *
 * Con pocas, todas. Con muchas, primero las que importan —marcadas, usadas en
 * un cruce, clave primaria— y luego las primeras hasta llenar; el resto se
 * alcanza buscando. Así una tabla de cien columnas no ocupa el lienzo entero.
 */
export function visibleRows(
  box: CanvasBox,
  linked: ReadonlySet<string>,
  search = '',
): { readonly rows: readonly KnownColumn[]; readonly hidden: number } {
  const term = search.trim().toLocaleLowerCase();

  if (term) {
    const rows = box.columns.filter((column) => column.name.toLocaleLowerCase().includes(term));
    return { rows, hidden: box.columns.length - rows.length };
  }

  if (box.columns.length <= MAX_ROWS) {
    return { rows: box.columns, hidden: 0 };
  }

  const important = (column: KnownColumn) =>
    box.chosen.includes(column.name) || linked.has(column.name) || column.isPrimaryKey;
  const picked = new Set(box.columns.filter(important).map((column) => column.name));

  for (const column of box.columns) {
    if (picked.size >= MAX_ROWS) {
      break;
    }
    picked.add(column.name);
  }

  // Se conserva el orden de la tabla: buscar una columna no debería obligar a
  // aprender otro.
  const rows = box.columns.filter((column) => picked.has(column.name));
  return { rows, hidden: box.columns.length - rows.length };
}

/** Una caja con más columnas de las que caben lleva un buscador bajo la cabecera. */
export const SEARCH_HEIGHT = 34;

export function searchable(box: CanvasBox): boolean {
  return box.columns.length > MAX_ROWS;
}

/** Dónde empiezan las filas, contando desde arriba de la caja. */
export function rowsOffset(box: CanvasBox): number {
  return HEAD_HEIGHT + (searchable(box) ? SEARCH_HEIGHT : 0);
}

export function boxHeight(box: CanvasBox, rows: number, hidden: number): number {
  return rowsOffset(box) + Math.max(rows, 1) * ROW_HEIGHT + (hidden > 0 ? MORE_HEIGHT : 0) + 6;
}

/**
 * Dónde va cada caja.
 *
 * Las que ya se movieron se quedan donde se dejaron. Las demás van a la
 * columna de su nivel —cuántos cruces hay hasta la principal— y debajo de la
 * última caja de ese nivel.
 */
export function placeBoxes(
  boxes: readonly {
    readonly key: string;
    readonly leftKey: string | null;
    readonly height: number;
  }[],
  saved: CanvasLayout = {},
): ReadonlyMap<string, Point> {
  const depth = new Map<string, number>();
  const bottom = new Map<number, number>();
  const placed = new Map<string, Point>();

  for (const box of boxes) {
    const level = box.leftKey === null ? 0 : (depth.get(box.leftKey) ?? 0) + 1;
    depth.set(box.key, level);

    const fixed = saved[box.key];
    if (fixed) {
      placed.set(box.key, { x: fixed.x, y: fixed.y });
      continue;
    }

    const y = bottom.get(level) ?? PAD;
    placed.set(box.key, { x: PAD + level * (BOX_WIDTH + GAP_X), y });
    bottom.set(level, y + box.height + GAP_Y);
  }

  return placed;
}

/** Tamaño de la superficie: lo que ocupan las cajas y un margen para soltar más. */
export function surfaceSize(
  positions: ReadonlyMap<string, Point>,
  heights: ReadonlyMap<string, number>,
): { readonly width: number; readonly height: number } {
  let width = 0;
  let height = 0;

  for (const [key, point] of positions) {
    width = Math.max(width, point.x + BOX_WIDTH);
    height = Math.max(height, point.y + (heights.get(key) ?? 0));
  }

  return { width: width + PAD * 4, height: height + PAD * 2 };
}

/** Altura del punto de enganche de una columna; si su fila no se ve, la cabecera. */
export function rowY(
  box: CanvasBox & { readonly y: number },
  rows: readonly KnownColumn[],
  column: string,
): number {
  const index = rows.findIndex((row) => row.name === column);
  return index < 0
    ? box.y + HEAD_HEIGHT / 2
    : box.y + rowsOffset(box) + index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/**
 * Por qué lados sale y entra una línea.
 *
 * Normalmente del lado derecho del origen al izquierdo del destino. Si quien
 * movió las cajas las ha cruzado, se invierte; y si se solapan en horizontal,
 * las dos salen por la derecha y la curva rodea.
 */
export function wireEnds(
  from: Point,
  fromY: number,
  to: Point,
  toY: number,
): { readonly start: Point; readonly end: Point; readonly bend: number } {
  if (from.x + BOX_WIDTH <= to.x) {
    return { start: { x: from.x + BOX_WIDTH, y: fromY }, end: { x: to.x, y: toY }, bend: 1 };
  }

  if (to.x + BOX_WIDTH <= from.x) {
    return { start: { x: from.x, y: fromY }, end: { x: to.x + BOX_WIDTH, y: toY }, bend: -1 };
  }

  return {
    start: { x: from.x + BOX_WIDTH, y: fromY },
    end: { x: to.x + BOX_WIDTH, y: toY },
    bend: 0,
  };
}

export function wirePath(start: Point, end: Point, bend: number): string {
  if (bend === 0) {
    const out = Math.max(start.x, end.x) + 48;
    return `M ${start.x} ${start.y} C ${out} ${start.y}, ${out} ${end.y}, ${end.x} ${end.y}`;
  }

  const pull = Math.max(40, Math.abs(end.x - start.x) / 2) * bend;
  return `M ${start.x} ${start.y} C ${start.x + pull} ${start.y}, ${end.x - pull} ${end.y}, ${end.x} ${end.y}`;
}

/** Un extremo de una conexión: una columna de una caja. */
export interface ColumnEnd {
  readonly key: string;
  readonly column: string;
}

/** Lo que cambia en un cruce al unir dos columnas. */
export interface Connection {
  readonly joinId: number;
  /** `null` cuando el cruce parte de la tabla principal. */
  readonly leftJoinId: number | null;
  readonly leftColumn: string;
  readonly rightColumn: string;
}

/**
 * Qué cruce se reescribe al unir dos columnas.
 *
 * Un cruce solo puede partir de la principal o de un cruce anterior, porque así
 * se escribe el SQL. Por eso da igual en qué sentido se arrastre: el cruce que
 * cambia es el de la caja que va después, y parte de la otra.
 */
export function connectionFor(
  boxes: readonly CanvasBox[],
  a: ColumnEnd,
  b: ColumnEnd,
): Connection | null {
  const ia = boxes.findIndex((box) => box.key === a.key);
  const ib = boxes.findIndex((box) => box.key === b.key);

  if (ia < 0 || ib < 0 || ia === ib) {
    return null;
  }

  const [left, right] = ia < ib ? [a, b] : [b, a];
  const rightBox = boxes[Math.max(ia, ib)];
  const leftBox = boxes[Math.min(ia, ib)];

  if (rightBox.joinId === null) {
    return null;
  }

  return {
    joinId: rightBox.joinId,
    leftJoinId: leftBox.joinId,
    leftColumn: left.column,
    rightColumn: right.column,
  };
}
