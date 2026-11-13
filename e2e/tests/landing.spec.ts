import { expect, test, type Page } from '@playwright/test';

import { abrir, conectar } from '../support/druse';
import {
  METAS_SQL,
  VENTAS_SQL,
  abrirReportes,
  abrirVisualizacion,
  actualizar,
  anadirFuente,
  borrarRestos,
  crearTablero,
  previsualizar,
  guardarReporte,
} from '../support/reportes';

/**
 * Las capturas de Reportes BI que enseña la landing (`#reportes-bi`).
 *
 * Van aparte del barrido porque allí todo se llama «Barrido · …» para poder
 * limpiarlo, y eso no se puede publicar. Aquí los nombres son los del caso de
 * validación del plan, con sus datos ficticios: ventas por municipio, metas y
 * el 60 % de cumplimiento.
 *
 * Se pide a mano y deja PNG en `DRUSE_LANDING_DIR`; `build/scripts/landing-capturas.py`
 * las pasa a WebP en `landing/assets/`:
 *
 * `$env:DRUSE_LANDING="1"; npx playwright test tests/landing.spec.ts`
 */
const SALIDA = process.env['DRUSE_LANDING_DIR'] ?? 'landing-capturas';
const CONJUNTO = 'Ventas y metas';
const TABLERO = 'Tablero comercial';
// Sin anclas: la fila de un conjunto lleva más texto que su nombre. Alcanza
// también a los «Barrido · Ventas y metas» que deje el barrido, que son restos.
const RESTOS = /Ventas y metas|Tablero comercial/;

async function foto(page: Page, nombre: string): Promise<void> {
  // Un instante para que las transiciones terminen: la foto es para mirarla.
  await page.waitForTimeout(400);
  await page.locator('app-report-builder .dialog').screenshot({ path: `${SALIDA}/${nombre}.png` });
}

test.describe('capturas de la landing', () => {
  test.skip(!process.env['DRUSE_LANDING'], 'Las capturas de la landing se piden a mano.');

  test('Reportes BI: constructor, tablero y programación', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    // 600 de alto: el cruce y el tablero no llenan más, y las tres capturas
    // van lado a lado en la landing con la misma proporción.
    await page.setViewportSize({ width: 1280, height: 600 });
    await abrir(page);
    await conectar(page);

    const reportes = await abrirReportes(page);

    await borrarRestos(reportes, RESTOS, RESTOS);

    // Dos fuentes y su unión, con la vista previa del cruce.
    await reportes.getByLabel('Nombre del conjunto de datos').fill(CONJUNTO);
    await anadirFuente(reportes, 'Ventas', VENTAS_SQL);
    await previsualizar(reportes);
    await anadirFuente(reportes, 'Metas', METAS_SQL);
    await previsualizar(reportes);
    await reportes.locator('.steps__item').nth(1).click();
    await previsualizar(reportes);
    await expect(reportes.locator('tbody tr')).toHaveCount(3);
    await foto(page, 'reportes-combinar');

    // Dos reportes: barras por municipio y el indicador de cumplimiento.
    await reportes.getByRole('button', { name: 'Guardar', exact: true }).click();
    await abrirVisualizacion(reportes);
    await actualizar(reportes);
    const inspector = reportes.locator('.inspector');

    await inspector.getByLabel('Agrupar por').selectOption({ label: 'Ventas.municipio' });
    await inspector.getByLabel('Nombre del reporte').fill('Ventas por municipio');
    await inspector.locator('summary', { hasText: 'Apariencia' }).click();
    await inspector.getByLabel('Un color por categoría').check();
    await inspector.getByLabel('Prefijo').fill('$ ');
    await guardarReporte(reportes);
    await reportes.getByRole('button', { name: 'Nuevo reporte' }).click();
    await expect(inspector.getByLabel('Nombre del reporte')).toHaveValue(/^Reporte \d+$/);
    await reportes.getByRole('radio', { name: 'Indicador' }).click();
    await inspector.getByLabel('Nombre del reporte').fill('Cumplimiento');
    await inspector.getByLabel('En meta desde').fill('90');
    await inspector.getByLabel('En meta desde').press('Tab');
    await inspector.getByLabel('Cerca desde').fill('50');
    await inspector.getByLabel('Cerca desde').press('Tab');
    await guardarReporte(reportes);

    // La programación, abierta sobre el indicador.
    await reportes.getByRole('button', { name: 'Programar', exact: true }).click();
    const programar = reportes.locator('form.schedule');

    await programar.getByRole('radio', { name: 'Semanal' }).click();
    await programar.getByLabel('Jueves').check();
    await foto(page, 'reportes-programar');
    await programar.getByRole('button', { name: 'Cancelar' }).click();

    // El tablero con su filtro de fecha y de categoría.
    await crearTablero(reportes, TABLERO, ['Ventas por municipio', 'Cumplimiento']);
    const tablero = reportes.locator('app-report-dashboard');

    await expect(tablero.locator('.panel .indicator__value')).toHaveText(/60\s?%/);
    await expect(tablero.locator('.panel .chart__bar')).toHaveCount(3);
    await foto(page, 'reportes-tablero');

    // Se deja como estaba.
    await borrarRestos(reportes, RESTOS, RESTOS);
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
  });
});
