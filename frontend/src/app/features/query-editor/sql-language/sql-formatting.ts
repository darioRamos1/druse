import type { FormatOptionsWithLanguage, SqlLanguage } from 'sql-formatter';

import {
  DEFAULT_FORMAT_SETTINGS,
  FormatSettings,
  clampFormatWidth,
} from '../../../core/workspace/format-settings';
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
  // `sql-formatter` no tiene dialecto de Informix. Se usa el de DB2, que es el
  // más cercano: se llega a Informix por DRDA, el protocolo de DB2, y comparten
  // buena parte de la sintaxis. El genérico partiría construcciones propias como
  // `SELECT FIRST n` por donde no debe.
  informix: 'db2',
  // El transporte no cambia el dialecto: es el mismo Informix.
  informixsqli: 'db2',
  oracle: 'plsql',
  sqlite: 'sqlite',
};

/**
 * Traduce los ajustes a lo que entiende `sql-formatter`.
 *
 * Tipos y funciones **siguen a las palabras clave** en lugar de tener su propio
 * ajuste: con `preserve`, quien pidió que no se toque nada no esperaría que sus
 * funciones cambiaran de caja igualmente.
 */
function toOptions(settings: FormatSettings): Omit<FormatOptionsWithLanguage, 'language'> {
  const secondary = settings.keywordCase === 'preserve' ? 'preserve' : 'lower';

  return {
    keywordCase: settings.keywordCase,
    dataTypeCase: secondary,
    functionCase: secondary,
    // El estilo tabular alinea a la izquierda: la palabra clave manda y los
    // valores quedan en columna. Su sangría es fija, así que el ajuste de
    // espacios o tabulaciones no le afecta.
    indentStyle: settings.style === 'tabular' ? 'tabularLeft' : 'standard',
    logicalOperatorNewline: 'before',
    expressionWidth: clampFormatWidth(settings.expressionWidth),
    linesBetweenQueries: 1,
    tabWidth: settings.indent === 'spaces4' ? 4 : 2,
    useTabs: settings.indent === 'tabs',
  };
}

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
export async function formatSql(
  sql: string,
  engine: DatabaseEngine,
  settings: FormatSettings = DEFAULT_FORMAT_SETTINGS,
): Promise<FormatResult> {
  if (!sql.trim()) {
    return { sql, changed: false };
  }

  try {
    const { format } = await loadFormatter();
    const formatted = format(sql, { language: DIALECTS[engine], ...toOptions(settings) });

    return { sql: formatted, changed: formatted !== sql };
  } catch (error) {
    return {
      sql,
      changed: false,
      error: error instanceof Error ? error.message : 'No se pudo formatear la instrucción.',
    };
  }
}
