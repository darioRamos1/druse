import type * as MonacoApi from 'monaco-editor';

import { SchemaIndex } from '../../../shared/models/workspace';
import {
  aliasMap,
  declaredNames,
  findRelation,
  isSchemaLoaded,
  relationMentions,
} from './sql-context';

/** Un aviso sobre un trozo del SQL, en posiciones absolutas del texto. */
export interface SqlProblem {
  readonly start: number;
  readonly end: number;
  readonly message: string;
  /**
   * El texto que lo arreglaría, si hay un nombre parecido que sí existe.
   *
   * Sustituye exactamente `start`–`end`. Es lo que ofrece el arreglo rápido
   * (la bombilla, o Ctrl+.) sobre el subrayado.
   */
  readonly fix?: string;
}

const IDENTIFIER = '[\\p{L}_][\\p{L}\\p{N}_$]*';

/** `alias.columna`, que es la única forma de saber de qué tabla se habla. */
const QUALIFIED_COLUMN = new RegExp(`\\b(${IDENTIFIER})\\.(${IDENTIFIER})\\b`, 'giu');

/**
 * Busca nombres que el catálogo cargado desmiente.
 *
 * **La regla es no hablar si no se está seguro.** Un aviso falso sobre SQL
 * correcto es peor que no avisar: enseña a ignorar los avisos, y a partir de ahí
 * no sirven para nada. Por eso solo se señala algo cuando el catálogo tiene
 * cargado justo lo que hace falta para desmentirlo:
 *
 * - una tabla, solo si su esquema está cargado entero;
 * - una columna, solo si esa tabla tiene ya sus columnas.
 *
 * No es un analizador de SQL. No entiende subconsultas ni columnas sin calificar,
 * y no pretende hacerlo: quien decide si la consulta es válida es el servidor.
 */
export function findProblems(sql: string, schema: SchemaIndex): SqlProblem[] {
  // Sin catálogo no hay nada que contrastar: al conectar, durante el primer
  // segundo, todo estaría subrayado.
  if (schema.relations.length === 0) {
    return [];
  }

  const problems: SqlProblem[] = [];
  const declarados = declaredNames(sql);

  // --- Tablas --------------------------------------------------------------
  for (const mention of relationMentions(sql)) {
    const { reference } = mention;

    if (findRelation(schema, reference)) {
      continue;
    }

    // Lo que el usuario escribió, tal cual. Solo se ofrece arreglo sobre un
    // nombre sin comillas: reescribir `"Clientes"` sin ellas cambiaría a qué
    // tabla apunta en PostgreSQL.
    const written = sql.slice(mention.start, mention.end);
    const plain = /^[\p{L}\p{N}_$.]+$/u.test(written);

    // Con esquema escrito: solo se avisa si ese esquema está cargado. Si no lo
    // está, lo que falta es información nuestra, no la tabla.
    if (reference.schema) {
      if (isSchemaLoaded(schema, reference.schema)) {
        const parecida = closest(
          reference.name,
          schema.relations
            .filter((relation) => relation.schema.toLowerCase() === reference.schema!.toLowerCase())
            .map((relation) => relation.name),
        );

        problems.push({
          start: mention.start,
          end: mention.end,
          message:
            `No existe ${reference.schema}.${reference.name} en el esquema ${reference.schema}.` +
            didYouMean(parecida),
          ...(parecida && plain ? { fix: `${reference.schema}.${parecida}` } : {}),
        });
      }

      continue;
    }

    // Sin esquema escrito solo se avisa cuando hay un único esquema cargado:
    // con varios, la tabla podría estar en uno que aún no se ha traído.
    const cargados = new Set(schema.relations.map((relation) => relation.schema.toLowerCase()));

    if (cargados.size === 1) {
      const parecida = closest(
        reference.name,
        schema.relations.map((relation) => relation.name),
      );

      problems.push({
        start: mention.start,
        end: mention.end,
        message:
          `No existe la tabla ${reference.name} en ${[...cargados][0]}.` + didYouMean(parecida),
        ...(parecida && plain ? { fix: parecida } : {}),
      });
    }
  }

  // --- Columnas calificadas ------------------------------------------------
  const aliases = aliasMap(sql);

  for (const match of sql.matchAll(QUALIFIED_COLUMN)) {
    const [, qualifier, column] = match;
    const alias = qualifier.toLowerCase();

    // `esquema.tabla` no es `alias.columna`, y una CTE no está en el catálogo.
    if (declarados.has(alias) || schema.schemas.some((s) => s.toLowerCase() === alias)) {
      continue;
    }

    const reference = aliases.get(alias);

    if (!reference) {
      continue;
    }

    const relation = findRelation(schema, reference);

    // Sin columnas cargadas no se puede desmentir nada.
    if (!relation || relation.columns.length === 0) {
      continue;
    }

    if (relation.columns.some((item) => item.name.toLowerCase() === column.toLowerCase())) {
      continue;
    }

    const start = (match.index ?? 0) + qualifier.length + 1;
    const parecida = closest(
      column,
      relation.columns.map((item) => item.name),
    );

    problems.push({
      start,
      end: start + column.length,
      message: `${relation.qualified} no tiene la columna ${column}.` + didYouMean(parecida),
      ...(parecida ? { fix: parecida } : {}),
    });
  }

  return problems;
}

function didYouMean(name: string | null): string {
  return name ? ` ¿Quisiste decir ${name}?` : '';
}

/**
 * El nombre más parecido de la lista, si se parece lo bastante.
 *
 * «Lo bastante» es una letra de cada tres, y como mucho tres: `usuarioss` o
 * `ususarios` encuentran `usuarios`, pero `pedidos` no propone `periodos`.
 * Proponer algo que no tiene que ver es peor que no proponer nada: el aviso ya
 * dice que el nombre no existe, y una sugerencia absurda solo hace dudar de él.
 */
export function closest(name: string, candidates: readonly string[]): string | null {
  const target = name.toLowerCase();
  const limit = Math.min(3, Math.max(1, Math.floor(target.length / 3)));
  let best: string | null = null;
  let bestDistance = limit + 1;

  for (const candidate of candidates) {
    const distance = editDistance(target, candidate.toLowerCase());

    if (distance > 0 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * Cuántas letras hay que tocar para pasar de un nombre a otro (Damerau-
 * Levenshtein restringida).
 *
 * Cuenta el cambio de dos letras vecinas como un solo error, porque es el error
 * más común al teclear rápido: `usaurios` está a un paso de `usuarios`, no a dos.
 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }

  return d[rows - 1][cols - 1];
}

/** Lo que el arreglo rápido necesita: el catálogo y el modelo de su editor. */
export interface QuickFixContext {
  readonly schema: SchemaIndex;
  readonly model: MonacoApi.editor.ITextModel | null;
}

/**
 * Ofrece cambiar un nombre mal escrito por el que se le parece.
 *
 * Los avisos se vuelven a calcular aquí en vez de guardarse al subrayar: son
 * baratos, y así lo que se ofrece corresponde siempre al texto de ahora y no al
 * de hace medio segundo.
 *
 * Solo responde por el modelo de su editor: el proveedor es global al lenguaje,
 * y con dos editores abiertos cada arreglo saldría repetido.
 */
export function registerSqlQuickFixes(
  monaco: typeof MonacoApi,
  getContext: () => QuickFixContext,
): () => void {
  const provider = monaco.languages.registerCodeActionProvider('sql', {
    provideCodeActions(model, range) {
      const { schema, model: own } = getContext();
      const actions: MonacoApi.languages.CodeAction[] = [];

      if (model !== own) {
        return { actions, dispose: () => undefined };
      }

      for (const problem of findProblems(model.getValue(), schema)) {
        if (!problem.fix) {
          continue;
        }

        const start = model.getPositionAt(problem.start);
        const end = model.getPositionAt(problem.end);
        const target = {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };

        if (!monaco.Range.areIntersectingOrTouching(target, range)) {
          continue;
        }

        actions.push({
          title: `Cambiar por ${problem.fix}`,
          kind: 'quickfix',
          isPreferred: true,
          diagnostics: [
            { ...target, severity: monaco.MarkerSeverity.Warning, message: problem.message },
          ],
          edit: {
            edits: [
              {
                resource: model.uri,
                versionId: model.getVersionId(),
                textEdit: { range: target, text: problem.fix },
              },
            ],
          },
        });
      }

      return { actions, dispose: () => undefined };
    },
  });

  return () => provider.dispose();
}
