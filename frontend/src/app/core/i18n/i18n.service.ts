import { Injectable, computed, inject, isDevMode, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import { MessageParams, formatMessage, pseudolocalize } from './icu';
import { setFormatLocale } from './locale-format';
import {
  Catalog,
  LOCALE_NAMES,
  LOCALE_PREFERENCE,
  Locale,
  SOURCE_CATALOG,
  applyDocumentLocale,
  initialLocale,
  isLocale,
  loadCatalog,
  rememberLocale,
} from './locale';

/**
 * Lo que dejó preparado el arranque, antes de que existiera Angular.
 *
 * `main.ts` decide el idioma y carga su catálogo **antes** de arrancar: si se
 * hiciera aquí, la primera pantalla se pintaría en español y saltaría al idioma
 * elegido en cuanto llegara el catálogo.
 */
let prepared: { locale: Locale; catalog: Catalog } | null = null;

/** Lo llama `main.ts` antes de `bootstrapApplication`. */
export async function prepareLocale(): Promise<void> {
  const locale = initialLocale();

  try {
    prepared = { locale, catalog: await loadCatalog(locale) };
  } catch {
    // Un catálogo que no carga no puede impedir que Druse abra: en español,
    // que siempre está.
    prepared = { locale: 'es', catalog: SOURCE_CATALOG };
  }

  applyDocumentLocale(prepared.locale);
  setFormatLocale(intlOf(prepared.locale));

  // La pantalla de carga está en `index.html`, antes que Angular: su nombre
  // accesible se pone aquí, que es lo primero que ya sabe el idioma.
  const splash = document.getElementById('druse-splash');
  const starting = prepared.catalog['app.starting'] ?? SOURCE_CATALOG['app.starting'];

  if (splash && starting) {
    splash.setAttribute('aria-label', starting);
  }
}

/** El pseudoidioma formatea como el español, del que sale. */
function intlOf(locale: Locale): string {
  return locale === 'qps' ? 'es' : locale;
}

/** Un idioma del selector, con lo que le falta. */
export interface LocaleOption {
  readonly id: Locale;
  readonly name: string;
  /** Tiene traducidas todas las claves del español. */
  readonly complete: boolean;
}

/**
 * El idioma de la interfaz y los textos de cada uno.
 *
 * `t()` lee una señal, así que las plantillas y los `computed` que lo usan se
 * actualizan solos al cambiar de idioma, sin reiniciar.
 *
 * Si falta una clave en el idioma elegido se busca en inglés, luego en español,
 * y si tampoco está se enseña la propia clave: se ve raro, que es justo lo que
 * hace falta para que alguien la encuentre.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  /**
   * Opcional: solo sirve para guardar la preferencia. Sin él —en las pruebas de
   * un componente suelto— el idioma se aplica igual, y cada prueba de cada
   * componente traducido no tiene que traer un gateway que no usa.
   */
  private readonly _gateway = inject(ApplicationGateway, { optional: true });

  private readonly _locale = signal<Locale>(prepared?.locale ?? 'es');
  private readonly _catalogs = signal<ReadonlyMap<Locale, Catalog>>(
    new Map<Locale, Catalog>([
      ['es', SOURCE_CATALOG],
      ...(prepared ? [[prepared.locale, prepared.catalog] as const] : []),
    ]),
  );

  /** Claves ya avisadas en consola, para no repetir el aviso en cada pintado. */
  private readonly _warned = new Set<string>();

  readonly locale = this._locale.asReadonly();

  /**
   * El idioma que usa `Intl` para números, fechas y orden alfabético. El
   * pseudoidioma formatea como el español, del que sale.
   */
  readonly intlLocale = computed(() => intlOf(this._locale()));

  constructor() {
    // Normalmente ya lo hizo el arranque; repetirlo cubre las pruebas y
    // cualquier otro punto de entrada que no pase por `main.ts`.
    applyDocumentLocale(this._locale());
    setFormatLocale(this.intlLocale());
  }

  /**
   * El texto de una clave, en el idioma actual.
   *
   * Los parámetros se escriben con `{nombre}` en el catálogo; los números se
   * formatean en el idioma, y los plurales siguen sus reglas.
   */
  t(key: string, params: MessageParams = {}): string {
    const locale = this._locale();
    const catalogs = this._catalogs();
    const message = catalogs.get(locale)?.[key] ?? catalogs.get('en')?.[key] ?? SOURCE_CATALOG[key];

    if (message === undefined) {
      this.warn(key);
      return key;
    }

    const text = formatMessage(message, params, this.intlLocale());

    return locale === 'qps' ? pseudolocalize(text) : text;
  }

  /** Si el catálogo fuente tiene la clave: para textos que pueden venir de fuera. */
  has(key: string): boolean {
    return key in SOURCE_CATALOG;
  }

  /**
   * Una frase con trozos que se pintan distinto —un nombre de archivo en
   * `<code>`, un enlace—, sin partirla.
   *
   * Partir «El texto está en », «LICENSE.txt» y «, dentro de…» en tres claves
   * impide traducirla: cada idioma coloca las piezas en otro orden. Aquí la
   * frase es una sola clave con `{file}` dentro, y se devuelve en trozos: el
   * texto normal con `tag: null` y cada parámetro de `rich` con su nombre, para
   * que la plantilla lo pinte como quiera.
   */
  tParts(
    key: string,
    rich: Readonly<Record<string, string>>,
    params: MessageParams = {},
  ): { readonly text: string; readonly tag: string | null }[] {
    // Marcas con dígitos y no con el nombre: el pseudoidioma acentúa las
    // letras, y una marca con letras dejaría de reconocerse.
    const names = Object.keys(rich);
    const markers = Object.fromEntries(names.map((name, index) => [name, `\u0001${index}\u0002`]));
    const text = this.t(key, { ...params, ...markers });
    const parts: { text: string; tag: string | null }[] = [];
    let last = 0;

    for (const match of text.matchAll(/\u0001(\d+)\u0002/g)) {
      if (match.index > last) {
        parts.push({ text: text.slice(last, match.index), tag: null });
      }

      const name = names[Number(match[1])];
      parts.push({ text: rich[name], tag: name });
      last = match.index + match[0].length;
    }

    if (last < text.length) {
      parts.push({ text: text.slice(last), tag: null });
    }

    return parts;
  }

  /**
   * Cambia el idioma, al momento.
   *
   * Carga su catálogo —y el inglés, que es el respaldo—, lo recuerda en esta
   * máquina y lo guarda con las demás preferencias.
   */
  async setLocale(locale: Locale, { persist = true } = {}): Promise<void> {
    const needed = [locale, 'en' as const].filter((item) => !this._catalogs().has(item));
    const loaded = await Promise.all(
      needed.map(async (item) => [item, await loadCatalog(item)] as const),
    );

    if (loaded.length > 0) {
      this._catalogs.update((current) => new Map([...current, ...loaded]));
    }

    this._locale.set(locale);
    applyDocumentLocale(locale);
    setFormatLocale(intlOf(locale));
    rememberLocale(locale);

    if (persist && this._gateway) {
      try {
        await firstValueFrom(this._gateway.setPreference(LOCALE_PREFERENCE, locale));
      } catch {
        // Ya está aplicado y recordado aquí; no poder guardarlo en el servidor
        // no merece un aviso.
      }
    }
  }

  /**
   * Adopta el idioma de las preferencias del servidor, si trae uno.
   *
   * Sin él se deja el del arranque: puede que sea la primera vez contra esta
   * base, y el del sistema es la mejor suposición.
   */
  async adopt(preferences: Readonly<Record<string, string>>): Promise<void> {
    const stored = preferences[LOCALE_PREFERENCE];

    if (isLocale(stored) && stored !== this._locale()) {
      await this.setLocale(stored, { persist: false });
    }
  }

  /**
   * Los idiomas que se ofrecen, y si les falta algo.
   *
   * Uno sin ninguna clave traducida no se ofrece: elegirlo no cambiaría nada.
   * El pseudoidioma solo aparece en desarrollo.
   */
  async options(): Promise<LocaleOption[]> {
    const total = Object.keys(SOURCE_CATALOG).length;
    const options: LocaleOption[] = [];

    for (const id of Object.keys(LOCALE_NAMES) as (keyof typeof LOCALE_NAMES)[]) {
      const catalog = id === 'es' ? SOURCE_CATALOG : await loadCatalog(id);
      const translated = Object.keys(catalog).filter((key) => key in SOURCE_CATALOG).length;

      if (translated > 0) {
        options.push({ id, name: LOCALE_NAMES[id], complete: translated >= total });
      }
    }

    if (isDevMode()) {
      options.push({ id: 'qps', name: '[Ƥšéûðö ~~~]', complete: true });
    }

    return options;
  }

  private warn(key: string): void {
    if (isDevMode() && !this._warned.has(key)) {
      this._warned.add(key);
      console.warn(`[i18n] Falta la clave «${key}» en todos los catálogos.`);
    }
  }
}
