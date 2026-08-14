import { DatabaseEngine, KnownColumn } from '../../../shared/models/workspace';

/** Un filtro de la cláusula WHERE, tal y como se compone en el panel. */
export interface QueryFilter {
  readonly column: string;
  readonly operator: FilterOperator;
  /** `null` significa que todavía no se rellenó; `''` es texto vacío. */
  readonly value: string | null;
}

export type FilterOperator =
  '=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';

/** Lo que hay que saber para escribir un SELECT. */
export interface SelectSpec {
  readonly schema?: string;
  readonly table: string;
  /** Columnas elegidas. Vacío significa `*`. */
  readonly columns: readonly (string | SelectColumn)[];
  readonly filters: readonly QueryFilter[];
  readonly orderBy?: string;
  readonly descending?: boolean;
  /** `null` para no limitar. */
  readonly limit: number | null;
  /** Alias de la tabla principal cuando existen cruces. */
  readonly alias?: string;
  readonly joins?: readonly QueryJoin[];
}

export interface SelectColumn {
  readonly alias: string;
  readonly column: string;
}

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL OUTER' | 'CROSS';

export interface QueryJoin {
  readonly type: JoinType;
  readonly schema?: string;
  readonly table: string;
  readonly alias: string;
  readonly leftAlias: string;
  readonly leftColumn: string;
  readonly rightColumn: string;
}

export type SqlInputValue =
  | { readonly kind: 'value'; readonly text: string | null }
  | { readonly kind: 'null' }
  | { readonly kind: 'default' };

export interface ColumnWrite {
  readonly column: string;
  readonly dataType: string;
  readonly value: SqlInputValue;
}

export interface InsertValuesSpec {
  readonly schema?: string;
  readonly table: string;
  /** Las columnas omitidas conservan el valor por defecto del servidor. */
  readonly values: readonly ColumnWrite[];
}

export interface UpdateValuesSpec {
  readonly schema?: string;
  readonly table: string;
  readonly assignments: readonly ColumnWrite[];
  readonly filters: readonly QueryFilter[];
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

function condition(engine: DatabaseEngine, filter: QueryFilter, alias?: string): string {
  const column = alias
    ? `${quote(engine, alias)}.${quote(engine, filter.column)}`
    : quote(engine, filter.column);

  switch (filter.operator) {
    case 'IS NULL':
    case 'IS NOT NULL':
      return `${column} ${filter.operator}`;

    case 'IN':
      // Se acepta la lista tal y como se escribe: `1, 2, 3` o `'a', 'b'`.
      return `${column} IN (${filter.value ?? '/* valores obligatorios */'})`;

    case 'LIKE':
      return `${column} LIKE ${filter.value === null ? '/* valor obligatorio */' : literal(filter.value)}`;

    default:
      return `${column} ${filter.operator} ${filter.value === null ? '/* valor obligatorio */' : literal(filter.value)}`;
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
  const alias = spec.alias ?? ((spec.joins?.length ?? 0) > 0 ? 't0' : undefined);
  const selectColumn = (column: string | SelectColumn) =>
    typeof column === 'string'
      ? alias
        ? `${quote(engine, alias)}.${quote(engine, column)}`
        : quote(engine, column)
      : `${quote(engine, column.alias)}.${quote(engine, column.column)}`;
  const columnas =
    spec.columns.length > 0
      ? spec.columns.map(selectColumn).join(', ')
      : alias
        ? `${quote(engine, alias)}.*`
        : '*';

  const top = engine === 'sqlserver' && spec.limit ? `TOP ${spec.limit} ` : '';

  const from = alias
    ? `${qualify(engine, spec.schema, spec.table)} AS ${quote(engine, alias)}`
    : qualify(engine, spec.schema, spec.table);
  const lineas = [`SELECT ${top}${columnas}`, `FROM ${from}`];

  for (const join of spec.joins ?? []) {
    lineas.push(
      `${join.type} JOIN ${qualify(engine, join.schema, join.table)} AS ${quote(engine, join.alias)}`,
    );

    if (join.type !== 'CROSS') {
      lineas.push(
        `  ON ${quote(engine, join.leftAlias)}.${quote(engine, join.leftColumn)} = ${quote(engine, join.alias)}.${quote(engine, join.rightColumn)}`,
      );
    }
  }

  if (spec.filters.length > 0) {
    const condiciones = spec.filters.map((filter) => condition(engine, filter, alias));

    lineas.push(`WHERE ${condiciones.join('\n  AND ')}`);
  }

  if (spec.orderBy) {
    const order = alias
      ? `${quote(engine, alias)}.${quote(engine, spec.orderBy)}`
      : quote(engine, spec.orderBy);
    lineas.push(`ORDER BY ${order}${spec.descending ? ' DESC' : ''}`);
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

/** INSERT rellenado desde el compositor, conservando NULL y DEFAULT como estados distintos. */
export function buildInsertValues(engine: DatabaseEngine, spec: InsertValuesSpec): string {
  if (spec.values.length === 0) {
    return engine === 'mysql'
      ? `INSERT INTO ${qualify(engine, spec.schema, spec.table)} ()\nVALUES ();\n`
      : `INSERT INTO ${qualify(engine, spec.schema, spec.table)}\nDEFAULT VALUES;\n`;
  }

  const columns = spec.values.map((entry) => quote(engine, entry.column)).join(', ');
  const values = spec.values.map((entry) => writeValue(entry)).join(', ');

  return `INSERT INTO ${qualify(engine, spec.schema, spec.table)} (${columns})\nVALUES (${values});\n`;
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

/** UPDATE rellenado; nunca produce una sentencia ejecutable sin cláusula WHERE. */
export function buildUpdateValues(engine: DatabaseEngine, spec: UpdateValuesSpec): string {
  if (spec.assignments.length === 0) {
    return '-- Elige al menos una columna para modificar.\n';
  }

  const assignments = spec.assignments
    .map((entry) => `  ${quote(engine, entry.column)} = ${writeValue(entry)}`)
    .join(',\n');
  const filters = spec.filters.filter((filter) => filter.column.length > 0);
  const where =
    filters.length > 0
      ? filters.map((filter) => condition(engine, filter)).join('\n  AND ')
      : '/* condición obligatoria */';

  return `UPDATE ${qualify(engine, spec.schema, spec.table)}\nSET\n${assignments}\nWHERE ${where};\n`;
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

function writeValue(entry: ColumnWrite): string {
  switch (entry.value.kind) {
    case 'null':
      return 'NULL';
    case 'default':
      return 'DEFAULT';
    case 'value':
      return entry.value.text === null
        ? `/* ${entry.dataType}: valor obligatorio */`
        : literal(entry.value.text);
  }
}
