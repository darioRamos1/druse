import { MessageParams, formatMessage } from './icu';
import type { I18nService } from './i18n.service';
import { Locale, SOURCE_CATALOG } from './locale';

/**
 * El servicio de idioma de esta ventana, para las funciones que no son
 * inyectables.
 *
 * Casi todo el texto se traduce con el servicio inyectado o con la pipe. Pero
 * hay piezas que son funciones puras y se llaman desde muchos sitios —el
 * escritor de SQL, que compone las consultas del compositor y las lleva
 * comentarios dentro— y arrastrar el servicio por sus ochenta llamadas, y por
 * las de sus pruebas, solo para cuatro frases habría ensuciado cada una de
 * ellas para siempre.
 *
 * El idioma de la ventana es, de hecho, único: hay un `I18nService` por
 * aplicación y `t()` ya lee una señal. Esto solo le da un nombre a ese hecho.
 * **No es un atajo para evitar inyectarlo**: en un componente o en un servicio
 * se inyecta, como en todo el resto del código.
 */
let active: I18nService | null = null;

/** Lo llama el propio servicio al crearse. */
export function setActiveI18n(service: I18nService): void {
  active = service;
}

/**
 * El idioma elegido, para lo que no se traduce clave a clave.
 *
 * Lo usa la referencia de SQL, que tiene un archivo por idioma en vez de
 * entradas en el catálogo. Sin servicio, español: es el original.
 */
export function activeLocale(): Locale {
  return active ? active.locale() : 'es';
}

/**
 * Traduce desde una función pura.
 *
 * Sin servicio —una prueba que llama a la función suelta, sin `TestBed`— sale el
 * catálogo fuente: es el texto tal y como se escribió, así que esas pruebas
 * siguen comprobando lo que el usuario lee sin tener que montar la aplicación.
 */
export function translate(key: string, params: MessageParams = {}): string {
  if (active) {
    return active.t(key, params);
  }

  const message = SOURCE_CATALOG[key];

  return message === undefined ? key : formatMessage(message, params, 'es');
}
