import { DatabaseEngine } from '../../../shared/models/workspace';

/** Plantilla que se inserta con huecos que se recorren con el tabulador. */
export interface SqlSnippet {
  /** Lo que se escribe para invocarla. */
  readonly trigger: string;
  readonly description: string;
  /** Texto con marcadores `${n:...}` al estilo de Monaco. */
  readonly body: string;
}

/**
 * Plantillas comunes a todos los motores.
 *
 * Son pocas a propósito: una lista larga de plantillas convierte el desplegable
 * en un catálogo que hay que leer, y entonces se escribe más rápido a mano.
 * Están las cuatro instrucciones del día a día, el `JOIN`, que es lo que más
 * cuesta teclear bien, y las consultas que se buscan a menudo y casi nadie
 * recuerda enteras: contar por grupo, buscar repetidos, `CASE` y `EXISTS`.
 */
const COMMON: readonly SqlSnippet[] = [
  {
    trigger: 'sel',
    description: 'SELECT … FROM … WHERE',
    body: 'SELECT ${1:*}\nFROM ${2:tabla}\nWHERE ${3:condición}',
  },
  {
    trigger: 'join',
    description: 'JOIN … ON',
    body: 'JOIN ${1:tabla} ${2:alias} ON ${2:alias}.${3:id} = ${4:origen}.${5:id}',
  },
  {
    trigger: 'ins',
    description: 'INSERT INTO … VALUES',
    body: 'INSERT INTO ${1:tabla} (${2:columnas})\nVALUES (${3:valores})',
  },
  {
    // El WHERE va en la plantilla y no como añadido opcional: un UPDATE sin
    // filtro es justo lo que Druse te obliga a confirmar antes de ejecutar.
    trigger: 'upd',
    description: 'UPDATE … SET … WHERE',
    body: 'UPDATE ${1:tabla}\nSET ${2:columna} = ${3:valor}\nWHERE ${4:condición}',
  },
  {
    trigger: 'del',
    description: 'DELETE … WHERE',
    body: 'DELETE FROM ${1:tabla}\nWHERE ${2:condición}',
  },
  {
    trigger: 'cte',
    description: 'WITH … AS (…)',
    body: 'WITH ${1:nombre} AS (\n    ${2:SELECT 1}\n)\nSELECT *\nFROM ${1:nombre}',
  },
  {
    trigger: 'group',
    description: 'Contar por grupo',
    body: 'SELECT ${1:columna}, COUNT(*) AS total\nFROM ${2:tabla}\nGROUP BY ${1:columna}\nORDER BY total DESC',
  },
  {
    // Lo primero que se busca antes de crear una clave única, y la consulta que
    // nadie recuerda entera: el HAVING es lo que se olvida.
    trigger: 'dup',
    description: 'Buscar filas repetidas',
    body: 'SELECT ${1:columna}, COUNT(*) AS veces\nFROM ${2:tabla}\nGROUP BY ${1:columna}\nHAVING COUNT(*) > 1\nORDER BY veces DESC',
  },
  {
    trigger: 'case',
    description: 'CASE WHEN … THEN … ELSE … END',
    body: 'CASE\n    WHEN ${1:condición} THEN ${2:valor}\n    ELSE ${3:otro}\nEND',
  },
  {
    trigger: 'exists',
    description: 'Filas que tienen algo relacionado',
    body: 'SELECT *\nFROM ${1:tabla} ${2:t}\nWHERE EXISTS (\n    SELECT 1\n    FROM ${3:otra} ${4:o}\n    WHERE ${4:o}.${5:id} = ${2:t}.${6:id}\n)',
  },
];

/**
 * Lo que cambia entre motores.
 *
 * Limitar filas es la diferencia que más se nota al cambiar de servidor, y
 * escribirla al revés es un error de sintaxis inmediato.
 */
/** Paginar al final de la consulta: PostgreSQL, MySQL y SQLite lo escriben igual. */
const LIMIT_OFFSET_PAGE = {
  trigger: 'page',
  body: 'SELECT ${1:*}\nFROM ${2:tabla}\nORDER BY ${3:columna}\nLIMIT ${4:50} OFFSET ${5:0}',
} as const;

/**
 * Insertar o actualizar si ya existe. `EXCLUDED` es la fila que se intentaba
 * insertar, que es la parte que nadie recuerda.
 */
const ON_CONFLICT_UPSERT = {
  trigger: 'upsert',
  body: 'INSERT INTO ${1:tabla} (${2:id}, ${3:columna})\nVALUES (${4:valor_id}, ${5:valor})\nON CONFLICT (${2:id}) DO UPDATE SET ${3:columna} = EXCLUDED.${3:columna}',
} as const;

/**
 * Fragmentos de Informix, compartidos por sus dos motores.
 */
const INFORMIX_SNIPPETS = [
  {
    trigger: 'upsert',
    description: 'Insertar o actualizar con MERGE (Informix)',
    body: 'MERGE INTO ${1:destino} d\nUSING ${2:origen} o\n    ON d.${3:id} = o.${3:id}\nWHEN MATCHED THEN\n    UPDATE SET d.${4:columna} = o.${4:columna}\nWHEN NOT MATCHED THEN\n    INSERT (${3:id}, ${4:columna}) VALUES (o.${3:id}, o.${4:columna})',
  },
  {
    trigger: 'first',
    description: 'Primeras filas (Informix)',
    body: 'SELECT FIRST ${1:100} ${2:*}\nFROM ${3:tabla}\nORDER BY ${4:columna}',
  },
  {
    // El equivalente de OFFSET: en Informix `SKIP` va delante y siempre
    // acompañado de `FIRST`, que es lo que casi nadie recuerda.
    trigger: 'skip',
    description: 'Saltar y tomar filas (Informix)',
    body: 'SELECT SKIP ${1:0} FIRST ${2:100} ${3:*}\nFROM ${4:tabla}\nORDER BY ${5:columna}',
  },
] as const;

const BY_ENGINE: Readonly<Record<DatabaseEngine, readonly SqlSnippet[]>> = {
  postgresql: [
    {
      trigger: 'limit',
      description: 'Primeras filas (PostgreSQL)',
      body: 'SELECT ${1:*}\nFROM ${2:tabla}\nORDER BY ${3:columna}\nLIMIT ${4:100}',
    },
    { ...LIMIT_OFFSET_PAGE, description: 'Paginar (PostgreSQL)' },
    { ...ON_CONFLICT_UPSERT, description: 'Insertar o actualizar (PostgreSQL)' },
  ],
  mysql: [
    {
      trigger: 'limit',
      description: 'Primeras filas (MySQL)',
      body: 'SELECT ${1:*}\nFROM ${2:tabla}\nORDER BY ${3:columna}\nLIMIT ${4:100}',
    },
    { ...LIMIT_OFFSET_PAGE, description: 'Paginar (MySQL)' },
    {
      trigger: 'upsert',
      description: 'Insertar o actualizar (MySQL)',
      body: 'INSERT INTO ${1:tabla} (${2:id}, ${3:columna})\nVALUES (${4:valor_id}, ${5:valor})\nON DUPLICATE KEY UPDATE ${3:columna} = VALUES(${3:columna})',
    },
  ],
  sqlserver: [
    {
      trigger: 'top',
      description: 'Primeras filas (SQL Server)',
      body: 'SELECT TOP ${1:100} ${2:*}\nFROM ${3:tabla}\nORDER BY ${4:columna}',
    },
    {
      // Sin ORDER BY, OFFSET es un error de sintaxis en SQL Server.
      trigger: 'page',
      description: 'Paginar (SQL Server)',
      body: 'SELECT ${1:*}\nFROM ${2:tabla}\nORDER BY ${3:columna}\nOFFSET ${4:0} ROWS FETCH NEXT ${5:50} ROWS ONLY',
    },
    {
      // El punto y coma final no es opcional: SQL Server rechaza un MERGE sin él.
      trigger: 'upsert',
      description: 'Insertar o actualizar con MERGE (SQL Server)',
      body: 'MERGE INTO ${1:destino} AS d\nUSING ${2:origen} AS o\n    ON d.${3:id} = o.${3:id}\nWHEN MATCHED THEN\n    UPDATE SET d.${4:columna} = o.${4:columna}\nWHEN NOT MATCHED THEN\n    INSERT (${3:id}, ${4:columna}) VALUES (o.${3:id}, o.${4:columna});',
    },
  ],
  informix: INFORMIX_SNIPPETS,
  informixsqli: INFORMIX_SNIPPETS,
  oracle: [
    {
      trigger: 'fetch',
      description: 'Primeras filas (Oracle)',
      body: 'SELECT ${1:*}\nFROM ${2:tabla}\nORDER BY ${3:columna}\nFETCH FIRST ${4:100} ROWS ONLY',
    },
    {
      trigger: 'page',
      description: 'Paginar (Oracle)',
      body: 'SELECT ${1:*}\nFROM ${2:tabla}\nORDER BY ${3:columna}\nOFFSET ${4:0} ROWS FETCH NEXT ${5:50} ROWS ONLY',
    },
    {
      // En Oracle el alias de tabla no lleva AS, y la condición del ON va entre
      // paréntesis: las dos cosas que fallan al copiar el MERGE de SQL Server.
      trigger: 'upsert',
      description: 'Insertar o actualizar con MERGE (Oracle)',
      body: 'MERGE INTO ${1:destino} d\nUSING ${2:origen} o\n    ON (d.${3:id} = o.${3:id})\nWHEN MATCHED THEN\n    UPDATE SET d.${4:columna} = o.${4:columna}\nWHEN NOT MATCHED THEN\n    INSERT (${3:id}, ${4:columna}) VALUES (o.${3:id}, o.${4:columna})',
    },
    {
      // `DUAL` es la tabla de una sola fila con la que Oracle resuelve todo lo
      // que no sale de ninguna tabla, y es lo primero que se echa en falta.
      trigger: 'dual',
      description: 'Consulta sin tabla (Oracle)',
      body: 'SELECT ${1:SYSDATE} FROM DUAL',
    },
  ],
  sqlite: [
    {
      trigger: 'limit',
      description: 'Primeras filas (SQLite)',
      body: 'SELECT ${1:*}\nFROM ${2:tabla}\nORDER BY ${3:columna}\nLIMIT ${4:100}',
    },
    { ...LIMIT_OFFSET_PAGE, description: 'Paginar (SQLite)' },
    { ...ON_CONFLICT_UPSERT, description: 'Insertar o actualizar (SQLite)' },
    {
      // Lo que todo el mundo busca al abrir un archivo que no conoce.
      trigger: 'tablas',
      description: 'Qué hay en el archivo (SQLite)',
      body: "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
    },
  ],
};

export function snippetsFor(engine: DatabaseEngine): readonly SqlSnippet[] {
  return [...COMMON, ...BY_ENGINE[engine]];
}
