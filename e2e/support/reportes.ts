import { expect, type Locator, type Page } from '@playwright/test';

import { CONTENEDOR } from './druse';

/**
 * Ventas y metas del escenario de Reportes BI, sin tablas: las dos fuentes se
 * escriben con VALUES para no depender de lo que haya en la base de pruebas.
 */
export const VENTAS_SQL = `SELECT DATE '2026-01-01' AS mes, municipio, importe::numeric(10,2) AS venta
FROM (VALUES ('05001', 80), ('08001', 100), ('11001', 40)) AS ventas(municipio, importe)`;

export const METAS_SQL = `SELECT DATE '2026-01-01' AS mes, municipio, importe::numeric(10,2) AS meta
FROM (VALUES ('05001', 100), ('08001', 200)) AS metas(municipio, importe)`;

/** Abre Reportes desde la barra superior. */
export async function abrirReportes(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Reportes', exact: true }).click();
  const reportes = page.locator('app-report-builder');

  await expect(reportes.locator('.dialog')).toBeVisible();
  return reportes;
}

/**
 * Añade una fuente SQL sobre la conexión de pruebas.
 *
 * La base se escribe y se sale del campo con Tab: el constructor la toma en
 * `change`, que es lo que hace también quien elige de la lista.
 */
export async function anadirFuente(reportes: Locator, alias: string, sql: string): Promise<void> {
  await reportes.getByRole('button', { name: 'Añadir fuente' }).first().click();

  const inspector = reportes.locator('.inspector');
  const conexion = inspector.locator('select').first();
  const valor = await conexion
    .locator('option', { hasText: CONTENEDOR.nombre })
    .first()
    .getAttribute('value');

  await conexion.selectOption(valor ?? '');
  await inspector.getByLabel('Alias').fill(alias);

  const base = inspector.getByLabel('Base de datos');

  await base.fill(CONTENEDOR.base);
  await base.press('Tab');
  await inspector.getByLabel('Consulta').fill(sql);
}

export async function previsualizar(reportes: Locator): Promise<void> {
  await reportes.getByRole('button', { name: 'Vista previa' }).click();
  await expect(reportes.getByRole('button', { name: 'Vista previa' })).toBeEnabled({ timeout: 60_000 });
}
