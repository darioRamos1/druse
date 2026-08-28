import { KnownRelation } from '../../shared/models/workspace';

/** Lo que el asistente sabe de la base, ya compuesto y listo para enviar. */
export interface AiSchemaContext {
  /** El texto que viaja. Vacío cuando no hay nada que contar. */
  readonly schema: string;
  /** Nombres calificados de lo que va dentro, para poder enseñarlos. */
  readonly tables: readonly string[];
}

/**
 * Cuántas tablas se describen como mucho.
 *
 * Una base de trescientas tablas no cabe en la pregunta —ni conviene: cuesta
 * dinero por tokens y entierra lo que importa entre ruido—. El tope se aplica a
 * las tablas cargadas, que son las que el usuario ha estado mirando, así que lo
 * que sobrevive al corte suele ser lo que está usando.
 */
const MAX_TABLES = 40;

/**
 * Cuántas columnas se describen por tabla.
 *
 * Una tabla ancha —de esas de ciento veinte columnas que aparecen en sistemas
 * viejos— se comería el presupuesto entero. Se cuentan las que faltan para que
 * el modelo sepa que hay más y pueda pedirlas.
 */
const MAX_COLUMNS = 60;

/**
 * Describe el esquema para el asistente.
 *
 * **Estructura, nunca datos.** De aquí sale cómo se llaman las tablas y las
 * columnas y de qué tipo son; ninguna fila. Es lo que hace útil al asistente sin
 * mandar fuera información de nadie, y por eso la composición vive en una
 * función suelta y probada en lugar de estar embebida en un componente: es la
 * frontera por la que sale trabajo del equipo.
 *
 * El formato imita un `CREATE TABLE` recortado porque es lo que mejor entienden
 * los modelos: han leído millones. Una lista en prosa se interpreta peor.
 */
export function describeSchema(relations: readonly KnownRelation[]): AiSchemaContext {
  // Primero lo que tiene columnas conocidas: una tabla de la que solo se sabe
  // el nombre ocupa sitio y apenas ayuda, así que cede el turno.
  const ordered = [...relations].sort(
    (left, right) => Number(right.columns.length > 0) - Number(left.columns.length > 0),
  );

  const chosen = ordered.slice(0, MAX_TABLES);

  if (chosen.length === 0) {
    return { schema: '', tables: [] };
  }

  const lines: string[] = [];
  const tables: string[] = [];

  for (const relation of chosen) {
    tables.push(relation.qualified);
    lines.push(describeRelation(relation));
  }

  const omitted = relations.length - chosen.length;

  if (omitted > 0) {
    lines.push(`-- y ${omitted} tablas más que no se han cargado.`);
  }

  return { schema: lines.join('\n'), tables };
}

function describeRelation(relation: KnownRelation): string {
  const what = relation.kind === 'view' ? 'VIEW' : 'TABLE';

  // Sin columnas cargadas se dice el nombre y ya: es más útil que callarlo
  // —el modelo sabe que la tabla existe y puede preguntar por ella— y es
  // honesto sobre lo que no se sabe.
  if (relation.columns.length === 0) {
    return `${what} ${relation.qualified};`;
  }

  const columns = relation.columns.slice(0, MAX_COLUMNS).map((column) => {
    const marks = [
      column.dataType,
      column.isPrimaryKey ? 'PRIMARY KEY' : '',
      column.isNullable ? '' : 'NOT NULL',
    ]
      .filter((mark) => mark.length > 0)
      .join(' ');

    return `  ${column.name} ${marks}`;
  });

  const rest = relation.columns.length - columns.length;

  if (rest > 0) {
    columns.push(`  -- y ${rest} columnas más`);
  }

  return `${what} ${relation.qualified} (\n${columns.join(',\n')}\n);`;
}
