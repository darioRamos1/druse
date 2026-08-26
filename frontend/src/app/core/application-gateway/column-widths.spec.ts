import { fitColumnWidth, initialColumnWidths, MIN_COLUMN_WIDTH } from './column-widths';

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

describe('fitColumnWidth', () => {
  it('coge el título cuando es más largo que los valores', () => {
    const ancho = fitColumnWidth({ name: 'fecha_de_alta_efectiva', kind: 'text' }, ['1', '2']);

    // 22 caracteres de cabecera: nadie lee «fecha_de_alt…» y sabe qué columna es.
    expect(ancho).toBeGreaterThan(140);
  });

  it('coge el valor más largo cuando es él quien manda', () => {
    const corto = fitColumnWidth({ name: 'nota', kind: 'text' }, ['sí']);
    const largo = fitColumnWidth({ name: 'nota', kind: 'text' }, [
      'una nota bastante más larga que el título',
    ]);

    expect(largo).toBeGreaterThan(corto);
  });

  it('cuenta los nulos como la palabra que se pinta', () => {
    // La celda no está vacía: dice NULL, y eso ocupa.
    expect(fitColumnWidth({ name: 'a', kind: 'text' }, [null])).toBe(
      fitColumnWidth({ name: 'a', kind: 'text' }, ['NULL']),
    );
  });

  it('admite columnas más anchas que el reparto inicial', () => {
    const valor = 'x'.repeat(120);

    const inicial = initialColumnWidths([{ name: 'json', kind: 'text' }], [[valor]])[0];
    const ajustado = fitColumnWidth({ name: 'json', kind: 'text' }, [valor]);

    // El reparto inicial se corta en 320 px para no comerse la pantalla; el
    // ajuste a mano lo ha pedido alguien, así que puede pasar de ahí.
    expect(inicial).toBe(320);
    expect(ajustado).toBeGreaterThan(320);
  });

  it('no se dispara con un valor desmesurado', () => {
    const ancho = fitColumnWidth({ name: 'payload', kind: 'text' }, ['x'.repeat(10_000)]);

    expect(ancho).toBe(900);
  });

  it('nunca baja del mínimo', () => {
    expect(fitColumnWidth({ name: 'a', kind: 'text' }, ['1'])).toBe(MIN_COLUMN_WIDTH);
  });
});
