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

/** El paso 3; necesita el conjunto guardado. */
export async function abrirVisualizacion(reportes: Locator): Promise<void> {
  await reportes.locator('.steps__item').nth(2).click();
  await expect(reportes.locator('app-report-workbench .freshness')).toBeVisible();
  await expect(reportes.getByRole('button', { name: 'Actualizar ahora' })).toBeEnabled({ timeout: 30_000 });
}

/** «Actualizar ahora» y esperar a que termine. */
export async function actualizar(reportes: Locator): Promise<void> {
  await reportes.getByRole('button', { name: 'Actualizar ahora' }).click();
  await expect(reportes.getByRole('button', { name: 'Actualizar ahora' })).toBeEnabled({ timeout: 60_000 });
}

/**
 * Crea un tablero con los reportes indicados y un filtro de fecha y otro de
 * categoría, y lo guarda. Los filtros se vinculan solos a las columnas que
 * propone el tablero.
 */
export async function crearTablero(reportes: Locator, nombre: string, informes: readonly string[]): Promise<void> {
  await reportes.getByRole('button', { name: 'Nuevo tablero' }).click();
  const tablero = reportes.locator('app-report-dashboard');

  await tablero.getByLabel('Nombre del tablero').fill(nombre);
  for (const informe of informes) {
    await tablero.locator('.inspector').getByLabel('Añadir reporte').selectOption({ label: informe });
  }

  await expect(tablero.locator('.panel')).toHaveCount(informes.length);
  await tablero.getByRole('button', { name: 'Filtro de fecha' }).click();
  await tablero.getByRole('button', { name: 'Filtro de categoría' }).click();
  await tablero.getByRole('button', { name: 'Guardar tablero' }).click();
  await expect(tablero.locator('.board__heading')).toHaveText(nombre);
}

/**
 * Borra los tableros y conjuntos cuyo nombre encaje, empezando por los tableros.
 *
 * Una ejecución que se corta antes de limpiar deja los suyos en los datos de
 * prueba, y salen en las capturas siguientes. Esto los quita.
 */
export async function borrarRestos(reportes: Locator, tableros: RegExp, conjuntos: RegExp): Promise<void> {
  const tablero = reportes.locator('app-report-dashboard');

  // Las listas llegan después de abrir: contar antes daría cero y no borraría nada.
  await expect(reportes.locator('.rail__hint', { hasText: 'Cargando' })).toHaveCount(0, { timeout: 30_000 });
  const deTableros = reportes.locator('.datasets__item').filter({ has: reportes.page().locator('app-icon') });

  for (let item = deTableros.filter({ hasText: tableros }); (await item.count()) > 0; ) {
    const antes = await item.count();

    await item.first().click();
    await tablero.getByRole('button', { name: 'Editar diseño' }).click();
    await tablero.getByRole('button', { name: 'Borrar este tablero' }).click();
    await tablero.locator('.inspector').getByRole('button', { name: 'Borrar', exact: true }).click();
    await expect(item).toHaveCount(antes - 1);
  }

  const deConjuntos = reportes.locator('.datasets__item').filter({ hasNot: reportes.page().locator('app-icon') });

  for (let item = deConjuntos.filter({ hasText: conjuntos }); (await item.count()) > 0; ) {
    const antes = await item.count();

    await item.first().click();
    await reportes.locator('.steps__item').first().click();
    await reportes.getByRole('button', { name: 'Borrar este conjunto de datos' }).click();
    await reportes.locator('.confirm').getByRole('button', { name: 'Borrar' }).click();
    await expect(item).toHaveCount(antes - 1);
  }
}

export async function previsualizar(reportes: Locator): Promise<void> {
  await reportes.getByRole('button', { name: 'Vista previa' }).click();
  await expect(reportes.getByRole('button', { name: 'Vista previa' })).toBeEnabled({ timeout: 60_000 });
}

/** Un conjunto con otros nombres de columna: el segundo usuario de una plantilla. */
export const PEDIDOS_SQL = `SELECT DATE '2026-01-01' AS fecha_pedido, region, monto::numeric(10,2) AS monto_total
FROM (VALUES ('Norte', 30), ('Sur', 50)) AS pedidos(region, monto)`;

/** Abre la galería de plantillas de tablero desde la lista de Tableros. */
export async function abrirGaleria(reportes: Locator): Promise<Locator> {
  await reportes.getByRole('button', { name: 'Tablero desde plantilla' }).click();
  const galeria = reportes.page().locator('app-report-template-gallery');

  await expect(galeria.locator('.sheet')).toBeVisible();
  await expect(galeria.locator('.placeholder', { hasText: 'Cargando' })).toHaveCount(0, { timeout: 30_000 });
  return galeria;
}

/** Borra las plantillas de tablero cuyo nombre encaje y cierra la galería. */
export async function borrarPlantillas(reportes: Locator, nombres: RegExp): Promise<void> {
  const galeria = await abrirGaleria(reportes);

  for (let tarjeta = galeria.locator('.card').filter({ hasText: nombres }); (await tarjeta.count()) > 0; ) {
    const antes = await tarjeta.count();

    await tarjeta.first().getByRole('button', { name: /^Borrar la plantilla/ }).click();
    await tarjeta.first().getByRole('button', { name: 'Borrar', exact: true }).click();
    await expect(tarjeta).toHaveCount(antes - 1);
  }

  await reportes.page().keyboard.press('Escape');
  await expect(galeria).toHaveCount(0);
}
