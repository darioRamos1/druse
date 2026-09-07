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
 * Están las cuatro instrucciones del día a día y el `JOIN`, que es lo que más
 * cuesta teclear bien.
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
];

/**
 * Lo que cambia entre motores.
 *
 * Limitar filas es la diferencia que más se nota al cambiar de servidor, y
 * escribirla al revés es un error de sintaxis inmediato.
 */
/**
 * Fragmentos de Informix, compartidos por sus dos motores.
 */
const INFORMIX_SNIPPETS = [
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
  ],
  mysql: [
    {
      trigger: 'limit',
      description: 'Primeras filas (MySQL)',
      body: 'SELECT ${1:*}\nFROM ${2:tabla}\nORDER BY ${3:columna}\nLIMIT ${4:100}',
    },
  ],
  sqlserver: [
    {
      trigger: 'top',
      description: 'Primeras filas (SQL Server)',
      body: 'SELECT TOP ${1:100} ${2:*}\nFROM ${3:tabla}\nORDER BY ${4:columna}',
    },
  ],
  informix: INFORMIX_SNIPPETS,
  informixsqli: INFORMIX_SNIPPETS,
};

export function snippetsFor(engine: DatabaseEngine): readonly SqlSnippet[] {
  return [...COMMON, ...BY_ENGINE[engine]];
}
