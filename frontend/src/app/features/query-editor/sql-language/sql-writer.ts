import { translate } from '../../../core/i18n/active';
import { DatabaseEngine, KnownColumn } from '../../../shared/models/workspace';
import { DatePeriod, SQL_DIALECTS } from './sql-dialects';

/**
 * El periodo al que se agrupa una fecha.
 *
 * Se declara con los dialectos, que son quienes saben escribirlo, y se
 * reexporta desde aquí porque es parte de la forma de una consulta.
 */
export type { DatePeriod };

/** Un filtro de la cláusula WHERE, tal y como se compone en el panel. */
export interface QueryFilter {
  readonly column: string;
  readonly operator: FilterOperator;
  /** `null` significa que todavía no se rellenó; `''` es texto vacío. */
  readonly value: string | null;
  /** El otro extremo de `BETWEEN`. Los demás operadores lo ignoran. */
  readonly valueTo?: string | null;
  /**
   * Comparar con otra columna de la misma tabla en vez de con un valor:
   * `fecha_entrega > fecha_pedido`. Solo con los operadores de comparación;
   * con el resto no significa nada y se ignora.
   */
  readonly compareColumn?: string | null;
  /** Cómo se enlaza con la condición anterior. La primera ignora este valor. */
  readonly conjunction?: LogicalOperator;
}

export type LogicalOperator = 'AND' | 'OR';

export type FilterOperator =
  | '='
  | '<>'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'BETWEEN'
  | 'LIKE'
  | 'NOT LIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL';

/** Lo que hay que saber para escribir un SELECT. */
export interface SelectSpec {
  readonly schema?: string;
  readonly table: string;
  /** Columnas elegidas. Vacío significa `*`. */
  readonly columns: readonly (string | SelectColumn)[];
  /** Quitar las filas repetidas del resultado. */
  readonly distinct?: boolean;
  readonly filters: readonly QueryFilter[];
  readonly orderBy?: string | SelectColumn;
  readonly descending?: boolean;
  /** `null` para no limitar. */
  readonly limit: number | null;
  /** Alias de la tabla principal cuando existen cruces. */
  readonly alias?: string;
  readonly joins?: readonly QueryJoin[];
  readonly groupBy?: readonly (string | SelectColumn)[];
  readonly aggregates?: readonly SelectAggregate[];
  readonly having?: readonly AggregateFilter[];
  readonly dateGroups?: readonly DateGroup[];
  readonly orders?: readonly SelectOrder[];
}

export interface SelectColumn {
  readonly alias: string;
  readonly column: string;
}

export type AggregateFunction = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';

/** Expresión agregada que se muestra en el SELECT y se puede usar en HAVING. */
export interface SelectAggregate {
  readonly function: AggregateFunction;
  readonly column: '*' | string | SelectColumn;
  readonly alias?: string;
  readonly distinct?: boolean;
}

/** Condición aplicada después de agrupar; repite la expresión para ser portable. */
export interface AggregateFilter {
  readonly aggregate: SelectAggregate;
  readonly operator: FilterOperator;
  readonly value: string | null;
  readonly conjunction?: LogicalOperator;
}

export interface DateGroup {
  readonly column: string | SelectColumn;
  readonly period: DatePeriod;
  readonly alias?: string;
}

export interface SelectOrder {
  readonly expression: string | SelectColumn | SelectAggregate | DateGroup;
  readonly descending?: boolean;
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
  return SQL_DIALECTS[engine].quote(identifier);
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

  const other = filter.compareColumn
    ? alias
      ? `${quote(engine, alias)}.${quote(engine, filter.compareColumn)}`
      : quote(engine, filter.compareColumn)
    : null;

  return comparison(column, filter, other);
}

/** Los operadores que comparan dos cosas del mismo tipo, y por tanto dos columnas. */
export const COMPARISON_OPERATORS: readonly FilterOperator[] = ['=', '<>', '>', '>=', '<', '<='];

function comparison(
  expression: string,
  filter: Pick<QueryFilter, 'operator' | 'value' | 'valueTo'>,
  other?: string | null,
): string {
  const valor = (value: string | null | undefined) =>
    value === null || value === undefined
      ? `/* ${translate('sql.writer.requiredValue')} */`
      : literal(value);

  if (other && COMPARISON_OPERATORS.includes(filter.operator)) {
    return `${expression} ${filter.operator} ${other}`;
  }

  switch (filter.operator) {
    case 'IS NULL':
    case 'IS NOT NULL':
      return `${expression} ${filter.operator}`;

    case 'IN':
    case 'NOT IN':
      // Se acepta la lista tal y como se escribe: `1, 2, 3` o `'a', 'b'`.
      return `${expression} ${filter.operator} (${
        filter.value ?? `/* ${translate('sql.writer.requiredValues')} */`
      })`;

    case 'BETWEEN':
      // Los dos extremos entran: es lo que dice SQL, y lo que el panel explica.
      return `${expression} BETWEEN ${valor(filter.value)} AND ${valor(filter.valueTo)}`;

    default:
      return `${expression} ${filter.operator} ${valor(filter.value)}`;
  }
}

function columnReference(
  engine: DatabaseEngine,
  column: string | SelectColumn,
  defaultAlias?: string,
): string {
  if (typeof column !== 'string') {
    return `${quote(engine, column.alias)}.${quote(engine, column.column)}`;
  }

  return defaultAlias
    ? `${quote(engine, defaultAlias)}.${quote(engine, column)}`
    : quote(engine, column);
}

function aggregateExpression(
  engine: DatabaseEngine,
  aggregate: SelectAggregate,
  defaultAlias?: string,
): string {
  const argument =
    aggregate.column === '*' ? '*' : columnReference(engine, aggregate.column, defaultAlias);

  return `${aggregate.function}(${aggregate.distinct ? 'DISTINCT ' : ''}${argument})`;
}

function dateGroupExpression(
  engine: DatabaseEngine,
  group: DateGroup,
  defaultAlias?: string,
): string {
  return SQL_DIALECTS[engine].dateTrunc(
    columnReference(engine, group.column, defaultAlias),
    group.period,
  );
}

/**
 * Une las condiciones **en el orden en que se leen**, de arriba abajo.
 *
 * SQL evalúa `AND` antes que `OR`, así que la lista «A o B y C» escrita tal
 * cual significaba `A OR (B AND C)`: con A cierto, la fila salía aunque C
 * fallara, y en el panel nada lo dejaba ver. Aquí cada cambio de `AND` a `OR`
 * —o al revés— cierra un paréntesis sobre lo anterior: `(A OR B) AND C`, que
 * es lo que se lee. Mientras no se mezclan, no se añade ninguno.
 */
function conditions<T extends Pick<QueryFilter, 'operator' | 'value' | 'valueTo' | 'conjunction'>>(
  filters: readonly T[],
  expression: (filter: T) => string,
  other?: (filter: T) => string | null,
): string {
  let text = '';
  let previous: LogicalOperator | null = null;

  filters.forEach((filter, index) => {
    const current = comparison(expression(filter), filter, other?.(filter));

    if (index === 0) {
      text = current;
      return;
    }

    const conjunction = filter.conjunction ?? 'AND';

    if (previous !== null && previous !== conjunction) {
      text = `(${text})`;
    }

    text = `${text}\n  ${conjunction} ${current}`;
    previous = conjunction;
  });

  return text;
}

/**
 * Escribe el SELECT.
 *
 * Limitar filas es lo que más cambia entre motores y lo que peor se recuerda:
 * `LIMIT` va al final en PostgreSQL y MySQL, mientras que `TOP` en SQL Server y
 * `FIRST` en Informix van justo después del SELECT.
 */
/**
 * El `INSERT` de una tabla cuyas columnas las rellena todas el motor.
 *
 * Cada motor lo dice a su manera y **Informix no tiene ninguna**: lo suyo es
 * nombrar la columna serial y darle un cero. Lo que escriba cada uno está en su
 * dialecto; aquí solo se le pasa la única columna que puede necesitar.
 */
function allGeneratedInsert(
  engine: DatabaseEngine,
  schema: string | undefined,
  table: string,
  columns: readonly KnownColumn[],
): string {
  const serial = columns[0];

  return SQL_DIALECTS[engine].allGeneratedInsert(
    qualify(engine, schema, table),
    serial ? quote(engine, serial.name) : null,
  );
}

export function buildSelect(engine: DatabaseEngine, spec: SelectSpec): string {
  const alias = spec.alias ?? ((spec.joins?.length ?? 0) > 0 ? 't0' : undefined);
  const selected = spec.columns.map((column) => columnReference(engine, column, alias));
  selected.push(
    ...(spec.dateGroups ?? []).map((group) => {
      const expression = dateGroupExpression(engine, group, alias);
      return group.alias ? `${expression} AS ${quote(engine, group.alias)}` : expression;
    }),
  );
  selected.push(
    ...(spec.aggregates ?? []).map((aggregate) => {
      const expression = aggregateExpression(engine, aggregate, alias);
      return aggregate.alias ? `${expression} AS ${quote(engine, aggregate.alias)}` : expression;
    }),
  );
  const columnas =
    selected.length > 0 ? selected.join(', ') : alias ? `${quote(engine, alias)}.*` : '*';

  const dialect = SQL_DIALECTS[engine];
  const leading = dialect.leadingLimit;
  const top = spec.limit && leading ? leading(spec.limit) : '';
  const distinct = spec.distinct ? 'DISTINCT ' : '';
  const prefix = dialect.distinctBeforeLeadingLimit ? `${distinct}${top}` : `${top}${distinct}`;

  const from = alias
    ? `${qualify(engine, spec.schema, spec.table)} AS ${quote(engine, alias)}`
    : qualify(engine, spec.schema, spec.table);
  const lineas = [`SELECT ${prefix}${columnas}`, `FROM ${from}`];

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

  /** Una columna de la tabla principal, con su alias si hay cruces. */
  const reference = (column: string) =>
    alias ? `${quote(engine, alias)}.${quote(engine, column)}` : quote(engine, column);

  if (spec.filters.length > 0) {
    lineas.push(
      `WHERE ${conditions(
        spec.filters,
        (filter) => reference(filter.column),
        (filter) => (filter.compareColumn ? reference(filter.compareColumn) : null),
      )}`,
    );
  }

  const groups = [
    ...(spec.groupBy ?? []).map((column) => columnReference(engine, column, alias)),
    ...(spec.dateGroups ?? []).map((group) => dateGroupExpression(engine, group, alias)),
  ];
  if (groups.length > 0) {
    lineas.push(`GROUP BY ${groups.join(', ')}`);
  }

  if (spec.having && spec.having.length > 0) {
    lineas.push(
      `HAVING ${conditions(spec.having, (filter) =>
        aggregateExpression(engine, filter.aggregate, alias),
      )}`,
    );
  }

  const orders =
    spec.orders ??
    (spec.orderBy ? [{ expression: spec.orderBy, descending: spec.descending }] : []);
  if (orders.length > 0) {
    const orderExpression = (order: SelectOrder) => {
      const expression = order.expression;
      const value =
        typeof expression === 'string'
          ? columnReference(engine, expression, alias)
          : 'function' in expression
            ? aggregateExpression(engine, expression, alias)
            : 'period' in expression
              ? dateGroupExpression(engine, expression, alias)
              : columnReference(engine, expression, alias);
      return `${value}${order.descending ? ' DESC' : ''}`;
    };
    lineas.push(`ORDER BY ${orders.map(orderExpression).join(', ')}`);
  }

  // Solo los motores que no lo pusieron ya delante lo llevan al final, y no
  // todos lo escriben `LIMIT`: Oracle usa el `FETCH FIRST` del estándar.
  if (spec.limit && !leading) {
    const trailing = SQL_DIALECTS[engine].trailingLimit;

    lineas.push(trailing ? trailing(spec.limit) : `LIMIT ${spec.limit}`);
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
    return allGeneratedInsert(engine, spec.schema, spec.table, spec.columns);
  }

  return `INSERT INTO ${qualify(engine, spec.schema, spec.table)} (${nombres})\nVALUES (${huecos});\n`;
}

/** INSERT rellenado desde el compositor, conservando NULL y DEFAULT como estados distintos. */
export function buildInsertValues(engine: DatabaseEngine, spec: InsertValuesSpec): string {
  if (spec.values.length === 0) {
    return allGeneratedInsert(engine, spec.schema, spec.table, []);
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
    return `-- ${translate('sql.writer.noEditableColumns')}\n`;
  }

  const asignaciones = resto
    .map((column) => `  ${quote(engine, column.name)} = /* ${column.dataType} */`)
    .join(',\n');

  const filtro =
    clave.length > 0
      ? clave
          .map((column) => `${quote(engine, column.name)} = /* ${column.dataType} */`)
          .join(' AND ')
      : `/* ${translate('sql.writer.noPrimaryKey')} */`;

  return `UPDATE ${qualify(engine, spec.schema, spec.table)}\nSET\n${asignaciones}\nWHERE ${filtro};\n`;
}

/** UPDATE rellenado; nunca produce una sentencia ejecutable sin cláusula WHERE. */
export function buildUpdateValues(engine: DatabaseEngine, spec: UpdateValuesSpec): string {
  if (spec.assignments.length === 0) {
    return `-- ${translate('sql.writer.chooseColumn')}\n`;
  }

  const assignments = spec.assignments
    .map((entry) => `  ${quote(engine, entry.column)} = ${writeValue(entry)}`)
    .join(',\n');
  const filters = spec.filters.filter((filter) => filter.column.length > 0);
  const where =
    filters.length > 0
      ? filters.map((filter) => condition(engine, filter)).join('\n  AND ')
      : `/* ${translate('sql.writer.requiredCondition')} */`;

  return `UPDATE ${qualify(engine, spec.schema, spec.table)}\nSET\n${assignments}\nWHERE ${where};\n`;
}

/**
 * `DELETE` compuesto desde el formulario, con su filtro obligatorio.
 *
 * Sin filtros no devuelve un DELETE ejecutable: deja el hueco a la vista, igual
 * que el `UPDATE`. Aquí la razón pesa más, porque un `DELETE` sin `WHERE` vacía
 * la tabla y no hay valor anterior al que volver.
 */
export function buildDeleteValues(
  engine: DatabaseEngine,
  spec: { schema?: string; table: string; filters: readonly QueryFilter[] },
): string {
  const filters = spec.filters.filter((filter) => filter.column.length > 0);
  const where =
    filters.length > 0
      ? filters.map((filter) => condition(engine, filter)).join('\n  AND ')
      : `/* ${translate('sql.writer.requiredCondition')} */`;

  return `DELETE FROM ${qualify(engine, spec.schema, spec.table)}\nWHERE ${where};\n`;
}

/**
 * El recuento de lo que ese mismo `DELETE` se llevaría.
 *
 * Se ejecuta antes de borrar y con **el mismo filtro**: el error caro no suele
 * ser olvidar el `WHERE`, sino escribir uno que coincide con más filas de las
 * que uno cree.
 */
export function buildDeleteCount(
  engine: DatabaseEngine,
  spec: { schema?: string; table: string; filters: readonly QueryFilter[] },
): string {
  const filters = spec.filters.filter((filter) => filter.column.length > 0);

  if (filters.length === 0) {
    return '';
  }

  const where = filters.map((filter) => condition(engine, filter)).join('\n  AND ');

  return `SELECT COUNT(*) AS filas FROM ${qualify(engine, spec.schema, spec.table)}\nWHERE ${where};`;
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

/** Un parámetro con el valor que se le ha dado en el formulario. */
export interface RoutineArgument {
  readonly name: string;
  readonly dataType: string;
  readonly direction: 'input' | 'output' | 'inputOutput';
  readonly value: SqlInputValue;
}

export interface CallSpec {
  readonly schema?: string;
  readonly routine: string;
  readonly parameters: readonly RoutineArgument[];
}

/**
 * Escribe la llamada a un procedimiento.
 *
 * Los cuatro motores la escriben distinta, y las salidas cambian la forma
 * entera: no basta con nombrar el parámetro, hay que **declarar una variable
 * antes y leerla después**, así que lo que sale no es una instrucción sino un
 * pequeño guion.
 *
 * Informix es la excepción declarada: fuera de SPL no hay dónde recoger un
 * `OUT`, así que la llamada sale igual pero avisando por escrito en lugar de
 * generar algo que el motor rechazaría.
 */
export function buildCall(engine: DatabaseEngine, spec: CallSpec): string {
  const target = qualify(engine, spec.schema, spec.routine);
  const salidas = spec.parameters.filter((parameter) => parameter.direction !== 'input');

  // Sin rama `default`: un motor nuevo tiene que decir cómo llama a un
  // procedimiento en lugar de heredar en silencio la forma de Informix.
  switch (engine) {
    case 'sqlserver':
      return buildSqlServerCall(target, spec.parameters, salidas);
    case 'mysql':
      return buildMySqlCall(engine, target, spec.parameters, salidas);
    case 'postgresql':
      return buildPostgreSqlCall(spec.parameters, target);
    case 'informix':
    case 'informixsqli':
      return buildInformixCall(target, spec.parameters, salidas);
    case 'oracle':
      return buildOracleCall(target, spec.parameters, salidas);
    case 'sqlite':
      // No hay procedimientos que llamar, y no es que la base no tenga ninguno:
      // el motor no sabe lo que son. El explorador ni siquiera enseña la carpeta,
      // así que aquí no se llega salvo por un guion escrito a mano.
      return `-- ${translate('sql.writer.sqliteNoProcedures')}\n`;
  }
}

/**
 * En Oracle una llamada con salidas es un bloque PL/SQL.
 *
 * No hay una instrucción suelta que recoja un `OUT`: hace falta declarar las
 * variables en un `DECLARE`, llamar dentro del `BEGIN` y enseñarlas después.
 * Enseñarlas es `DBMS_OUTPUT`, que es justo lo que Druse recoge como mensajes
 * del servidor, así que el guion sale completo y se ejecuta tal cual.
 *
 * Sin salidas basta con `BEGIN … END;`, que es como se llama a un procedimiento
 * aquí: el `EXEC` que todo el mundo escribe es de SQL*Plus y no viaja al
 * servidor.
 */
function buildOracleCall(
  target: string,
  parameters: readonly RoutineArgument[],
  salidas: readonly RoutineArgument[],
): string {
  const argumentos = parameters
    .map((parameter) =>
      parameter.direction === 'input' ? writeArgument(parameter) : oracleVariable(parameter),
    )
    .join(', ');

  const llamada = `  ${target}(${argumentos});`;

  if (salidas.length === 0) {
    return `BEGIN\n${llamada}\nEND;\n`;
  }

  const lineas = ['DECLARE'];

  for (const salida of salidas) {
    lineas.push(`  ${oracleVariable(salida)} ${salida.dataType};`);
  }

  lineas.push('BEGIN', llamada);

  for (const salida of salidas) {
    lineas.push(`  DBMS_OUTPUT.PUT_LINE('${salida.name} = ' || ${oracleVariable(salida)});`);
  }

  lineas.push('END;');

  return `${lineas.join('\n')}\n`;
}

/**
 * SQL Server nombra los parámetros con `\n` y marca las salidas con `OUTPUT`.
 *
 * La variable que las recoge se llama distinto del parámetro —`@out_algo`— a
 * propósito: `@salida = @salida OUTPUT` es válido pero se lee fatal, y en un
 * guion que el usuario va a revisar antes de ejecutar eso importa.
 */
function buildSqlServerCall(
  target: string,
  parameters: readonly RoutineArgument[],
  salidas: readonly RoutineArgument[],
): string {
  const lineas: string[] = [];

  for (const salida of salidas) {
    lineas.push(`DECLARE ${outputVariable(salida)} ${salida.dataType};`);
  }

  const argumentos = parameters.map((parameter) =>
    parameter.direction === 'input'
      ? `${withAt(parameter.name)} = ${writeArgument(parameter)}`
      : `${withAt(parameter.name)} = ${outputVariable(parameter)} OUTPUT`,
  );

  const llamada =
    argumentos.length === 0
      ? `EXEC ${target};`
      : `EXEC ${target}\n    ${argumentos.join(',\n    ')};`;

  lineas.push(llamada);

  if (salidas.length > 0) {
    const columnas = salidas
      .map((salida) => `${outputVariable(salida)} AS [${bare(salida.name)}]`)
      .join(', ');

    lineas.push(`SELECT ${columnas};`);
  }

  return lineas.join('\n') + '\n';
}

/** En MySQL las salidas van en variables de sesión, que se leen después. */
function buildMySqlCall(
  engine: DatabaseEngine,
  target: string,
  parameters: readonly RoutineArgument[],
  salidas: readonly RoutineArgument[],
): string {
  const lineas = salidas.map((salida) => `SET ${sessionVariable(salida)} = NULL;`);

  const argumentos = parameters.map((parameter) =>
    parameter.direction === 'input' ? writeArgument(parameter) : sessionVariable(parameter),
  );

  lineas.push(`CALL ${target}(${argumentos.join(', ')});`);

  if (salidas.length > 0) {
    const columnas = salidas
      .map((salida) => `${sessionVariable(salida)} AS ${quote(engine, bare(salida.name))}`)
      .join(', ');

    lineas.push(`SELECT ${columnas};`);
  }

  return lineas.join('\n') + '\n';
}

/**
 * PostgreSQL devuelve las salidas como el resultado del propio `CALL`, así que
 * no hay nada que declarar ni que leer después: el hueco de una salida se pasa
 * como `NULL` y el motor lo rellena en la fila que devuelve.
 */
function buildPostgreSqlCall(parameters: readonly RoutineArgument[], target: string): string {
  const argumentos = parameters.map((parameter) =>
    parameter.direction === 'input' ? writeArgument(parameter) : 'NULL',
  );

  return `CALL ${target}(${argumentos.join(', ')});\n`;
}

/**
 * Informix ejecuta con `EXECUTE PROCEDURE`, y **no tiene dónde recoger un `OUT`
 * fuera de un procedimiento**: el `INTO` que haría falta solo existe dentro de
 * SPL. Se escribe la llamada y se dice por qué faltan las salidas, en lugar de
 * generar un `INTO` que el motor rechazaría.
 */
function buildInformixCall(
  target: string,
  parameters: readonly RoutineArgument[],
  salidas: readonly RoutineArgument[],
): string {
  const argumentos = parameters
    .filter((parameter) => parameter.direction === 'input')
    .map((parameter) => writeArgument(parameter));

  const llamada = `EXECUTE PROCEDURE ${target}(${argumentos.join(', ')});\n`;

  if (salidas.length === 0) {
    return llamada;
  }

  const nombres = salidas.map((salida) => salida.name).join(', ');

  return `-- ${translate('sql.writer.informixOutputs', { names: nombres })}\n` + llamada;
}

function writeArgument(parameter: RoutineArgument): string {
  return writeValue({
    column: parameter.name,
    dataType: parameter.dataType,
    value: parameter.value,
  });
}

/** SQL Server nombra sus parámetros con `@`, y el catálogo ya lo devuelve así. */
function withAt(name: string): string {
  return name.startsWith('@') ? name : `@${name}`;
}

function bare(name: string): string {
  return name.startsWith('@') ? name.slice(1) : name;
}

function outputVariable(parameter: RoutineArgument): string {
  return `@out_${bare(parameter.name)}`;
}

/**
 * La variable donde Oracle recoge una salida.
 *
 * Sin `@`, que aquí no es parte de un nombre sino el separador de una base
 * remota: `algo@enlace` apunta a otro servidor. El prefijo `v_` es la convención
 * de PL/SQL y evita chocar con el nombre del propio parámetro, que dentro del
 * bloque también existe.
 */
function oracleVariable(parameter: RoutineArgument): string {
  return `v_${bare(parameter.name)}`;
}

function sessionVariable(parameter: RoutineArgument): string {
  return `@${bare(parameter.name)}_salida`;
}

function writeValue(entry: ColumnWrite): string {
  switch (entry.value.kind) {
    case 'null':
      return 'NULL';
    case 'default':
      return 'DEFAULT';
    case 'value':
      return entry.value.text === null
        ? `/* ${translate('sql.writer.requiredTyped', { type: entry.dataType })} */`
        : literal(entry.value.text);
  }
}
