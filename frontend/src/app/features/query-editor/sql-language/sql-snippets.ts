import { I18nService } from '../../../core/i18n/i18n.service';
import { DatabaseEngine } from '../../../shared/models/workspace';

/**
 * Las palabras de los huecos, en el idioma elegido.
 *
 * Van juntas y no una a una en cada plantilla: son las mismas doce en todas, y
 * repetir la clave en cada cuerpo haría que un cambio se olvidara en la mitad.
 */
interface Placeholders {
  readonly table: string;
  readonly column: string;
  readonly columns: string;
  readonly condition: string;
  readonly value: string;
  readonly values: string;
  readonly valueId: string;
  readonly alias: string;
  readonly source: string;
  readonly target: string;
  readonly other: string;
  readonly otherTable: string;
  readonly name: string;
  readonly total: string;
  readonly times: string;
}

function placeholders(i18n: I18nService): Placeholders {
  return {
    table: i18n.t('sql.placeholder.table'),
    column: i18n.t('sql.placeholder.column'),
    columns: i18n.t('sql.placeholder.columns'),
    condition: i18n.t('sql.placeholder.condition'),
    value: i18n.t('sql.placeholder.value'),
    values: i18n.t('sql.placeholder.values'),
    valueId: i18n.t('sql.placeholder.valueId'),
    alias: i18n.t('sql.placeholder.alias'),
    source: i18n.t('sql.placeholder.source'),
    target: i18n.t('sql.placeholder.target'),
    other: i18n.t('sql.placeholder.other'),
    otherTable: i18n.t('sql.placeholder.otherTable'),
    name: i18n.t('sql.placeholder.name'),
    total: i18n.t('sql.placeholder.total'),
    times: i18n.t('sql.placeholder.times'),
  };
}

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
const common = (h: Placeholders, i18n: I18nService): readonly SqlSnippet[] => [
  {
    trigger: 'sel',
    description: 'SELECT … FROM … WHERE',
    body: `SELECT \${1:*}\nFROM \${2:${h.table}}\nWHERE \${3:${h.condition}}`,
  },
  {
    trigger: 'join',
    description: 'JOIN … ON',
    body: `JOIN \${1:${h.table}} \${2:${h.alias}} ON \${2:${h.alias}}.\${3:id} = \${4:${h.source}}.\${5:id}`,
  },
  {
    trigger: 'ins',
    description: 'INSERT INTO … VALUES',
    body: `INSERT INTO \${1:${h.table}} (\${2:${h.columns}})\nVALUES (\${3:${h.values}})`,
  },
  {
    // El WHERE va en la plantilla y no como añadido opcional: un UPDATE sin
    // filtro es justo lo que Druse te obliga a confirmar antes de ejecutar.
    trigger: 'upd',
    description: 'UPDATE … SET … WHERE',
    body: `UPDATE \${1:${h.table}}\nSET \${2:${h.column}} = \${3:${h.value}}\nWHERE \${4:${h.condition}}`,
  },
  {
    trigger: 'del',
    description: 'DELETE … WHERE',
    body: `DELETE FROM \${1:${h.table}}\nWHERE \${2:${h.condition}}`,
  },
  {
    trigger: 'cte',
    description: 'WITH … AS (…)',
    body: `WITH \${1:${h.name}} AS (\n    \${2:SELECT 1}\n)\nSELECT *\nFROM \${1:${h.name}}`,
  },
  {
    trigger: 'group',
    description: i18n.t('sql.snippet.group'),
    body: `SELECT \${1:${h.column}}, COUNT(*) AS ${h.total}\nFROM \${2:${h.table}}\nGROUP BY \${1:${h.column}}\nORDER BY ${h.total} DESC`,
  },
  {
    // Lo primero que se busca antes de crear una clave única, y la consulta que
    // nadie recuerda entera: el HAVING es lo que se olvida.
    trigger: 'dup',
    description: i18n.t('sql.snippet.dup'),
    body: `SELECT \${1:${h.column}}, COUNT(*) AS ${h.times}\nFROM \${2:${h.table}}\nGROUP BY \${1:${h.column}}\nHAVING COUNT(*) > 1\nORDER BY ${h.times} DESC`,
  },
  {
    trigger: 'case',
    description: 'CASE WHEN … THEN … ELSE … END',
    body: `CASE\n    WHEN \${1:${h.condition}} THEN \${2:${h.value}}\n    ELSE \${3:${h.other}}\nEND`,
  },
  {
    trigger: 'exists',
    description: i18n.t('sql.snippet.exists'),
    body: `SELECT *\nFROM \${1:${h.table}} \${2:t}\nWHERE EXISTS (\n    SELECT 1\n    FROM \${3:${h.otherTable}} \${4:o}\n    WHERE \${4:o}.\${5:id} = \${2:t}.\${6:id}\n)`,
  },
];

/**
 * Lo que cambia entre motores.
 *
 * Limitar filas es la diferencia que más se nota al cambiar de servidor, y
 * escribirla al revés es un error de sintaxis inmediato.
 */
/** Paginar al final de la consulta: PostgreSQL, MySQL y SQLite lo escriben igual. */
const limitOffsetPage = (h: Placeholders) => ({
  trigger: 'page',
  body: `SELECT \${1:*}\nFROM \${2:${h.table}}\nORDER BY \${3:${h.column}}\nLIMIT \${4:50} OFFSET \${5:0}`,
});

/**
 * Insertar o actualizar si ya existe. `EXCLUDED` es la fila que se intentaba
 * insertar, que es la parte que nadie recuerda.
 */
const onConflictUpsert = (h: Placeholders) => ({
  trigger: 'upsert',
  body: `INSERT INTO \${1:${h.table}} (\${2:id}, \${3:${h.column}})\nVALUES (\${4:${h.valueId}}, \${5:${h.value}})\nON CONFLICT (\${2:id}) DO UPDATE SET \${3:${h.column}} = EXCLUDED.\${3:${h.column}}`,
});

/**
 * Fragmentos de Informix, compartidos por sus dos motores.
 */
const informixSnippets = (h: Placeholders, i18n: I18nService): readonly SqlSnippet[] => [
  {
    trigger: 'upsert',
    description: i18n.t('sql.snippet.upsertMerge', { engine: 'Informix' }),
    body: `MERGE INTO \${1:${h.target}} d\nUSING \${2:${h.source}} o\n    ON d.\${3:id} = o.\${3:id}\nWHEN MATCHED THEN\n    UPDATE SET d.\${4:${h.column}} = o.\${4:${h.column}}\nWHEN NOT MATCHED THEN\n    INSERT (\${3:id}, \${4:${h.column}}) VALUES (o.\${3:id}, o.\${4:${h.column}})`,
  },
  {
    trigger: 'first',
    description: i18n.t('sql.snippet.limit', { engine: 'Informix' }),
    body: `SELECT FIRST \${1:100} \${2:*}\nFROM \${3:${h.table}}\nORDER BY \${4:${h.column}}`,
  },
  {
    // El equivalente de OFFSET: en Informix `SKIP` va delante y siempre
    // acompañado de `FIRST`, que es lo que casi nadie recuerda.
    trigger: 'skip',
    description: i18n.t('sql.snippet.skip', { engine: 'Informix' }),
    body: `SELECT SKIP \${1:0} FIRST \${2:100} \${3:*}\nFROM \${4:${h.table}}\nORDER BY \${5:${h.column}}`,
  },
];

const byEngine = (
  h: Placeholders,
  i18n: I18nService,
): Readonly<Record<DatabaseEngine, readonly SqlSnippet[]>> => ({
  postgresql: [
    {
      trigger: 'limit',
      description: i18n.t('sql.snippet.limit', { engine: 'PostgreSQL' }),
      body: `SELECT \${1:*}\nFROM \${2:${h.table}}\nORDER BY \${3:${h.column}}\nLIMIT \${4:100}`,
    },
    { ...limitOffsetPage(h), description: i18n.t('sql.snippet.page', { engine: 'PostgreSQL' }) },
    { ...onConflictUpsert(h), description: i18n.t('sql.snippet.upsert', { engine: 'PostgreSQL' }) },
  ],
  mysql: [
    {
      trigger: 'limit',
      description: i18n.t('sql.snippet.limit', { engine: 'MySQL' }),
      body: `SELECT \${1:*}\nFROM \${2:${h.table}}\nORDER BY \${3:${h.column}}\nLIMIT \${4:100}`,
    },
    { ...limitOffsetPage(h), description: i18n.t('sql.snippet.page', { engine: 'MySQL' }) },
    {
      trigger: 'upsert',
      description: i18n.t('sql.snippet.upsert', { engine: 'MySQL' }),
      body: `INSERT INTO \${1:${h.table}} (\${2:id}, \${3:${h.column}})\nVALUES (\${4:${h.valueId}}, \${5:${h.value}})\nON DUPLICATE KEY UPDATE \${3:${h.column}} = VALUES(\${3:${h.column}})`,
    },
  ],
  sqlserver: [
    {
      trigger: 'top',
      description: i18n.t('sql.snippet.limit', { engine: 'SQL Server' }),
      body: `SELECT TOP \${1:100} \${2:*}\nFROM \${3:${h.table}}\nORDER BY \${4:${h.column}}`,
    },
    {
      // Sin ORDER BY, OFFSET es un error de sintaxis en SQL Server.
      trigger: 'page',
      description: i18n.t('sql.snippet.page', { engine: 'SQL Server' }),
      body: `SELECT \${1:*}\nFROM \${2:${h.table}}\nORDER BY \${3:${h.column}}\nOFFSET \${4:0} ROWS FETCH NEXT \${5:50} ROWS ONLY`,
    },
    {
      // El punto y coma final no es opcional: SQL Server rechaza un MERGE sin él.
      trigger: 'upsert',
      description: i18n.t('sql.snippet.upsertMerge', { engine: 'SQL Server' }),
      body: `MERGE INTO \${1:${h.target}} AS d\nUSING \${2:${h.source}} AS o\n    ON d.\${3:id} = o.\${3:id}\nWHEN MATCHED THEN\n    UPDATE SET d.\${4:${h.column}} = o.\${4:${h.column}}\nWHEN NOT MATCHED THEN\n    INSERT (\${3:id}, \${4:${h.column}}) VALUES (o.\${3:id}, o.\${4:${h.column}});`,
    },
  ],
  informix: informixSnippets(h, i18n),
  informixsqli: informixSnippets(h, i18n),
  oracle: [
    {
      trigger: 'fetch',
      description: i18n.t('sql.snippet.limit', { engine: 'Oracle' }),
      body: `SELECT \${1:*}\nFROM \${2:${h.table}}\nORDER BY \${3:${h.column}}\nFETCH FIRST \${4:100} ROWS ONLY`,
    },
    {
      trigger: 'page',
      description: i18n.t('sql.snippet.page', { engine: 'Oracle' }),
      body: `SELECT \${1:*}\nFROM \${2:${h.table}}\nORDER BY \${3:${h.column}}\nOFFSET \${4:0} ROWS FETCH NEXT \${5:50} ROWS ONLY`,
    },
    {
      // En Oracle el alias de tabla no lleva AS, y la condición del ON va entre
      // paréntesis: las dos cosas que fallan al copiar el MERGE de SQL Server.
      trigger: 'upsert',
      description: i18n.t('sql.snippet.upsertMerge', { engine: 'Oracle' }),
      body: `MERGE INTO \${1:${h.target}} d\nUSING \${2:${h.source}} o\n    ON (d.\${3:id} = o.\${3:id})\nWHEN MATCHED THEN\n    UPDATE SET d.\${4:${h.column}} = o.\${4:${h.column}}\nWHEN NOT MATCHED THEN\n    INSERT (\${3:id}, \${4:${h.column}}) VALUES (o.\${3:id}, o.\${4:${h.column}})`,
    },
    {
      // `DUAL` es la tabla de una sola fila con la que Oracle resuelve todo lo
      // que no sale de ninguna tabla, y es lo primero que se echa en falta.
      trigger: 'dual',
      description: i18n.t('sql.snippet.dual', { engine: 'Oracle' }),
      body: 'SELECT ${1:SYSDATE} FROM DUAL',
    },
  ],
  sqlite: [
    {
      trigger: 'limit',
      description: i18n.t('sql.snippet.limit', { engine: 'SQLite' }),
      body: `SELECT \${1:*}\nFROM \${2:${h.table}}\nORDER BY \${3:${h.column}}\nLIMIT \${4:100}`,
    },
    { ...limitOffsetPage(h), description: i18n.t('sql.snippet.page', { engine: 'SQLite' }) },
    { ...onConflictUpsert(h), description: i18n.t('sql.snippet.upsert', { engine: 'SQLite' }) },
    {
      // Lo que todo el mundo busca al abrir un archivo que no conoce.
      trigger: 'tablas',
      description: i18n.t('sql.snippet.master', { engine: 'SQLite' }),
      body: "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
    },
  ],
});

/**
 * Las plantillas de un motor, en el idioma elegido.
 *
 * Los huecos —`${1:tabla}`— son parte de lo que se lee al insertarla, así que
 * salen del catálogo igual que las descripciones. El SQL no se duplica por
 * idioma: solo cambian las palabras de los huecos.
 */
export function snippetsFor(engine: DatabaseEngine, i18n: I18nService): readonly SqlSnippet[] {
  const h = placeholders(i18n);

  return [...common(h, i18n), ...byEngine(h, i18n)[engine]];
}
