import { DatabaseEngine, KnownColumn } from '../../../shared/models/workspace';

/** Un filtro de la cláusula WHERE, tal y como se compone en el panel. */
export interface QueryFilter {
  readonly column: string;
  readonly operator: FilterOperator;
  /** Sin valor en `IS NULL` y `IS NOT NULL`. */
  readonly value: string;
}

export type FilterOperator =
  '=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';

/** Lo que hay que saber para escribir un SELECT. */
export interface SelectSpec {
  readonly schema?: string;
  readonly table: string;
  /** Columnas elegidas. Vacío significa `*`. */
  readonly columns: readonly string[];
  readonly filters: readonly QueryFilter[];
  readonly orderBy?: string;
  readonly descending?: boolean;
  /** `null` para no limitar. */
  readonly limit: number | null;
}

/**
 * Cita un identificador según el motor.
 *
 * Es lo mismo que hace el backend al escribir un `UPDATE`, y por el mismo
 * motivo: sin comillas, una columna que se llame `order` o `group` rompe la
 * consulta, y en PostgreSQL un nombre con mayúsculas deja de encontrarse.
 */
export function quote(engine: DatabaseEngine, identifier: string): string {
  switch (engine) {
    case 'sqlserver':
      return `[${identifier.replace(/]/g, ']]')}]`;

    case 'mysql':
      return `\`${identifier.replace(/`/g, '``')}\``;

    default:
      return `"${identifier.replace(/"/g, '""')}"`;
  }
}

/** Nombre calificado, con el esquema si lo hay. */
export function qualify(engine: DatabaseEngine, schema: string | undefined, table: string): string {
  return schema ? `${quote(engine, schema)}.${quote(engine, table)}` : quote(engine, table);
}

/**
 * Escribe un valor como literal.
 *
 * Aquí no se usan parámetros porque lo que se produce es **texto para el
 * editor**, no una consulta que se vaya a ejecutar a espaldas del usuario: lo
 * va a leer y lo puede cambiar antes de ejecutarlo. Las comillas se escapan
 * igualmente, porque un literal a medias se lee mal y se ejecuta peor.
 */
function literal(value: string): string {
  const numero = value.trim();

  // Un número se escribe sin comillas; cualquier otra cosa, entrecomillada.
  if (numero.length > 0 && Number.isFinite(Number(numero))) {
    return numero;
  }

  return `'${value.replace(/'/g, "''")}'`;
}

function condition(engine: DatabaseEngine, filter: QueryFilter): string {
  const column = quote(engine, filter.column);

  switch (filter.operator) {
    case 'IS NULL':
    case 'IS NOT NULL':
      return `${column} ${filter.operator}`;

    case 'IN':
      // Se acepta la lista tal y como se escribe: `1, 2, 3` o `'a', 'b'`.
      return `${column} IN (${filter.value})`;

    case 'LIKE':
      return `${column} LIKE ${literal(filter.value)}`;

    default:
      return `${column} ${filter.operator} ${literal(filter.value)}`;
  }
}

/**
 * Escribe el SELECT.
 *
 * Limitar filas es lo que más cambia entre motores y lo que peor se recuerda:
 * `LIMIT` va al final en PostgreSQL y MySQL, y `TOP` va justo después del
 * SELECT en SQL Server.
 */
export function buildSelect(engine: DatabaseEngine, spec: SelectSpec): string {
  const columnas =
    spec.columns.length > 0 ? spec.columns.map((column) => quote(engine, column)).join(', ') : '*';

  const top = engine === 'sqlserver' && spec.limit ? `TOP ${spec.limit} ` : '';

  const lineas = [`SELECT ${top}${columnas}`, `FROM ${qualify(engine, spec.schema, spec.table)}`];

  if (spec.filters.length > 0) {
    const condiciones = spec.filters.map((filter) => condition(engine, filter));

    lineas.push(`WHERE ${condiciones.join('\n  AND ')}`);
  }

  if (spec.orderBy) {
    lineas.push(`ORDER BY ${quote(engine, spec.orderBy)}${spec.descending ? ' DESC' : ''}`);
  }

  if (spec.limit && engine !== 'sqlserver') {
    lineas.push(`LIMIT ${spec.limit}`);
  }

  return `${lineas.join('\n')};\n`;
}

/**
 * Plantilla de `INSERT` con las columnas de la tabla.
 *
 * Se dejan fuera las que el motor rellena solo —identidad o autoincremento—,
 * porque escribirlas obliga a quitarlas a mano o a pelearse con el servidor.
 */
export function buildInsert(
  engine: DatabaseEngine,
  spec: { schema?: string; table: string; columns: readonly KnownColumn[] },
): string {
  const columnas = spec.columns.filter((column) => !isGenerated(column));

  const nombres = columnas.map((column) => quote(engine, column.name)).join(', ');
  const huecos = columnas.map((column) => `/* ${column.dataType} */`).join(', ');

  if (columnas.length === 0) {
    return engine === 'mysql'
      ? `INSERT INTO ${qualify(engine, spec.schema, spec.table)} ()\nVALUES ();\n`
      : `INSERT INTO ${qualify(engine, spec.schema, spec.table)}\nDEFAULT VALUES;\n`;
  }

  return `INSERT INTO ${qualify(engine, spec.schema, spec.table)} (${nombres})\nVALUES (${huecos});\n`;
}

/**
 * Plantilla de `UPDATE`, con el `WHERE` por clave primaria ya puesto.
 *
 * El filtro no es opcional: un `UPDATE` sin él es justo lo que Druse obliga a
 * confirmar antes de ejecutar, y ofrecerlo escrito sería una invitación.
 */
export function buildUpdate(
  engine: DatabaseEngine,
  spec: { schema?: string; table: string; columns: readonly KnownColumn[] },
): string {
  const clave = spec.columns.filter((column) => column.isPrimaryKey);
  const resto = spec.columns.filter((column) => !column.isPrimaryKey && !isGenerated(column));

  if (resto.length === 0) {
    return '-- Esta tabla no tiene columnas modificables.\n';
  }

  const asignaciones = resto
    .map((column) => `  ${quote(engine, column.name)} = /* ${column.dataType} */`)
    .join(',\n');

  const filtro =
    clave.length > 0
      ? clave
          .map((column) => `${quote(engine, column.name)} = /* ${column.dataType} */`)
          .join(' AND ')
      : '/* condición: esta tabla no tiene clave primaria */';

  return `UPDATE ${qualify(engine, spec.schema, spec.table)}\nSET\n${asignaciones}\nWHERE ${filtro};\n`;
}

/** Plantilla destructiva que siempre se revisa en el editor antes de ejecutarse. */
export function buildDropTable(
  engine: DatabaseEngine,
  spec: { schema?: string; table: string },
): string {
  return `DROP TABLE ${qualify(engine, spec.schema, spec.table)};\n`;
}

/**
 * `CREATE TABLE` a partir de lo que el catálogo sabe de la tabla.
 *
 * Los tipos se copian tal cual los reporta el motor: traducirlos entre
 * dialectos sería otra función distinta, y una que se equivoca en silencio.
 */
export function buildCreateTable(
  engine: DatabaseEngine,
  spec: { schema?: string; table: string; columns: readonly KnownColumn[] },
): string {
  const columnas = spec.columns.map((column) => {
    const partes = [`  ${quote(engine, column.name)} ${column.dataType}`];

    if (!column.isNullable) {
      partes.push('NOT NULL');
    }

    return partes.join(' ');
  });

  const clave = spec.columns.filter((column) => column.isPrimaryKey);

  if (clave.length > 0) {
    columnas.push(
      `  PRIMARY KEY (${clave.map((column) => quote(engine, column.name)).join(', ')})`,
    );
  }

  return `CREATE TABLE ${qualify(engine, spec.schema, spec.table)} (\n${columnas.join(',\n')}\n);\n`;
}

/** Columnas que el motor rellena solo y que no se escriben en un INSERT. */
function isGenerated(column: KnownColumn): boolean {
  return column.isGenerated === true;
}
