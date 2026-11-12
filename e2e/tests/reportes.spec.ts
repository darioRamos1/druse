import { readFileSync } from 'node:fs';

import { expect, test, type Locator } from '@playwright/test';

import { abrir, conectar } from '../support/druse';
import {
  METAS_SQL,
  PEDIDOS_SQL,
  VENTAS_SQL,
  abrirGaleria,
  abrirReportes,
  abrirVisualizacion,
  actualizar,
  anadirFuente,
  borrarPlantillas,
  borrarRestos,
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

test.describe('Plantillas de Reportes BI', () => {
  /**
   * El criterio del hito 4.3: diseñar un tablero, guardarlo como plantilla,
   * compartirla como archivo y aplicarla a otra fuente con nombres de columna
   * distintos. La copia es independiente y se dibuja con sus propios datos.
   */
  test('guarda un tablero como plantilla, la exporta, la importa y la aplica a otra fuente', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const reportes = await abrirReportes(page);
    const marca = Date.now();
    const plantilla = `E2E Plantilla ${marca}`;
    const restos = new RegExp(`E2E Plantilla.*${marca}`);

    // Lo que dejara una ejecución cortada antes de limpiar no debe confundir a esta.
    await borrarPlantillas(reportes, /E2E Plantilla \d+/);
    await borrarRestos(reportes, /E2E Plantilla/, /E2E Plantilla/);

    // --- Origen: ventas por municipio en un tablero con filtros ----------------
    await reportes.getByLabel('Nombre del conjunto de datos').fill(`E2E Plantilla ventas ${marca}`);
    await anadirFuente(reportes, 'Ventas', VENTAS_SQL);
    await previsualizar(reportes);

    if (await reportes.locator('.diagnostic--danger', { hasText: 'contraseña guardada' }).isVisible()) {
      test.info().annotations.push({ type: 'sin llavero', description: 'La fuente pidió la contraseña.' });
      return;
    }

    await reportes.getByRole('button', { name: 'Guardar', exact: true }).click();
    await abrirVisualizacion(reportes);
    await actualizar(reportes);
    await elegirColumna(reportes.locator('.inspector').getByLabel('Agrupar por'), 'municipio');
    await expect(reportes.locator('.chart__bar')).toHaveCount(3);
    await reportes.locator('.inspector').getByLabel('Nombre del reporte').fill(`Ventas ${marca}`);
    await reportes.getByRole('button', { name: 'Guardar reporte' }).click();
    await crearTablero(reportes, `E2E Plantilla tablero ${marca}`, [`Ventas ${marca}`]);

    const tablero = reportes.locator('app-report-dashboard');

    await tablero.getByRole('button', { name: 'Guardar como plantilla' }).click();
    await tablero.locator('.template-form').getByLabel('Nombre de la plantilla').fill(plantilla);
    await tablero.getByRole('button', { name: 'Guardar plantilla' }).click();
    await expect(tablero.locator('.banner--success')).toContainText(`Plantilla «${plantilla}» guardada.`);

    // --- Destino: otro conjunto con otros nombres de columna --------------------
    await reportes.getByRole('button', { name: 'Nuevo conjunto de datos' }).click();
    await reportes.getByLabel('Nombre del conjunto de datos').fill(`E2E Plantilla pedidos ${marca}`);
    await anadirFuente(reportes, 'Pedidos', PEDIDOS_SQL);
    await previsualizar(reportes);
    await reportes.getByRole('button', { name: 'Guardar', exact: true }).click();
    await abrirVisualizacion(reportes);
    await actualizar(reportes);

    // --- Exportar, borrar e importar: el archivo es lo que se comparte ----------
    const galeria = await abrirGaleria(reportes);
    const tarjeta = galeria.locator('.card', { hasText: plantilla });
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      tarjeta.getByRole('button', { name: 'Exportar' }).click(),
    ]);
    const archivo = await descarga.path();
    const contenido = readFileSync(archivo, 'utf-8');

    expect(descarga.suggestedFilename()).toBe(`${plantilla}.druse-plantilla.json`);
    expect(contenido).toContain('"format": "druse.report-template"');
    expect(contenido).not.toMatch(/SELECT|connectionId|"sql"|"rows"/i);

    await tarjeta.getByRole('button', { name: /^Borrar la plantilla/ }).click();
    await tarjeta.getByRole('button', { name: 'Borrar', exact: true }).click();
    await expect(tarjeta).toHaveCount(0);

    await galeria.locator('input[type="file"]').setInputFiles(archivo);
    await expect(galeria.locator('.sheet__title')).toHaveText('Importar plantilla');
    await expect(galeria.locator('.card--preview')).toContainText('municipio · texto');
    await galeria.getByRole('button', { name: 'Guardar en mis plantillas' }).click();
    await expect(galeria.locator('.banner--success')).toContainText('importada');

    // --- Aplicar a los pedidos: la vinculación se propone por tipo -------------
    await galeria.locator('.card', { hasText: plantilla }).getByRole('button', { name: 'Usar' }).click();
    await galeria.getByRole('combobox', { name: 'Conjunto de datos', exact: true }).selectOption({ label: `E2E Plantilla pedidos ${marca}` });

    const campo = (nombre: string) => galeria.locator('.fields__row', { hasText: nombre }).locator('select');

    await expect(campo('municipio')).toHaveValue('region');
    await expect(campo('venta')).toHaveValue('monto_total');
    await expect(campo('mes')).toHaveValue('fecha_pedido');
    await galeria.getByRole('button', { name: 'Crear copia' }).click();

    await expect(tablero.locator('.board__heading')).toHaveText(plantilla);
    await expect(tablero.locator('.panel .chart__bar')).toHaveCount(2);
    await expect(tablero.locator('.panel')).toContainText(`Ventas ${marca}`);
    await expect(tablero.locator('.filter')).toHaveCount(2);
    await tablero.locator('.filter select').selectOption({ label: 'Sur' });
    await expect(tablero.locator('.panel .chart__bar')).toHaveCount(1);

    // Se deja como estaba: plantillas, tableros y conjuntos de esta ejecución.
    await borrarPlantillas(reportes, restos);
    await borrarRestos(reportes, restos, restos);
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
  });
});

/** Elige la opción cuyo texto acaba en el nombre de la columna, con o sin alias delante. */
async function elegirColumna(selector: Locator, columna: string): Promise<void> {
  const valor = await selector
    .locator('option')
    .filter({ hasText: new RegExp(`(^\\s*|\\.)${columna}\\s*$`) })
    .first()
    .getAttribute('value');

  await selector.selectOption(valor ?? '');
}

async function borrarConjunto(reportes: Locator): Promise<void> {
  await reportes.getByRole('button', { name: 'Borrar este conjunto de datos' }).click();
  await reportes.locator('.confirm').getByRole('button', { name: 'Borrar' }).click();
  await expect(reportes.locator('.datasets__item.is-active')).toHaveCount(0);
}
