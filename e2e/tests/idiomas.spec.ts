import { expect, test, type Page } from '@playwright/test';

import { abrir, apuntarPestana, conectar, ejecutar, escribirSql } from '../support/druse';
import { t } from '../support/i18n';
import { medir } from '../support/medir';

/**
 * El paso del pseudoidioma: la interfaz con todo el texto acentuado, alargado un
 * 40 % y entre corchetes.
 *
 * Busca dos cosas que ninguna prueba de componente puede ver:
 *
 * - **Texto que no pasó por el catálogo.** Lo traducido sale entre corchetes, así
 *   que lo que aparezca sin ellos se escribió a mano en algún sitio. El
 *   comprobador ya mira las plantillas; esto mira lo que de verdad se pinta, que
 *   incluye lo que compone el TypeScript.
 * - **Lo que se recortará al traducir.** El francés y el portugués alargan menos
 *   del 40 %, así que un texto que aquí cabe cabrá en cualquiera.
 *
 * Como el barrido, **no afirma**: anota y fotografía, porque el criterio de qué
 * es un dato y qué es una etiqueta lo pone quien mira. Se pide a mano:
 * `DRUSE_BARRIDO=1 npx playwright test tests/idiomas.spec.ts`.
 */
const SALIDA = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';

/**
 * Lo que se pinta sin pasar por el catálogo.
 *
 * Se descarta lo que es dato y no interfaz: el SQL del editor, las celdas de
 * resultados, los nombres del árbol, lo marcado con `translate="no"` y lo que no
 * tiene letras. Aun así quedan falsos positivos —el nombre de una base se parece
 * a una etiqueta— y por eso esto se lee, no se afirma.
 */
async function sinMarcar(page: Page, donde: string): Promise<string[]> {
  return page.evaluate((sitio) => {
    const fuera = [
      '.monaco-editor',
      'app-results-grid',
      'app-connections-sidebar .node__name',
      'pre',
      'code',
      'kbd',
      '[translate="no"]',
      'option',
      'input',
      'textarea',
    ].join(', ');
    const encontrado: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const texto = node.textContent?.trim() ?? '';
      const padre = node.parentElement;

      if (!padre || texto.length < 3 || !/\p{L}{3,}/u.test(texto) || padre.closest(fuera)) {
        continue;
      }

      const caja = padre.getBoundingClientRect();

      if (caja.width === 0 || caja.height === 0) {
        continue;
      }

      // Lo traducido llega envuelto: `[Ƒöŕɱåţéåŕ ~~~~]`.
      if (!texto.includes('[') && !texto.includes('~')) {
        encontrado.push(`${sitio}: «${texto.slice(0, 48)}» sin marcar`);
      }
    }

    return [...new Set(encontrado)];
  }, donde);
}

test.describe('la interfaz en pseudoidioma', () => {
  test.skip(!process.env['DRUSE_BARRIDO'], 'El paso del pseudoidioma se pide a mano.');

  test('todo lo visible sale del catálogo y nada se recorta', async ({ page }) => {
    const hallazgos: string[] = [];

    await abrir(page, 'qps');
    await conectar(page);
    await apuntarPestana(page);

    await medir(page, 'ventana', hallazgos);
    hallazgos.push(...(await sinMarcar(page, 'ventana')));
    await page.screenshot({ path: `${SALIDA}/qps-01-ventana.png` });

    // Con resultados en pantalla, que es donde vive la mitad de la interfaz.
    await escribirSql(page, "SELECT 1 AS numero, 'texto' AS descripcion");
    await ejecutar(page, 'todo');
    await medir(page, 'resultados', hallazgos);
    hallazgos.push(...(await sinMarcar(page, 'resultados')));
    await page.screenshot({ path: `${SALIDA}/qps-02-resultados.png` });

    // Y un diálogo largo, que es donde se nota el 40 % de más: en una ventana
    // ancha sobra sitio, y lo que se recorta se recorta en un formulario.
    await page.getByRole('button', { name: t('settings.title') }).click();

    const preferencias = page.locator('app-settings-dialog');

    await expect(preferencias).toBeVisible({ timeout: 15_000 });
    await medir(page, 'preferencias', hallazgos);
    hallazgos.push(...(await sinMarcar(page, 'preferencias')));
    await page.screenshot({ path: `${SALIDA}/qps-03-preferencias.png` });
    await page.keyboard.press('Escape');

    console.log(
      hallazgos.length === 0
        ? 'Nada sin marcar y nada recortado.'
        : `${hallazgos.length} cosas que mirar:\n- ${hallazgos.join('\n- ')}`,
    );

    // Lo único que se afirma: que la aplicación sigue en pie en pseudoidioma.
    await expect(page.locator('app-results-grid')).toBeVisible();
  });
});
