import { SavedCompositionRecord } from '../../core/application-gateway/application-gateway';
import { normalizeSql } from '../../core/workspace/composed-queries';
import {
  ReportColumn,
  ReportDataset,
  ReportDatasetPreview,
  ReportJoinKey,
  ReportSource,
} from '../../shared/models/reports';

/**
 * Lo que una fuente visual copia de la composición elegida.
 *
 * Es una copia y no una referencia: si alguien cambia la composición en el
 * compositor, el reporte sigue leyendo lo mismo hasta que se vuelva a elegir.
 */
export interface VisualSourceModel {
  readonly compositionId: string;
  readonly name: string;
  readonly table: string;
  readonly sql: string;
  readonly state: unknown;
}

export const MAX_SOURCES = 2;

export function newDataset(id: string, name: string): ReportDataset {
  return { id, name, version: 0, sources: [], join: null };
}

export function newSource(alias: string, connectionId: string, database: string): ReportSource {
  return { alias, connectionId, database, mode: 'Sql', sql: '', visualModel: null, expectedColumns: [] };
}

/** El alias libre siguiente: `Fuente 1`, `Fuente 2`… sin repetir uno que ya esté. */
export function nextAlias(sources: readonly ReportSource[], base: string): string {
  const used = new Set(sources.map((source) => source.alias.trim().toLowerCase()));

  for (let n = sources.length + 1; ; n++) {
    const alias = `${base} ${n}`;

    if (!used.has(alias.toLowerCase())) {
      return alias;
    }
  }
}

export function readVisualModel(source: ReportSource): VisualSourceModel | null {
  if (!source.visualModel) {
    return null;
  }

  try {
    const model = JSON.parse(source.visualModel) as Partial<VisualSourceModel>;

    return typeof model.sql === 'string' && typeof model.compositionId === 'string'
      ? (model as VisualSourceModel)
      : null;
  } catch {
    return null;
  }
}

/** Copia una composición guardada en la fuente, con el SQL que generó el compositor. */
export function applyComposition(source: ReportSource, record: SavedCompositionRecord): ReportSource {
  let parsed: { sql?: unknown; state?: unknown } = {};

  try {
    parsed = JSON.parse(record.model) as { sql?: unknown; state?: unknown };
  } catch {
    // Un modelo ilegible deja la fuente sin SQL y la validación lo dirá.
  }

  const sql = typeof parsed.sql === 'string' ? parsed.sql : '';
  const model: VisualSourceModel = {
    compositionId: record.id,
    name: record.name,
    table: record.schema ? `${record.schema}.${record.table}` : record.table,
    sql,
    state: parsed.state ?? null,
  };

  return { ...source, mode: 'Visual', sql, visualModel: JSON.stringify(model) };
}

/** De visual a SQL: el SQL generado pasa a ser editable y el estado visual se conserva. */
export function toSqlMode(source: ReportSource): ReportSource {
  return { ...source, mode: 'Sql' };
}

/** Si volver al modo visual descartaría SQL escrito a mano. */
export function visualWouldDiscardSql(source: ReportSource): boolean {
  const model = readVisualModel(source);

  return (
    model !== null &&
    normalizeSql(source.sql).length > 0 &&
    normalizeSql(source.sql) !== normalizeSql(model.sql)
  );
}

/** De SQL a visual: vuelve al SQL de la composición copiada, si la hay. */
export function toVisualMode(source: ReportSource): ReportSource {
  const model = readVisualModel(source);

  return { ...source, mode: 'Visual', sql: model?.sql ?? source.sql };
}

/** Problemas que impiden guardar o previsualizar, como claves de idioma. */
export function draftProblems(dataset: ReportDataset): readonly string[] {
  const problems: string[] = [];

  if (dataset.sources.length === 0) {
    problems.push('reports.problem.noSources');
  }

  for (const source of dataset.sources) {
    if (!source.connectionId || !source.database.trim()) {
      problems.push('reports.problem.connection');
    } else if (source.mode === 'Visual' && readVisualModel(source) === null) {
      problems.push('reports.problem.composition');
    } else if (!source.sql.trim()) {
      problems.push('reports.problem.sql');
    }
  }

  const aliases = dataset.sources.map((source) => source.alias.trim().toLowerCase());

  if (aliases.some((alias) => alias.length === 0)) {
    problems.push('reports.problem.alias');
  } else if (new Set(aliases).size !== aliases.length) {
    problems.push('reports.problem.aliasRepeated');
  }

  if (
    dataset.sources.length === 2 &&
    (!dataset.join ||
      dataset.join.keys.length === 0 ||
      dataset.join.keys.some((key) => !key.left.trim() || !key.right.trim()))
  ) {
    problems.push('reports.problem.joinKeys');
  }

  return [...new Set(problems)];
}

/**
 * Pares de columnas que se llaman igual y tienen el mismo tipo a los dos lados.
 *
 * Es solo una propuesta para no empezar en blanco: el caso típico —mes y
 * municipio a cada lado— sale solo, y quien tenga nombres distintos los elige.
 */
export function suggestKeys(
  left: readonly ReportColumn[],
  right: readonly ReportColumn[],
): readonly ReportJoinKey[] {
  const byName = new Map(right.map((column) => [column.name.toLowerCase(), column]));

  return left.flatMap((column) => {
    const match = byName.get(column.name.toLowerCase());

    return match && match.clrType === column.clrType ? [{ left: column.name, right: match.name }] : [];
  });
}

/**
 * Las columnas esperadas de cada fuente, tomadas de una vista previa válida.
 *
 * Solo se adoptan si la fuente no cambió desde esa vista previa: de lo
 * contrario se guardaría como esperado un esquema que la consulta actual ya no
 * devuelve, y el aviso de cambio saltaría al revés.
 */
export function adoptExpectedColumns(
  dataset: ReportDataset,
  preview: ReportDatasetPreview | null,
  previewedSql: ReadonlyMap<string, string>,
): ReportDataset {
  if (!preview) {
    return dataset;
  }

  return {
    ...dataset,
    sources: dataset.sources.map((source) => {
      const read = preview.sources.find((item) => item.alias === source.alias);
      const unchanged = previewedSql.get(source.alias) === sourceFingerprint(source);

      return read?.succeeded && unchanged
        ? {
            ...source,
            expectedColumns: read.columns.map((column) => ({
              name: column.name,
              clrType: column.clrType,
            })),
          }
        : source;
    }),
  };
}

/** Lo que tiene que coincidir para que una vista previa siga describiendo la fuente. */
export function sourceFingerprint(source: ReportSource): string {
  return `${source.connectionId}|${source.database}|${normalizeSql(source.sql)}`;
}

/** Si dos definiciones dirían lo mismo al guardarse. */
export function sameDefinition(a: ReportDataset, b: ReportDataset): boolean {
  const strip = (dataset: ReportDataset) =>
    JSON.stringify({ name: dataset.name.trim(), sources: dataset.sources, join: dataset.join });

  return strip(a) === strip(b);
}
