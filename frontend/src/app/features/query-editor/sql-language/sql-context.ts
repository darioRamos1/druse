import { KnownRelation, SchemaIndex } from '../../../shared/models/workspace';

/** Una relación nombrada en el SQL, con su esquema si el usuario lo escribió. */
export interface SqlReference {
  readonly schema: string | null;
  readonly name: string;
}

/**
 * Palabras que ocupan el sitio de un alias sin serlo.
 *
 * `FROM usuarios WHERE …` declararía un alias llamado «where» si no se filtran.
 */
const NOT_ALIASES = new Set([
  'WHERE', 'ON', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN', 'GROUP',
  'ORDER', 'SET', 'VALUES', 'UNION', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'USING',
]);

const IDENTIFIER = '[\\p{L}_][\\p{L}\\p{N}_$]*';

/** `FROM tabla alias`, `JOIN esquema.tabla AS alias`, `UPDATE tabla`… */
const RELATION_PATTERN = new RegExp(
  `\\b(FROM|JOIN|UPDATE|INTO)\\s+(${IDENTIFIER}(?:\\.${IDENTIFIER})?)(?:\\s+(?:AS\\s+)?(${IDENTIFIER}))?`,
  'giu',
);

/** Nombres declarados por el propio SQL: `WITH ventas AS (…)`. */
const CTE_PATTERN = new RegExp(`\\b(?:WITH|,)\\s*(${IDENTIFIER})\\s+AS\\s*\\(`, 'giu');

/** Una referencia a una tabla encontrada en el texto, con dónde está escrita. */
export interface RelationMention {
  readonly reference: SqlReference;
  /** Alias con el que se la nombra después, o su propio nombre. */
  readonly alias: string;
  /** Posición del nombre dentro del texto completo. */
  readonly start: number;
  readonly end: number;
}

/** Nombres que el propio SQL define y que no hay que buscar en el catálogo. */
export function declaredNames(sql: string): Set<string> {
  const names = new Set<string>();

  for (const match of sql.matchAll(CTE_PATTERN)) {
    names.add(match[1].toLowerCase());
  }

  return names;
}

/**
 * Todas las tablas nombradas en el SQL.
 *
 * Es un análisis por expresiones regulares, no un analizador de SQL. Sirve para
 * ayudar —sugerir, describir, avisar—, nunca para decidir si una consulta es
 * válida: de eso ya se encarga el servidor al ejecutarla.
 */
export function relationMentions(sql: string): RelationMention[] {
  const mentions: RelationMention[] = [];
  const declared = declaredNames(sql);

  for (const match of sql.matchAll(RELATION_PATTERN)) {
    const [full, keyword, relation, alias] = match;
    const parts = relation.split('.');
    const reference: SqlReference = {
      schema: parts.length > 1 ? parts[0] : null,
      name: parts[parts.length - 1],
    };

    if (declared.has(reference.name.toLowerCase())) {
      continue;
    }

    const usable = alias && !NOT_ALIASES.has(alias.toUpperCase()) ? alias : reference.name;
    const start = (match.index ?? 0) + full.indexOf(relation, keyword.length);

    mentions.push({
      reference,
      alias: usable.toLowerCase(),
      start,
      end: start + relation.length,
    });
  }

  return mentions;
}

/** Alias declarados en el SQL, en minúsculas. */
export function aliasMap(sql: string): Map<string, SqlReference> {
  const aliases = new Map<string, SqlReference>();

  for (const mention of relationMentions(sql)) {
    aliases.set(mention.alias, mention.reference);
    aliases.set(mention.reference.name.toLowerCase(), mention.reference);
  }

  return aliases;
}

/**
 * Busca la relación a la que apunta una referencia.
 *
 * Cuando el esquema es conocido manda él; sin esquema se acepta la primera
 * coincidencia por nombre, que es lo único que se puede hacer sin analizar el
 * `search_path` del servidor.
 */
export function findRelation(
  index: SchemaIndex,
  reference: SqlReference,
): KnownRelation | undefined {
  const name = reference.name.toLowerCase();
  const byName = index.relations.filter(
    (candidate) => candidate.name.toLowerCase() === name,
  );

  if (!reference.schema) {
    return byName[0];
  }

  const schema = reference.schema.toLowerCase();

  return byName.find((candidate) => candidate.schema.toLowerCase() === schema);
}

/** ¿El catálogo sabe ya lo que hay dentro de este esquema? */
export function isSchemaLoaded(index: SchemaIndex, schema: string): boolean {
  const wanted = schema.toLowerCase();

  return index.relations.some((relation) => relation.schema.toLowerCase() === wanted);
}
