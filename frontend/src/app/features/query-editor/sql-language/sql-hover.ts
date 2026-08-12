import type * as MonacoApi from 'monaco-editor';

import { KnownColumn, KnownRelation, SchemaIndex } from '../../../shared/models/workspace';
import { aliasMap, findRelation } from './sql-context';

/** Lo que el tooltip necesita saber. Es un subconjunto del contexto del editor. */
export interface HoverContext {
  readonly schema: SchemaIndex;
}

/** Columnas que se listan antes de cortar. */
const MAX_COLUMNS = 12;

/** Descripción de una tabla: qué es, dónde vive y qué columnas tiene. */
function describeRelation(relation: KnownRelation): string {
  const tipo = relation.kind === 'view' ? 'Vista' : 'Tabla';
  const lineas = [`**${tipo}** \`${relation.qualified}\``];

  if (relation.columns.length === 0) {
    // Puede que simplemente no se hayan pedido todavía; decir «no tiene
    // columnas» sería mentir.
    lineas.push('', '_Sus columnas aún no se han cargado._');

    return lineas.join('\n');
  }

  lineas.push('', `${relation.columns.length} columnas:`, '');

  for (const column of relation.columns.slice(0, MAX_COLUMNS)) {
    lineas.push(`- ${describeColumnLine(column)}`);
  }

  if (relation.columns.length > MAX_COLUMNS) {
    lineas.push(`- _y ${relation.columns.length - MAX_COLUMNS} más_`);
  }

  return lineas.join('\n');
}

function describeColumnLine(column: KnownColumn): string {
  const marcas = [`\`${column.dataType}\``];

  if (column.isPrimaryKey) {
    marcas.push('clave primaria');
  }

  if (!column.isNullable) {
    marcas.push('no nulo');
  }

  return `**${column.name}** — ${marcas.join(' · ')}`;
}

/** Descripción de una columna concreta. */
function describeColumn(relation: KnownRelation, column: KnownColumn): string {
  return [
    `**${column.name}** — \`${column.dataType}\``,
    '',
    `${column.isNullable ? 'Admite nulos' : 'No admite nulos'}${
      column.isPrimaryKey ? ' · clave primaria' : ''
    }`,
    '',
    `_${relation.qualified}_`,
  ].join('\n');
}

/**
 * Muestra al pasar el ratón lo que hay detrás de un nombre.
 *
 * Es la ayuda que evita el viaje de ida y vuelta al explorador para recordar si
 * una columna era `varchar(200)` o `nvarchar(50)`, o si admitía nulos. Todo sale
 * de lo que ya está cargado: el tooltip nunca dispara una consulta, porque
 * aparecería tarde y con el ratón ya en otro sitio.
 */
export function registerSqlHover(
  monaco: typeof MonacoApi,
  getContext: () => HoverContext,
): () => void {
  const provider = monaco.languages.registerHoverProvider('sql', {
    provideHover(model, position) {
      const { schema } = getContext();
      const word = model.getWordAtPosition(position);

      if (!word) {
        return null;
      }

      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const sql = model.getValue();
      const aliases = aliasMap(sql);
      const name = word.word.toLowerCase();

      // ¿Es una tabla, o el alias de una?
      const referenced = aliases.get(name);
      const relation = referenced
        ? findRelation(schema, referenced)
        : findRelation(schema, { schema: null, name });

      if (relation) {
        return { range, contents: [{ value: describeRelation(relation) }] };
      }

      // ¿Es una columna de alguna de las tablas en juego?
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, word.startColumn - 1);
      const qualifier = /([\p{L}_][\p{L}\p{N}_$]*)\.\s*$/u.exec(before)?.[1]?.toLowerCase();

      const candidatas = qualifier
        ? [aliases.get(qualifier) ?? { schema: null, name: qualifier }]
        : [...aliases.values()];

      for (const candidata of candidatas) {
        const owner = findRelation(schema, candidata);
        const column = owner?.columns.find((item) => item.name.toLowerCase() === name);

        if (owner && column) {
          return { range, contents: [{ value: describeColumn(owner, column) }] };
        }
      }

      return null;
    },
  });

  return () => provider.dispose();
}
