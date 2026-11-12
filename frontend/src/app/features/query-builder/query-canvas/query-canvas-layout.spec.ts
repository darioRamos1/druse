import { describe, expect, it } from 'vitest';

import { KnownColumn } from '../../../shared/models/workspace';
import {
  BASE_KEY,
  BOX_WIDTH,
  CanvasBox,
  HEAD_HEIGHT,
  MAX_ROWS,
  ROW_HEIGHT,
  SEARCH_HEIGHT,
  connectionFor,
  joinKey,
  placeBoxes,
  rowY,
  visibleRows,
  wireEnds,
} from './query-canvas-layout';

function col(name: string, isPrimaryKey = false): KnownColumn {
  return { name, dataType: 'integer', isNullable: true, isPrimaryKey };
}

function box(key: string, patch: Partial<CanvasBox> = {}): CanvasBox {
  return {
    key,
    alias: '',
    label: key,
    name: key,
    columns: [col('id', true), col('nombre')],
    chosen: [],
    joinId: key === BASE_KEY ? null : Number(key.split(':')[1]),
    type: key === BASE_KEY ? null : 'INNER',
    leftKey: key === BASE_KEY ? null : BASE_KEY,
    loading: false,
    ...patch,
  };
}

const ancha = Array.from({ length: 30 }, (_, index) => col(`c${index}`));

describe('query-canvas-layout', () => {
  describe('columnas visibles', () => {
    it('con pocas columnas se ven todas', () => {
      expect(visibleRows(box(BASE_KEY), new Set())).toEqual({
        rows: box(BASE_KEY).columns,
        hidden: 0,
      });
    });

    it('con muchas, primero las marcadas, las de un cruce y la clave, en el orden de la tabla', () => {
      const columns = [...ancha, col('clave', true)];
      const { rows, hidden } = visibleRows(
        box(BASE_KEY, { columns, chosen: ['c29'] }),
        new Set(['c20']),
      );
      const names = rows.map((row) => row.name);

      expect(rows).toHaveLength(MAX_ROWS);
      expect(hidden).toBe(columns.length - MAX_ROWS);
      expect(names).toEqual(expect.arrayContaining(['c29', 'c20', 'clave']));
      expect(names.indexOf('c20')).toBeLessThan(names.indexOf('c29'));
    });

    it('buscando, solo las que coinciden', () => {
      const { rows, hidden } = visibleRows(box(BASE_KEY, { columns: ancha }), new Set(), 'C1');

      expect(rows.map((row) => row.name)).toEqual([
        'c1',
        ...Array.from({ length: 10 }, (_, index) => `c1${index}`),
      ]);
      expect(hidden).toBe(30 - 11);
    });
  });

  describe('colocación', () => {
    it('cada cruce va a la derecha de la caja de la que parte, y debajo de su nivel', () => {
      const positions = placeBoxes([
        { key: BASE_KEY, leftKey: null, height: 100 },
        { key: 'join:1', leftKey: BASE_KEY, height: 80 },
        { key: 'join:2', leftKey: BASE_KEY, height: 80 },
        { key: 'join:3', leftKey: 'join:1', height: 80 },
      ]);
      const base = positions.get(BASE_KEY)!;
      const first = positions.get('join:1')!;
      const second = positions.get('join:2')!;
      const third = positions.get('join:3')!;

      expect(first.x).toBeGreaterThan(base.x + BOX_WIDTH);
      expect(second.x).toBe(first.x);
      expect(second.y).toBeGreaterThan(first.y + 80);
      expect(third.x).toBeGreaterThan(first.x + BOX_WIDTH);
    });

    it('una caja movida se queda donde se dejó', () => {
      const positions = placeBoxes([{ key: BASE_KEY, leftKey: null, height: 100 }], {
        [BASE_KEY]: { x: 300, y: 12 },
      });

      expect(positions.get(BASE_KEY)).toEqual({ x: 300, y: 12 });
    });
  });

  describe('líneas', () => {
    it('engancha en la fila de la columna, contando el buscador de las cajas anchas', () => {
      const estrecha = { ...box(BASE_KEY), y: 100 };
      const conBuscador = { ...box(BASE_KEY, { columns: ancha }), y: 100 };

      expect(rowY(estrecha, estrecha.columns, 'nombre')).toBe(
        100 + HEAD_HEIGHT + ROW_HEIGHT + ROW_HEIGHT / 2,
      );
      expect(rowY(conBuscador, ancha, 'c0')).toBe(
        100 + HEAD_HEIGHT + SEARCH_HEIGHT + ROW_HEIGHT / 2,
      );
      // Una columna que no se ve se engancha a la cabecera.
      expect(rowY(estrecha, estrecha.columns, 'oculta')).toBe(100 + HEAD_HEIGHT / 2);
    });

    it('sale por el lado que mira a la otra caja', () => {
      const izquierda = { x: 0, y: 0 };
      const derecha = { x: BOX_WIDTH + 100, y: 0 };

      expect(wireEnds(izquierda, 10, derecha, 20).start.x).toBe(BOX_WIDTH);
      expect(wireEnds(derecha, 10, izquierda, 20).start.x).toBe(derecha.x);
      expect(wireEnds(izquierda, 10, { x: 30, y: 200 }, 20).bend).toBe(0);
    });
  });

  describe('conexiones', () => {
    const cajas = [box(BASE_KEY), box(joinKey(1)), box(joinKey(2))];

    it('cambia el cruce de la caja que va después, se arrastre en el sentido que sea', () => {
      const esperado = { joinId: 2, leftJoinId: 1, leftColumn: 'id', rightColumn: 'nombre' };

      expect(
        connectionFor(cajas, { key: 'join:1', column: 'id' }, { key: 'join:2', column: 'nombre' }),
      ).toEqual(esperado);
      expect(
        connectionFor(cajas, { key: 'join:2', column: 'nombre' }, { key: 'join:1', column: 'id' }),
      ).toEqual(esperado);
    });

    it('desde la principal, el cruce parte de ella', () => {
      expect(
        connectionFor(cajas, { key: 'join:1', column: 'id' }, { key: BASE_KEY, column: 'nombre' }),
      ).toEqual({ joinId: 1, leftJoinId: null, leftColumn: 'nombre', rightColumn: 'id' });
    });

    it('una caja consigo misma no se cruza', () => {
      expect(
        connectionFor(cajas, { key: 'join:1', column: 'id' }, { key: 'join:1', column: 'nombre' }),
      ).toBeNull();
    });
  });
});
