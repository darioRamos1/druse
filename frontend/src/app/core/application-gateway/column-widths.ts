import { ColumnType, ResultColumn } from '../../shared/models/workspace';

/**
 * Ancho inicial de las columnas de la cuadrícula.
 *
 * Antes se repartía solo por tipo, y eso dejaba una columna de enteros tan ancha
 * como una de texto: 110 px para `id` y 220 para `descripcion`, cupiera lo que
 * cupiera. Aquí se mira **una muestra de los valores que van a pintarse**, que
 * es lo único que sabe cuánto ocupa de verdad cada columna.
 *
 * Medir el texto renderizado exigiría pintarlo primero —y la cuadrícula elige el
 * ancho antes de existir—, así que se cuenta en caracteres y se multiplica por
 * el avance del glifo. Con JetBrains Mono en las celdas ese avance es exacto; el
 * nombre de la cabecera va en Inter y ahí es una estimación, que se compensa
 * pidiendo algo de aire de más.
 */

/** Avance del glifo en las celdas: JetBrains Mono a 12 px, 0.6 em. */
const CELL_CHAR = 7.2;

/** Avance medio en la cabecera: Inter semibold a 11.5 px. */
const HEAD_CHAR = 6.6;

/** Relleno lateral, borde y separación de la celda. */
const CHROME = 26;

/**
 * Filas que se miran.
 *
 * Con el tope de 500 filas del ejecutor se podrían mirar todas, pero no hace
 * falta: lo que decide el ancho es lo que se ve sin desplazarse, y pasada la
 * primera pantalla una fila más solo puede ensanchar hasta el tope.
 */
const SAMPLE = 60;

/**
 * Nadie quiere una columna de una letra: por debajo de esto no cabe el título.
 *
 * Lo exporta para la cuadrícula, que es donde se arrastra el borde: el suelo del
 * ajuste a mano tiene que ser el mismo que el del reparto inicial, o arrastrar
 * dejaría columnas que el cálculo automático nunca habría producido.
 */
export const MIN_COLUMN_WIDTH = 84;

/**
 * Tope del reparto inicial.
 *
 * Un texto largo puede llevarse la pantalla entera y esconder las columnas de
 * después. Se corta con puntos suspensivos y se ensancha a mano si hace falta.
 */
const MAX_WIDTH = 320;

/**
 * Tope del ajuste a mano, mucho más alto.
 *
 * Cuando alguien pide expresamente ver una columna entera, esconder las de al
 * lado es justo lo que quiere; el tope solo está para que una fila con un JSON
 * de diez mil caracteres no produzca una columna imposible de manejar.
 */
const MAX_FIT_WIDTH = 900;

/**
 * Anchos de reserva por tipo, para cuando no hay ni una fila que mirar.
 *
 * Un `SELECT` que no devuelve filas sigue pintando su cabecera, y ahí lo único
 * que se sabe de la columna es su tipo.
 */
const WIDTH_BY_KIND: Readonly<Record<ColumnType, number>> = {
  number: 110,
  boolean: 110,
  timestamp: 200,
  uuid: 290,
  binary: 200,
  text: 220,
};

/** Lo que la cuadrícula escribe cuando el valor es nulo. */
const NULL_TEXT = 'NULL';

/**
 * Reparte el ancho inicial de cada columna mirando la muestra.
 *
 * Devuelve un ancho por columna, en el mismo orden. Quien llame decide qué hacer
 * con la última —la cuadrícula la estira para absorber el sobrante—.
 */
export function initialColumnWidths(
  columns: readonly Pick<ResultColumn, 'name' | 'kind'>[],
  rows: readonly (readonly (string | null)[])[],
): number[] {
  const sample = rows.slice(0, SAMPLE);

  return columns.map((column, index) =>
    columnWidth(
      column,
      sample.map((row) => row[index] ?? null),
      MAX_WIDTH,
    ),
  );
}

/**
 * Lo que necesita una columna para enseñar su título y sus valores.
 *
 * Es lo que hay detrás del doble clic sobre el borde de la cabecera. Recibe los
 * valores ya recortados a lo que se está mirando —quien llama decide si es la
 * muestra del arranque o las filas pintadas— y admite un ancho mayor que el del
 * reparto inicial: aquí el ancho lo ha pedido alguien, no lo ha repartido nadie.
 */
export function fitColumnWidth(
  column: Pick<ResultColumn, 'name' | 'kind'>,
  values: readonly (string | null)[],
): number {
  return columnWidth(column, values, MAX_FIT_WIDTH);
}

function columnWidth(
  column: Pick<ResultColumn, 'name' | 'kind'>,
  values: readonly (string | null)[],
  max: number,
): number {
  const header = column.name.length * HEAD_CHAR + CHROME;

  if (values.length === 0) {
    return clamp(Math.max(header, WIDTH_BY_KIND[column.kind]), max);
  }

  const longest = values.reduce<number>(
    (largest, value) => Math.max(largest, (value ?? NULL_TEXT).length),
    0,
  );

  return clamp(Math.max(header, longest * CELL_CHAR + CHROME), max);
}

function clamp(width: number, max: number): number {
  return Math.round(Math.min(Math.max(width, MIN_COLUMN_WIDTH), max));
}
