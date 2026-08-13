import { QueryError } from '../../../shared/models/workspace';

/** Traduce la ubicación normalizada del motor a una línea dentro del SQL enviado. */
export function executionErrorLine(error: QueryError, sql: string): number | null {
  if (error.position !== undefined && error.position !== null && error.position > 0) {
    return [...sql]
      .slice(0, error.position - 1)
      .join('')
      .split('\n').length;
  }

  return error.line !== undefined && error.line !== null && error.line > 0 ? error.line : null;
}
