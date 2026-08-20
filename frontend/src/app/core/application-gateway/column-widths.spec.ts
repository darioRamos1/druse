import { initialColumnWidths } from './column-widths';

describe('ancho inicial de las columnas', () => {
  /**
   * El caso que motivó el cambio: `id` y `descripcion` salían con 110 y 220 px
   * porque lo decía el tipo, mirara lo que mirara.
   */
  it('da menos a los enteros que a los textos largos', () => {
    const [id, descripcion] = initialColumnWidths(
      [
        { name: 'id', kind: 'number' },
        { name: 'descripcion', kind: 'text' },
      ],
      [
        ['1', 'Tornillo hexagonal de acero inoxidable M8 x 40'],
        ['2', 'Arandela plana galvanizada'],
      ],
    );

    expect(id).toBeLessThan(descripcion);
  });

  it('nunca baja del mínimo ni sube del tope', () => {
    const [corta, larga] = initialColumnWidths(
      [
        { name: 'n', kind: 'number' },
        { name: 'texto', kind: 'text' },
      ],
      [['7', 'x'.repeat(400)]],
    );

    expect(corta).toBe(84);
    expect(larga).toBe(320);
  });

  /** El título tiene que caber aunque los valores sean de una letra. */
  it('cuenta el nombre de la columna, no solo los valores', () => {
    const [ancho] = initialColumnWidths(
      [{ name: 'importe_total_facturado_sin_impuestos', kind: 'number' }],
      [['9'], ['8']],
    );

    expect(ancho).toBeGreaterThan(200);
  });

  /**
   * Un `SELECT` sin filas sigue pintando su cabecera, y ahí lo único que se sabe
   * de la columna es el tipo.
   */
  it('sin filas que mirar, reparte por tipo', () => {
    const [numero, marca] = initialColumnWidths(
      [
        { name: 'cantidad', kind: 'number' },
        { name: 'creado', kind: 'timestamp' },
      ],
      [],
    );

    expect(numero).toBe(110);
    expect(marca).toBe(200);
  });

  /** Un nulo se pinta como «NULL», así que ocupa cuatro caracteres. */
  it('no encoge la columna por las filas nulas', () => {
    const [conNulos] = initialColumnWidths([{ name: 'a', kind: 'text' }], [[null], [null]]);

    expect(conNulos).toBe(84);
  });

  /**
   * Pasada la primera pantalla, una fila más solo puede ensanchar hasta el tope:
   * mirar las 500 no cambiaría lo que se ve y sí lo que cuesta.
   */
  it('solo mira las primeras filas', () => {
    const filas = Array.from({ length: 200 }, (_, index) =>
      index === 199 ? ['x'.repeat(60)] : ['corto'],
    );

    const [ancho] = initialColumnWidths([{ name: 'a', kind: 'text' }], filas);

    expect(ancho).toBe(84);
  });
});
