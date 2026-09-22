import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { pseudolocalize } from '../../frontend/src/app/core/i18n/icu';

/**
 * El idioma con el que se abre Druse en las pruebas.
 *
 * Por omisión, español. `DRUSE_E2E_LOCALE=en npx playwright test …` repite la
 * misma prueba en inglés, que es lo que comprueba que la interfaz traducida
 * sigue llevando a los mismos sitios y no solo que las claves existen.
 */
export const IDIOMA = process.env['DRUSE_E2E_LOCALE'] ?? 'es';

/** Donde Druse recuerda el idioma en esta máquina, para arrancar sin parpadeo. */
const CLAVE = 'druse.locale';

/** Y donde lo guarda con las demás preferencias del perfil. */
const PREFERENCIA = 'ui.locale';

/**
 * El idioma que la página está usando ahora.
 *
 * Lo pone `elegirIdioma`, porque una prueba puede pedir uno distinto del de la
 * variable de entorno —el paso del pseudoidioma lo hace— y entonces `t()` tiene
 * que devolver lo que de verdad se pinta.
 */
let enUso = IDIOMA;

const catalogos = new Map<string, Record<string, string>>();

function catalogo(idioma: string): Record<string, string> {
  // El pseudoidioma no tiene archivo: sale del español, acentuado y alargado.
  const archivo = idioma === 'qps' ? 'es' : idioma;
  const guardado = catalogos.get(archivo);

  if (guardado) {
    return guardado;
  }

  // Se lee del código fuente del frontend: el catálogo de la aplicación es el
  // mismo que la prueba usa para saber qué texto esperar.
  const leido = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'frontend', 'src', 'i18n', `${archivo}.json`), 'utf8'),
  ) as Record<string, string>;

  catalogos.set(archivo, leido);

  return leido;
}

/**
 * El texto de una clave, en el idioma de la ejecución.
 *
 * Es lo que permite escribir la prueba una vez: en lugar de «Nueva conexión»,
 * `t('connections.new')`, y la misma prueba vale para los dos idiomas.
 *
 * Solo sustituye parámetros simples. Un mensaje con plurales tiene varias formas
 * y elegir la correcta aquí sería reimplementar el catálogo: si una prueba lo
 * necesita, mejor que mire por un trozo estable del texto.
 */
export function t(clave: string, params: Record<string, string | number> = {}): string {
  const mensaje = catalogo(enUso)[clave];

  if (mensaje === undefined) {
    throw new Error(`La clave «${clave}» no está en el catálogo de ${enUso}.`);
  }

  if (/\{[^}]+,\s*(plural|select)/.test(mensaje)) {
    throw new Error(`«${clave}» tiene formas alternativas: no se puede resolver aquí.`);
  }

  const texto = mensaje.replace(/\{(\w+)\}/g, (entero, nombre: string) =>
    nombre in params ? String(params[nombre]) : entero,
  );

  return enUso === 'qps' ? pseudolocalize(texto) : texto;
}

/**
 * Deja elegido el idioma antes de que la aplicación arranque.
 *
 * Se escribe en `localStorage` y no se pulsa en Preferencias porque el idioma
 * tiene que estar puesto **antes** del primer pintado: es lo que hace
 * `prepareLocale` al arrancar, y es justo el camino que interesa probar.
 */
export async function elegirIdioma(page: Page, idioma = IDIOMA): Promise<void> {
  enUso = idioma;

  await page.addInitScript(
    ([clave, elegido]) => {
      try {
        localStorage.setItem(clave, elegido);
      } catch {
        // Sin almacenamiento, la aplicación arranca en el idioma del sistema.
      }
    },
    [CLAVE, idioma] as const,
  );

  // Y en las preferencias, que es lo que manda: al arrancar, la aplicación
  // adopta el idioma guardado en el perfil y ese pisaría al de esta máquina.
  await page.request.put(`/api/preferences/${encodeURIComponent(PREFERENCIA)}`, {
    data: { value: idioma },
  });
}
