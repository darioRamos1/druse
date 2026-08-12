import type { FormatOptionsWithLanguage, SqlLanguage } from 'sql-formatter';

import { DatabaseEngine } from '../../../shared/models/workspace';

/**
 * Dialecto de `sql-formatter` que corresponde a cada motor.
 *
 * Formatear con el dialecto equivocado no es inofensivo: el formateador
 * genérico no reconoce `::` de PostgreSQL ni los corchetes de SQL Server, y al
 * no entenderlos los parte por sitios que cambian el significado del SQL.
 */
const DIALECTS: Readonly<Record<DatabaseEngine, SqlLanguage>> = {
  postgresql: 'postgresql',
  sqlserver: 'transactsql',
  mysql: 'mysql',
};

const OPTIONS: Omit<FormatOptionsWithLanguage, 'language'> = {
  keywordCase: 'upper',
  dataTypeCase: 'lower',
  functionCase: 'lower',
  indentStyle: 'standard',
  logicalOperatorNewline: 'before',
  expressionWidth: 80,
  linesBetweenQueries: 1,
  tabWidth: 2,
  useTabs: false,
};

/** Resultado de formatear. */
export interface FormatResult {
  readonly sql: string;
  readonly changed: boolean;
  /** Presente cuando el SQL no se pudo analizar. */
  readonly error?: string;
}

/**
 * Módulo del formateador, cargado una sola vez y solo cuando hace falta.
 *
 * `sql-formatter` pesa unos 300 kB. Incluirlo en el paquete inicial lo
 * descargaría siempre, incluso para quien no pulse «Formatear» en su vida.
 */
let formatterModule: Promise<typeof import('sql-formatter')> | null = null;

function loadFormatter(): Promise<typeof import('sql-formatter')> {
  formatterModule ??= import('sql-formatter');

  return formatterModule;
}

/**
 * Formatea SQL respetando el dialecto del motor.
 *
 * Si el texto no se puede analizar —porque está a medio escribir, que es lo
 * normal mientras se teclea— **se devuelve intacto**. Reformatear a la fuerza un
 * SQL que el formateador no entendió sería la manera más rápida de que alguien
 * pierda trabajo.
 */
export async function formatSql(sql: string, engine: DatabaseEngine): Promise<FormatResult> {
  if (!sql.trim()) {
    return { sql, changed: false };
  }

  try {
    const { format } = await loadFormatter();
    const formatted = format(sql, { language: DIALECTS[engine], ...OPTIONS });

    return { sql: formatted, changed: formatted !== sql };
  } catch (error) {
    return {
      sql,
      changed: false,
      error: error instanceof Error ? error.message : 'No se pudo formatear la instrucción.',
    };
  }
}
