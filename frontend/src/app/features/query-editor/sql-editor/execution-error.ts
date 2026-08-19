import { QueryError } from '../../../shared/models/workspace';

/**
 * Dónde falló, dentro del SQL que se envió.
 *
 * La columna es opcional a propósito: no todos los motores la saben. PostgreSQL
 * da la posición exacta del carácter, y con ella se puede subrayar la palabra
 * culpable; SQL Server y MySQL solo dan la línea, y ahí subrayarla entera es lo
 * honesto —fingir una columna sería señalar un sitio inventado—.
 */
export interface ExecutionErrorPlace {
  /** Línea dentro del SQL enviado, base 1. */
  readonly line: number;

  /** Columna dentro de esa línea, base 1, o nulo si el motor solo dio la línea. */
  readonly column: number | null;
}

/**
 * Traduce la ubicación que reporta el motor a un sitio dentro del SQL enviado.
 *
 * La posición se recorre por puntos de código y no por unidades UTF-16
 * (`[...sql]` y no `sql.slice`): un emoji en un comentario desplazaría todo lo
 * de después medio carácter, y el error acabaría señalando la línea de al lado.
 */
export function executionErrorPlace(error: QueryError, sql: string): ExecutionErrorPlace | null {
  if (error.position !== undefined && error.position !== null && error.position > 0) {
    const anterior = [...sql].slice(0, error.position - 1);
    const saltos = anterior.filter((character) => character === '\n').length;
    const ultimoSalto = anterior.lastIndexOf('\n');

    return {
      line: saltos + 1,
      // Lo que va desde el último salto hasta la posición, más uno porque las
      // columnas se cuentan desde 1.
      column: anterior.length - ultimoSalto,
    };
  }

  return error.line !== undefined && error.line !== null && error.line > 0
    ? { line: error.line, column: null }
    : null;
}
