import { AiRowCell, AiRowsAttachment, AiSource } from '../../shared/models/ai';
import { ResultSet } from '../../shared/models/workspace';

export const AI_ROW_LIMIT = 50;
export const AI_COLUMN_LIMIT = 32;
export const AI_CELL_BYTES = 1024;
export type AiColumnMode = 'exclude' | 'include' | 'mask';
export interface AiRowsSelection {
  readonly indices: readonly number[];
  readonly modes: readonly AiColumnMode[];
  readonly accepted: boolean;
  readonly page: number;
}

/** Solo vive en el selector local; nunca se añade directamente a una petición. */
export interface AiRowsRequest {
  readonly source: AiSource;
  readonly executionId: string;
  readonly occurredAtUtc: string;
  readonly resultSetIndex: number;
  readonly resultSet: ResultSet;
}

export function rowCell(value: string | null, binary: boolean, masked: boolean): AiRowCell {
  // No recorrer ni decodificar un binario, ni siquiera para averiguar su tamaño.
  if (masked) return { kind: 'masked' };
  if (binary) return { kind: 'binary' };
  if (value == null) return { kind: 'null' };
  let bytes = 0;
  let prefix = '';
  // Contar sin reservar otra copia UTF-8 de un texto potencialmente grande.
  for (const char of value) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes <= AI_CELL_BYTES) prefix += char;
  }
  return bytes <= AI_CELL_BYTES
    ? { kind: 'text', value }
    : { kind: 'truncated', value: prefix, originalBytes: bytes };
}

export function selectRows(
  request: AiRowsRequest,
  indices: readonly number[],
  modes: readonly AiColumnMode[],
  truncationAccepted: boolean,
): AiRowsAttachment | null {
  const selected = request.resultSet.columns
    .map((column, ordinal) => ({ ...column, ordinal, mode: modes[ordinal] ?? 'exclude' }))
    .filter((column) => column.mode !== 'exclude');
  const unique = [...new Set(indices)].sort((a, b) => a - b);
  if (
    !unique.length ||
    unique.length > AI_ROW_LIMIT ||
    !selected.length ||
    selected.length > AI_COLUMN_LIMIT ||
    unique.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= request.resultSet.rows.length,
    )
  )
    return null;
  return {
    executionId: request.executionId,
    occurredAtUtc: request.occurredAtUtc,
    resultSetIndex: request.resultSetIndex,
    availableRows: request.resultSet.rows.length,
    resultTruncated: request.resultSet.truncated,
    truncationAccepted,
    columns: selected.map((column) => ({
      ordinal: column.ordinal,
      name: column.name,
      dataType: column.dataType,
    })),
    rows: unique.map((index) => ({
      index,
      cells: selected.map((column) =>
        rowCell(
          column.mode === 'mask' || column.kind === 'binary'
            ? null
            : (request.resultSet.rows[index].values[column.ordinal] ?? null),
          column.kind === 'binary',
          column.mode === 'mask',
        ),
      ),
    })),
  };
}
