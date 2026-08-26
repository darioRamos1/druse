import { ResultColumn } from '../../../shared/models/workspace';

/**
 * En qué forma se lleva al portapapeles lo que hay seleccionado.
 *
 * Los tres salen del mismo sitio —una selección de la cuadrícula— y van a
 * destinos distintos: una hoja de cálculo, el `WHERE` de otra consulta, o un
 * hueco dentro de algo que el usuario ya está escribiendo.
 */
export type CopyFormat = 'excel' | 'where-in' | 'list';

/** Lo seleccionado, ya recortado a un rectángulo por quien lo seleccionó. */
export interface CopySelection {
  readonly columns: readonly ResultColumn[];

  /** Una entrada por fila; dentro, un valor por cada columna de `columns`. */
  readonly rows: readonly (readonly (string | null)[])[];
}

/** Nombre legible de cada formato, para los menús. */
export const COPY_FORMAT_LABELS: Readonly<Record<CopyFormat, string>> = {
  excel: 'Excel',
  'where-in': 'Condición IN',
  list: 'Lista de valores',
};

export function formatSelection(selection: CopySelection, format: CopyFormat): string {
  switch (format) {
    case 'excel':
      return toSpreadsheet(selection);

    case 'where-in':
      return toWhereIn(selection);

    case 'list':
      return toList(selection);
  }
}

/**
 * Tabuladores y un salto por fila, con los nombres de las columnas arriba.
 *
 * Es lo que una hoja de cálculo entiende al pegar: cada valor en su celda. Los
 * NULL van vacíos porque una celda vacía **es** lo que representan; escribir la
 * palabra dejaría un texto donde debería haber un hueco, y estropearía las
 * fórmulas de la columna.
 */
function toSpreadsheet(selection: CopySelection): string {
  const headers = selection.columns.map((column) => escapeCell(column.name));
  const rows = selection.rows.map((row) => row.map((value) => escapeCell(value ?? '')));

  return [headers, ...rows].map((row) => row.join('\t')).join('\n');
}

/**
 * Una condición lista para pegar detrás de un `WHERE`.
 *
 * Los valores repetidos se quitan: en un `IN` no aportan nada y solo alargan una
 * línea que hay que leer. Los NULL no pueden ir dentro —`IN (NULL)` nunca es
 * cierto, ni siquiera para las filas que son nulas—, así que cuando los hay se
 * añaden aparte con `IS NULL` y se envuelve todo entre paréntesis. Sin eso, la
 * condición copiada perdería filas en silencio, que es la peor forma de fallar.
 *
 * Con varias columnas sale una condición por columna unidas por `AND`, cada una
 * en su línea.
 */
function toWhereIn(selection: CopySelection): string {
  const conditions = selection.columns.map((column, index) => {
    const values = selection.rows.map((row) => row[index] ?? null);
    const present = unique(values.filter((value): value is string => value !== null));
    const hasNull = values.some((value) => value === null);
    const name = identifier(column.name);

    if (present.length === 0) {
      return `${name} IS NULL`;
    }

    const list = present.map((value) => literal(value, column)).join(', ');
    const condition = `${name} IN (${list})`;

    return hasNull ? `(${condition} OR ${name} IS NULL)` : condition;
  });

  return conditions.join('\n  AND ');
}

/**
 * Los valores sueltos, separados por comas.
 *
 * Aquí **no** se quitan los repetidos ni se toca el orden: esto es para pegar
 * dentro de algo que el usuario ya tiene escrito, y lo que espera encontrar es
 * lo que seleccionó, tal cual y en el mismo orden. Los NULL se escriben como
 * `NULL`, que es como se escriben en SQL.
 */
function toList(selection: CopySelection): string {
  return selection.rows
    .flatMap((row) =>
      row.map((value, index) => {
        const column = selection.columns[index];

        return value === null ? 'NULL' : literal(value, column);
      }),
    )
    .join(', ');
}

/**
 * Escribe un valor como literal de SQL.
 *
 * El tipo manda sobre el contenido, y esa es toda la diferencia con el criterio
 * de `sql-writer`, que no tiene tipos a mano: un código postal `01234` guardado
 * como texto **tiene** que salir entrecomillado, porque sin comillas el motor lo
 * compararía como el número 1234 y no encontraría nada.
 */
function literal(value: string, column: ResultColumn | undefined): string {
  const trimmed = value.trim();
  const numeric =
    column?.kind === 'number' && trimmed.length > 0 && Number.isFinite(Number(trimmed));

  return numeric ? trimmed : `'${value.replace(/'/g, "''")}'`;
}

/**
 * El nombre de la columna tal como se puede pegar en una consulta.
 *
 * Un nombre normal va tal cual, que es lo que el usuario espera leer. Solo se
 * entrecomilla lo que no sobreviviría suelto —espacios, acentos, una palabra
 * reservada— y con comillas dobles, que es lo estándar: aquí no se sabe contra
 * qué motor se va a pegar, y elegir las de un motor concreto sería acertar en
 * uno y romper en los otros tres.
 */
function identifier(name: string): string {
  const limpio = name.trim();

  // Una columna puede no tener nombre: SQL Server devuelve así las que no llevan
  // alias. Un identificador vacío produciría SQL que no se puede ejecutar y que
  // encima parece correcto de un vistazo, así que se deja dicho en un comentario
  // —como hace el escritor de consultas con lo que falta— para que quien lo pegue
  // lo vea y ponga el nombre que quiera.
  if (limpio.length === 0) {
    return '/* columna sin nombre */';
  }

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(limpio) ? limpio : `"${limpio.replace(/"/g, '""')}"`;
}

/**
 * Deja un valor listo para una celda de hoja de cálculo.
 *
 * Un tabulador o un salto de línea dentro del texto partirían la fila en celdas
 * que no existen; entre comillas dobles, la hoja los lee como parte del valor.
 */
function escapeCell(value: string): string {
  if (!/["\t\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
