import { activeLocale } from '../../../core/i18n/active';
import { DatabaseEngine } from '../../../shared/models/workspace';
import { SQL_REFERENCE_EN } from './sql-reference.en';
import { SQL_REFERENCE_ES } from './sql-reference.es';
import { SqlReferenceEntry } from './sql-reference-types';

export type { SqlParameter, SqlReferenceEntry } from './sql-reference-types';

/**
 * Las entradas en el idioma de la interfaz.
 *
 * El español es el original y el inglés su traducción; los demás idiomas caen
 * al inglés, igual que hace el catálogo con una clave que les falta. Es el único
 * texto de Druse que no pasa por el catálogo: es documentación, y se escribe
 * entera de una vez.
 */
function entries(): readonly SqlReferenceEntry[] {
  const locale = activeLocale();

  return locale === 'es' || locale === 'qps' ? SQL_REFERENCE_ES : SQL_REFERENCE_EN;
}

/** Las funciones, en el idioma de la interfaz. */
function functions(): readonly SqlReferenceEntry[] {
  return entries().filter((entry) => entry.kind === 'function');
}

const available = (entry: SqlReferenceEntry, engine: DatabaseEngine | undefined) =>
  !engine || !entry.engines || entry.engines.includes(engine);

/**
 * La entrada de un nombre en un motor.
 *
 * Sin motor, la primera que haya: el tooltip de una pestaña sin conexión sigue
 * pudiendo explicar un `COALESCE`.
 */
export function referenceFor(name: string, engine?: DatabaseEngine): SqlReferenceEntry | undefined {
  const key = name.toUpperCase();

  return entries().find((entry) => entry.name.toUpperCase() === key && available(entry, engine));
}

/** Las funciones que existen en un motor, sin repetir nombre. */
export function functionReferences(engine: DatabaseEngine): readonly SqlReferenceEntry[] {
  const seen = new Set<string>();

  return functions().filter((entry) => {
    const key = entry.name.toUpperCase();

    if (!available(entry, engine) || seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

/** `COALESCE(valor, alternativa, …)`: la firma tal como se escribe. */
export function signatureLabel(entry: SqlReferenceEntry): string {
  const params = (entry.params ?? []).map((param) => param.name);

  if (entry.variadic) {
    params.push('…');
  }

  return `${entry.name}(${params.join(', ')})`;
}

/**
 * La explicación entera, en Markdown, para el tooltip y el autocompletado.
 *
 * El motor se nombra cuando la entrada es de unos pocos: saber que `NVL` es de
 * Oracle es la mitad de entender por qué en otro servidor falla.
 */
export function describeReference(
  entry: SqlReferenceEntry,
  { signature = true }: { signature?: boolean } = {},
): string {
  const lineas: string[] = [];

  if (entry.kind === 'function') {
    // El autocompletado ya la enseña en su cabecera; repetirla ocupa sitio.
    if (signature) {
      lineas.push('```sql', signatureLabel(entry), '```', '');
    }
  } else {
    lineas.push(`**${entry.name}**`, '');
  }

  lineas.push(entry.summary);

  const params = entry.params ?? [];

  if (params.length > 0) {
    lineas.push('');

    for (const param of params) {
      lineas.push(`- \`${param.name}\` — ${param.doc}`);
    }
  }

  if (entry.example) {
    lineas.push('', '```sql', entry.example, '```');
  }

  if (entry.engines) {
    lineas.push('', `_${entry.engines.map(engineLabel).filter(unique).join(', ')}_`);
  }

  return lineas.join('\n');
}

function engineLabel(engine: DatabaseEngine): string {
  const nombres: Record<DatabaseEngine, string> = {
    postgresql: 'PostgreSQL',
    sqlserver: 'SQL Server',
    mysql: 'MySQL',
    informix: 'Informix',
    informixsqli: 'Informix',
    oracle: 'Oracle',
    sqlite: 'SQLite',
  };

  return nombres[engine];
}

function unique<T>(value: T, index: number, all: readonly T[]): boolean {
  return all.indexOf(value) === index;
}
