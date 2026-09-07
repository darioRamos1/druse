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

    // Con esquema escrito: solo se avisa si ese esquema está cargado. Si no lo
    // está, lo que falta es información nuestra, no la tabla.
    if (reference.schema) {
      if (isSchemaLoaded(schema, reference.schema)) {
        problems.push({
          start: mention.start,
          end: mention.end,
          message: `No existe ${reference.schema}.${reference.name} en el esquema ${reference.schema}.`,
        });
      }

      continue;
    }

    // Sin esquema escrito solo se avisa cuando hay un único esquema cargado:
    // con varios, la tabla podría estar en uno que aún no se ha traído.
    const cargados = new Set(schema.relations.map((relation) => relation.schema.toLowerCase()));

    if (cargados.size === 1) {
      problems.push({
        start: mention.start,
        end: mention.end,
        message: `No existe la tabla ${reference.name} en ${[...cargados][0]}.`,
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

    problems.push({
      start,
      end: start + column.length,
      message: `${relation.qualified} no tiene la columna ${column}.`,
    });
  }

  return problems;
}
