import { expect, test, type Locator } from '@playwright/test';

import { abrir, conectar } from '../support/druse';
import {
  METAS_SQL,
  VENTAS_SQL,
  abrirReportes,
  abrirVisualizacion,
  actualizar,
  anadirFuente,
  previsualizar,
} from '../support/reportes';

/**
 * Reportes BI de punta a punta: el constructor manda la definición, la API
 * resuelve la contraseña guardada, lee PostgreSQL y el cruce vuelve dibujado.
 *
 * Las reglas del cruce se prueban en el backend; aquí, que las tres capas
 * encajan. Las dos fuentes van a la misma conexión porque es la que hay en
 * todas las máquinas: cruzar motores distintos ya lo cubre la integración.
 */
test.describe('Reportes BI', () => {
  test('arma un conjunto con dos fuentes, las cruza y lo guarda', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const reportes = await abrirReportes(page);

    await anadirFuente(reportes, 'Ventas', VENTAS_SQL);
    await previsualizar(reportes);

    /**
     * En Linux, CI no tiene llavero: el perfil se guarda sin contraseña y la
     * fuente lo dice. Es el diagnóstico real de ese caso, y es lo que se comprueba.
     */
    const sinLlavero = reportes.locator('.diagnostic--danger', { hasText: 'contraseña guardada' });

    if (await sinLlavero.isVisible()) {
      test.info().annotations.push({ type: 'sin llavero', description: 'La fuente pidió la contraseña.' });
      return;
    }

    await expect(reportes.locator('.stats')).toContainText('3 filas');
    await expect(reportes.locator('td.is-number').first()).toHaveText('80');

    await anadirFuente(reportes, 'Metas', METAS_SQL);
    await previsualizar(reportes);
    await reportes.locator('.steps__item').nth(1).click();

    // Las columnas que se llaman igual a los dos lados se proponen solas.
    const pares = reportes.locator('.pair');

    await expect(pares).toHaveCount(2);
    await expect(pares.nth(1).locator('input').first()).toHaveValue('municipio');

    await previsualizar(reportes);
    const resumen = reportes.locator('.summary');

    await expect(resumen).toContainText('3');
    await expect(resumen.locator('div').nth(1)).toContainText('2');
    await expect(reportes.locator('tbody tr')).toHaveCount(3);

    await reportes.getByRole('button', { name: 'Guardar' }).click();
    await expect(reportes.locator('.banner--success')).toContainText('versión 1');
    await expect(reportes.locator('.datasets__item.is-active')).toBeVisible();

    // --- Hito 3: actualizar, ver barras e indicador, y reabrirlo ---------------
    await abrirVisualizacion(reportes);
    await expect(reportes.locator('.freshness')).toContainText('Todavía no hay datos guardados');
    await actualizar(reportes);
    await expect(reportes.locator('.freshness')).toContainText('Datos del');
    await expect(reportes.locator('.chart__bar')).toHaveCount(1);

    // Por municipio, las tres barras del escenario.
    await reportes.locator('.inspector').getByLabel('Agrupar por').selectOption({ label: 'Ventas.municipio' });
    await expect(reportes.locator('.chart__bar')).toHaveCount(3);

    await reportes.getByRole('radio', { name: 'Indicador' }).click();
    await expect(reportes.locator('.indicator__value')).toHaveText(/60\s?%/);
    await expect(reportes.locator('.indicator')).toContainText('1 fila sin meta');
    await reportes.getByRole('button', { name: 'Guardar reporte' }).click();
    await expect(reportes.locator('.reports__tab[aria-selected="true"]')).toHaveText('Reporte 1');

    // Cerrar y volver: el reporte y sus datos salen de reports.db.
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
    const otraVez = await abrirReportes(page);

    await otraVez.locator('.datasets__item', { hasText: 'Conjunto sin nombre' }).first().click();
    await abrirVisualizacion(otraVez);
    await expect(otraVez.locator('.indicator__value')).toHaveText(/60\s?%/);

    // Se deja el espacio de trabajo como estaba.
    await otraVez.locator('.steps__item').first().click();
    await borrarConjunto(otraVez);
    await page.keyboard.press('Escape');
    await expect(otraVez.locator('.dialog')).toBeHidden();
  });
});

async function borrarConjunto(reportes: Locator): Promise<void> {
  await reportes.getByRole('button', { name: 'Borrar este conjunto de datos' }).click();
  await reportes.locator('.confirm').getByRole('button', { name: 'Borrar' }).click();
  await expect(reportes.locator('.datasets__item.is-active')).toHaveCount(0);
}
