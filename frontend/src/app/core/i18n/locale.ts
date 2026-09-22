import es from '../../../i18n/es.json';

/**
 * Los idiomas de Druse.
 *
 * `es` es el idioma fuente y siempre está completo; `en` es el respaldo de los
 * demás. `qps` es el pseudoidioma de desarrollo (ver `pseudolocalize`): nunca se
 * ofrece fuera del modo de desarrollo.
 */
export type Locale = 'es' | 'en' | 'pt-BR' | 'fr' | 'qps';

/** Un catálogo: clave → mensaje en ICU reducido. */
export type Catalog = Readonly<Record<string, string>>;

/**
 * Cómo se nombra cada idioma en el selector: **en su propio idioma**.
 *
 * Quien abre Preferencias sin entender el idioma actual tiene que poder
 * encontrar el suyo.
 */
export const LOCALE_NAMES: Readonly<Record<Exclude<Locale, 'qps'>, string>> = {
  es: 'Español',
  en: 'English',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
};

/** Cómo se guarda en la base local. Es el contrato con las preferencias. */
export const LOCALE_PREFERENCE = 'ui.locale';

/**
 * Dónde se copia en el navegador.
 *
 * Como con la apariencia: la preferencia de verdad llega por HTTP, y eso es
 * tarde para la primera pantalla. Esta copia evita abrir en un idioma y saltar
 * a otro medio segundo después.
 */
const CACHE_KEY = 'druse.locale';

export const SOURCE_CATALOG: Catalog = es;

/**
 * Los catálogos que no son la fuente, cada uno en su propio trozo del paquete.
 *
 * Con `import()` y no con `fetch` a `assets/`: en la aplicación de escritorio no
 * hay servidor, y así cada idioma solo se descarga si se usa.
 */
const LOADERS: Readonly<Record<'en' | 'pt-BR' | 'fr', () => Promise<Catalog>>> = {
  en: () => import('../../../i18n/en.json').then((module) => module.default as Catalog),
  'pt-BR': () => import('../../../i18n/pt-BR.json').then((module) => module.default as Catalog),
  fr: () => import('../../../i18n/fr.json').then((module) => module.default as Catalog),
};

/** Carga el catálogo de un idioma. El de `qps` es el español: se transforma al usarlo. */
export function loadCatalog(locale: Locale): Promise<Catalog> {
  return locale === 'es' || locale === 'qps' ? Promise.resolve(SOURCE_CATALOG) : LOADERS[locale]();
}

export function isLocale(value: unknown): value is Locale {
  return value === 'es' || value === 'en' || value === 'pt-BR' || value === 'fr' || value === 'qps';
}

/**
 * El idioma de Druse que corresponde a los del sistema.
 *
 * Se prueban en el orden en que el sistema los prefiere, y gana el primero que
 * Druse tenga. Cualquier portugués va a `pt-BR`, a falta de algo mejor. Si no
 * hay ninguno, inglés.
 */
export function resolveLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const lower = tag.toLowerCase();

    if (lower === 'es' || lower.startsWith('es-')) return 'es';
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
    if (lower === 'pt' || lower.startsWith('pt-')) return 'pt-BR';
    if (lower === 'fr' || lower.startsWith('fr-')) return 'fr';
  }

  return 'en';
}

/** El recordado en esta máquina, si hay uno. */
export function cachedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(CACHE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(CACHE_KEY, locale);
  } catch {
    // Sin copia local solo se pierde el arranque sin parpadeo.
  }
}

/** El idioma con el que arrancar: el recordado, o el del sistema. */
export function initialLocale(): Locale {
  return cachedLocale() ?? resolveLocale(navigator.languages ?? [navigator.language]);
}

/**
 * Escribe el idioma en `<html>`.
 *
 * Los lectores de pantalla pronuncian según `lang`; antes decía `en` con toda
 * la interfaz en español. El pseudoidioma se anuncia como español, que es de
 * donde sale su texto.
 */
export function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale === 'qps' ? 'es' : locale;
}
