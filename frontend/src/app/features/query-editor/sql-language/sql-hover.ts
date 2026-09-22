import type * as MonacoApi from 'monaco-editor';

import {
  DatabaseEngine,
  KnownColumn,
  KnownRelation,
  SchemaIndex,
} from '../../../shared/models/workspace';
import { aliasMap, findRelation } from './sql-context';
import { describeReference, referenceFor, SqlReferenceEntry } from './sql-reference';

/** Lo que el tooltip necesita saber. Es un subconjunto del contexto del editor. */
export interface HoverContext {
  readonly schema: SchemaIndex;
  /**
   * Para explicar las funciones y palabras de este motor y no las de otro.
   * Sin él se explica la primera que haya.
   */
  readonly engine?: DatabaseEngine;
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

      // ¿Es una función o una palabra reservada? Va lo último: una columna que
      // se llame `date` es antes columna que función.
      const found = referenceAt(line, word.startColumn - 1, getContext().engine);

      if (found) {
        return {
          range: {
            ...range,
            startColumn: found.start + 1,
            endColumn: found.end + 1,
          },
          contents: [{ value: describeReference(found.entry) }],
        };
      }

      return null;
    },
  });

  return () => provider.dispose();
}

/** Palabras que forman la frase más larga del catálogo: `ON DUPLICATE KEY UPDATE`. */
const MAX_PHRASE = 4;

/**
 * La entrada del catálogo bajo el cursor, si la hay.
 *
 * Se prueban primero las frases más largas que contienen la palabra: sobre el
 * `ALL` de `UNION ALL` se explica `UNION ALL`, y sobre el `BY` de `GROUP BY`,
 * `GROUP BY`. Una función solo se explica cuando se la llama —va seguida de su
 * paréntesis—: `date` a secas es mucho más a menudo un nombre que la función de
 * SQLite.
 */
function referenceAt(
  line: string,
  wordStart: number,
  engine: DatabaseEngine | undefined,
): { entry: SqlReferenceEntry; start: number; end: number } | null {
  const words = [...line.matchAll(/[\p{L}_][\p{L}\p{N}_$]*/gu)].map((match) => ({
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const index = words.findIndex((item) => item.start === wordStart);

  if (index === -1) {
    return null;
  }

  for (let size = MAX_PHRASE; size >= 1; size--) {
    for (let first = Math.max(0, index - size + 1); first <= index; first++) {
      const phrase = words.slice(first, first + size);

      if (phrase.length < size || phrase.some((item) => item === undefined)) {
        continue;
      }

      // Las palabras de una frase van separadas solo por espacios: `GROUP, BY`
      // no es `GROUP BY`.
      const contiguous = phrase.every(
        (item, position) =>
          position === 0 || /^\s+$/.test(line.slice(phrase[position - 1].end, item.start)),
      );

      if (!contiguous) {
        continue;
      }

      const entry = referenceFor(phrase.map((item) => item.text).join(' '), engine);
      const start = phrase[0].start;
      const end = phrase[phrase.length - 1].end;

      if (!entry || (entry.kind === 'function' && !/^\s*\(/.test(line.slice(end)))) {
        continue;
      }

      return { entry, start, end };
    }
  }

  return null;
}
