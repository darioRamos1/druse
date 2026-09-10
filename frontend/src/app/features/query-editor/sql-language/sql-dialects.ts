import { DatabaseEngine } from '../../../shared/models/workspace';

export type DatePeriod = 'day' | 'month' | 'quarter' | 'year';

/**
 * Lo que cambia al escribir SQL para un motor concreto.
 *
 * Aquí están las cuatro cosas que el generador visual de consultas no puede
 * escribir igual para todos: cómo se cita un nombre, dónde y cómo se limitan las
 * filas, cómo se trunca una fecha y cómo se inserta una fila que el motor
 * rellena entera.
 *
 * **Está declarado como registro exhaustivo a propósito.** Antes eran cuatro
 * `switch` repartidos por el generador, cada uno con su rama `default` con la
 * sintaxis de PostgreSQL, y el resultado fue que Informix por SQLI —un motor que
 * lleva meses en producción— recibía `LIMIT` al final, que su servidor rechaza,
 * y un `DEFAULT VALUES` que no admite: nadie se acordó de añadirlo a las cuatro
 * ramas, y ninguna de las cuatro se quejó. Con una tabla exhaustiva el motor que
 * falte **no compila**, que es la única forma de que eso no vuelva a pasar.
 *
 * Esto no vive en el servidor y no viaja por la API. Lo que se escribe aquí es
 * SQL, y mandar plantillas de texto para que las rellene el navegador sería
 * partir en dos el sitio donde se escribe. El servidor tiene su propia mitad —el
 * diseñador de cada proveedor— por el mismo motivo.
 */
export interface SqlDialect {
  /**
   * Cita un identificador.
   *
   * Sin comillas, una columna que se llame `order` o `group` rompe la consulta,
   * y en PostgreSQL un nombre con mayúsculas deja de encontrarse.
   */
  readonly quote: (identifier: string) => string;

  /**
   * Lo que va **entre `SELECT` y las columnas** para limitar filas, o `null` en
   * los motores que lo escriben al final con `LIMIT`.
   *
   * El `null` no es un hueco: es lo que decide que haya que añadirlo al final.
   * Así la regla vive en un solo sitio y no puede quedar a medias —un motor que
   * lo ponga delante no arrastra además un `LIMIT` que sobra—.
   */
  readonly leadingLimit: ((limit: number) => string) | null;

  /**
   * Lo que va **al final** para limitar filas, en los motores que no lo ponen
   * delante.
   *
   * Casi todos escriben `LIMIT n`, y por eso es lo que se supone cuando no se
   * dice nada. Oracle usa el `FETCH FIRST n ROWS ONLY` del estándar, que ocupa
   * el mismo sitio y se escribe distinto.
   */
  readonly trailingLimit?: (limit: number) => string;

  /** Trunca una fecha al principio de su día, mes, trimestre o año. */
  readonly dateTrunc: (column: string, period: DatePeriod) => string;

  /**
   * El `INSERT` de una tabla cuyas columnas las rellena todas el motor.
   *
   * `serial` es la primera columna, ya citada, o `null` si la tabla no tiene
   * ninguna. Solo Informix la necesita: no admite `DEFAULT VALUES` ni la lista
   * vacía de MySQL, y su forma idiomática es nombrar la columna serial y darle
   * un cero, que es la señal para que asigne el siguiente valor.
   */
  readonly allGeneratedInsert: (table: string, serial: string | null) => string;
}

/** PostgreSQL, y la base de la que parten los demás: comillas dobles y `LIMIT`. */
const doubleQuote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

const POSTGRESQL: SqlDialect = {
  quote: doubleQuote,
  leadingLimit: null,
  dateTrunc: (column, period) => `DATE_TRUNC('${period}', ${column})`,
  allGeneratedInsert: (table) => `INSERT INTO ${table}\nDEFAULT VALUES;\n`,
};

const SQLSERVER: SqlDialect = {
  quote: (identifier) => `[${identifier.replace(/]/g, ']]')}]`,
  leadingLimit: (limit) => `TOP ${limit} `,
  dateTrunc: (column, period) => {
    switch (period) {
      case 'day':
        return `CONVERT(date, ${column})`;
      case 'month':
        return `DATEFROMPARTS(YEAR(${column}), MONTH(${column}), 1)`;
      case 'quarter':
        return `DATEFROMPARTS(YEAR(${column}), ((DATEPART(quarter, ${column}) - 1) * 3) + 1, 1)`;
      case 'year':
        return `DATEFROMPARTS(YEAR(${column}), 1, 1)`;
    }
  },
  allGeneratedInsert: (table) => `INSERT INTO ${table}\nDEFAULT VALUES;\n`,
};

const MYSQL: SqlDialect = {
  quote: (identifier) => `\`${identifier.replace(/`/g, '``')}\``,
  leadingLimit: null,
  dateTrunc: (column, period) => {
    switch (period) {
      case 'day':
        return `DATE(${column})`;
      case 'month':
        return `DATE_ADD(MAKEDATE(YEAR(${column}), 1), INTERVAL (MONTH(${column}) - 1) MONTH)`;
      case 'quarter':
        return `DATE_ADD(MAKEDATE(YEAR(${column}), 1), INTERVAL ((QUARTER(${column}) - 1) * 3) MONTH)`;
      case 'year':
        return `MAKEDATE(YEAR(${column}), 1)`;
    }
  },
  // La lista vacía es la única forma que admite: no tiene `DEFAULT VALUES`.
  allGeneratedInsert: (table) => `INSERT INTO ${table} ()\nVALUES ();\n`,
};

/**
 * Informix, el mismo para sus dos transportes.
 *
 * DRDA y SQLI cambian por dónde se entra; el SQL es el del mismo motor. Que
 * fueran dos entradas de esta tabla apuntando al mismo objeto es justo lo que
 * faltaba antes: SQLI no aparecía en ninguna de las cuatro ramas.
 */
const INFORMIX: SqlDialect = {
  quote: doubleQuote,
  leadingLimit: (limit) => `FIRST ${limit} `,
  dateTrunc: (column, period) => {
    switch (period) {
      case 'day':
        return `DATE(${column})`;
      case 'month':
        return `MDY(MONTH(${column}), 1, YEAR(${column}))`;
      case 'quarter':
        return `MDY(((QUARTER(${column}) - 1) * 3) + 1, 1, YEAR(${column}))`;
      case 'year':
        return `MDY(1, 1, YEAR(${column}))`;
    }
  },
  allGeneratedInsert: (table, serial) =>
    serial
      ? `INSERT INTO ${table} (${serial})\nVALUES (0);\n`
      : `INSERT INTO ${table}\nVALUES ();\n`,
};

/**
 * Oracle, que es el que menos se parece a los demás.
 *
 * No tiene `LIMIT` ni `TOP`: usa el `OFFSET … FETCH` del estándar, que va al
 * final como el primero pero se escribe distinto. Y **no admite `DEFAULT
 * VALUES`**: para insertar una fila que el motor rellena entera hay que nombrar
 * una columna y darle su propio valor por omisión.
 *
 * Los nombres simples se escriben en mayúsculas y sin comillas, que es como los
 * guarda el motor. Citarlos convertiría el `clientes` que el usuario ve en el
 * árbol en una tabla distinta; el porqué largo está en el proveedor, en
 * `OracleIdentifier`.
 */
const ORACLE: SqlDialect = {
  quote: (identifier) =>
    /^[A-Za-z][A-Za-z0-9_$#]*$/.test(identifier)
      ? identifier.toUpperCase()
      : '"' + identifier.replace(/"/g, '""') + '"',
  leadingLimit: null,
  trailingLimit: (limit) => `FETCH FIRST ${limit} ROWS ONLY`,
  dateTrunc: (column, period) => {
    switch (period) {
      case 'day':
        return `TRUNC(${column})`;
      case 'month':
        return `TRUNC(${column}, 'MM')`;
      case 'quarter':
        return `TRUNC(${column}, 'Q')`;
      case 'year':
        return `TRUNC(${column}, 'YYYY')`;
    }
  },
  allGeneratedInsert: (table, serial) =>
    serial
      ? `INSERT INTO ${table} (${serial})\nVALUES (DEFAULT);\n`
      : `INSERT INTO ${table}\nVALUES ();\n`,
};

/**
 * SQLite, que se parece a PostgreSQL más que a nadie.
 *
 * Comillas dobles, `LIMIT` al final y `DEFAULT VALUES` para una fila que el
 * motor rellena entera: las tres cosas iguales. Lo único suyo es cómo trunca una
 * fecha, porque **no tiene tipo de fecha**: lo que hay es texto ISO, y `strftime`
 * recorta ese texto por donde toque.
 */
const SQLITE: SqlDialect = {
  quote: doubleQuote,
  leadingLimit: null,
  dateTrunc: (column, period) => {
    switch (period) {
      case 'day':
        return `date(${column})`;
      case 'month':
        return `date(${column}, 'start of month')`;
      case 'quarter':
        // No hay «principio de trimestre»: se va al principio del año y se
        // suman los meses que correspondan al trimestre de la fecha.
        return (
          `date(${column}, 'start of year', ` +
          `'+' || ((CAST(strftime('%m', ${column}) AS INTEGER) - 1) / 3) * 3 || ' months')`
        );
      case 'year':
        return `date(${column}, 'start of year')`;
    }
  },
  allGeneratedInsert: (table) => `INSERT INTO ${table}\nDEFAULT VALUES;\n`,
};

export const SQL_DIALECTS: Readonly<Record<DatabaseEngine, SqlDialect>> = {
  postgresql: POSTGRESQL,
  sqlserver: SQLSERVER,
  mysql: MYSQL,
  informix: INFORMIX,
  informixsqli: INFORMIX,
  oracle: ORACLE,
  sqlite: SQLITE,
};
