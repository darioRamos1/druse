import { expect, test, type Locator } from '@playwright/test';

import { abrir, conectar } from '../support/druse';
import {
  METAS_SQL,
  VENTAS_SQL,
  abrirReportes,
  abrirVisualizacion,
  actualizar,
  anadirFuente,
  crearTablero,
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
    // Un nombre propio: reabrirlo no puede confundirse con restos de otra ejecución.
    const nombre = `E2E Reportes ${Date.now()}`;

    await reportes.getByLabel('Nombre del conjunto de datos').fill(nombre);

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
    const informe = `Cumplimiento ${nombre}`;

    await reportes.locator('.inspector').getByLabel('Nombre del reporte').fill(informe);
    await reportes.getByRole('button', { name: 'Guardar reporte' }).click();
    await expect(reportes.locator('.reports__tab[aria-selected="true"]')).toHaveText(informe);

    // Cerrar y volver: el reporte y sus datos salen de reports.db.
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
    const otraVez = await abrirReportes(page);

    await otraVez.locator('.datasets__item', { hasText: nombre }).first().click();
    await abrirVisualizacion(otraVez);
    await expect(otraVez.locator('.indicator__value')).toHaveText(/60\s?%/);

    // --- Hito 4: un tablero con el indicador y un filtro de mes compartido -------
    const tablero = otraVez.locator('app-report-dashboard');
    const nombreTablero = `Tablero ${Date.now()}`;

    await crearTablero(otraVez, nombreTablero, [informe]);
    await expect(tablero.locator('.panel .indicator__value')).toHaveText(/60\s?%/);

    // Febrero no tiene datos en el escenario: el indicador se queda sin cifra.
    const [desde] = await tablero.locator('.filter input[type="date"]').all();

    await desde.fill('2026-02-01');
    await desde.dispatchEvent('change');
    await expect(tablero.locator('.panel .indicator__value')).toHaveText('—');
    await tablero.getByRole('button', { name: 'Quitar filtros' }).click();
    await expect(tablero.locator('.panel .indicator__value')).toHaveText(/60\s?%/);

    // Se deja el espacio de trabajo como estaba.
    await tablero.getByRole('button', { name: 'Editar diseño' }).click();
    await tablero.getByRole('button', { name: 'Borrar este tablero' }).click();
    await tablero.locator('.inspector').getByRole('button', { name: 'Borrar', exact: true }).click();
    await expect(otraVez.locator('.datasets__item', { hasText: nombreTablero })).toHaveCount(0);

    // Y no vuelve al reabrir: el borrado llegó al servidor, no solo a la lista.
    await page.keyboard.press('Escape');
    await expect(otraVez.locator('.dialog')).toBeHidden();
    const terceraVez = await abrirReportes(page);

    await expect(terceraVez.locator('.datasets__item', { hasText: nombre }).first()).toBeVisible();
    await expect(terceraVez.locator('.datasets__item', { hasText: nombreTablero })).toHaveCount(0);
    await terceraVez.locator('.datasets__item', { hasText: nombre }).first().click();
    await terceraVez.locator('.steps__item').first().click();
    await borrarConjunto(terceraVez);
    await page.keyboard.press('Escape');
    await expect(terceraVez.locator('.dialog')).toBeHidden();
  });
});

async function borrarConjunto(reportes: Locator): Promise<void> {
  await reportes.getByRole('button', { name: 'Borrar este conjunto de datos' }).click();
  await reportes.locator('.confirm').getByRole('button', { name: 'Borrar' }).click();
  await expect(reportes.locator('.datasets__item.is-active')).toHaveCount(0);
}
