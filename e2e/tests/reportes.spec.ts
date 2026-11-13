import { readFileSync, writeFileSync } from 'node:fs';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  CONTENEDOR,
  SQLSERVER,
  abrir,
  conectar,
  conectarSqlServer,
  escribirSql,
  esperarFinDeConsulta,
} from '../support/druse';
import {
  METAS_SQL,
  PEDIDOS_SQL,
  VENTAS_SQL,
  VENTAS_SQLSERVER_SQL,
  abrirGaleria,
  abrirReportes,
  abrirVisualizacion,
  actualizar,
  anadirFuente,
  borrarPlantillas,
  borrarRestos,
  crearTablero,
  faltaContrasena,
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
    if (await faltaContrasena(reportes)) {
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

/** Un PNG de 1 × 1, suficiente para que el encabezado tenga logo. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test.describe('Plantillas de Reportes BI', () => {
  /**
   * El criterio del hito 4.3: diseñar un tablero, guardarlo como plantilla,
   * compartirla como archivo y aplicarla a otra fuente con nombres de columna
   * distintos. La copia es independiente y se dibuja con sus propios datos.
   *
   * Y el de la fase 4 de la identidad de empresa: el tablero tiene una y se
   * incluye a propósito. Antes de importar se borra, como en un perfil limpio:
   * al aplicar la plantilla se crea de nuevo y el tablero sale igual.
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

    const identidad = crypto.randomUUID();
    const empresa = `E2E Plantilla Andina ${marca}`;
    expect(
      (
        await page.request.put(`/api/reports/identities/${identidad}`, {
          data: { name: empresa, details: ['NIT 900.123.456-7'], brandColor: '#C2185B' },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (await page.request.put(`/api/reports/identities/${identidad}/logo`, { data: { data: PNG } })).ok(),
    ).toBe(true);
    // Se vuelve a abrir para que el constructor la tenga en su lista.
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
    await abrirReportes(page);

    // --- Origen: ventas por municipio en un tablero con filtros ----------------
    await reportes.getByLabel('Nombre del conjunto de datos').fill(`E2E Plantilla ventas ${marca}`);
    await anadirFuente(reportes, 'Ventas', VENTAS_SQL);
    await previsualizar(reportes);

    if (await faltaContrasena(reportes)) {
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
    await crearTablero(reportes, `E2E Plantilla tablero ${marca}`, [`Ventas ${marca}`], empresa);

    const tablero = reportes.locator('app-report-dashboard');

    await tablero.getByRole('button', { name: 'Guardar como plantilla' }).click();
    await tablero.locator('.template-form').getByLabel('Nombre de la plantilla').fill(plantilla);
    // Desmarcada de entrada: el logo de una empresa solo viaja si se pide.
    const incluir = tablero.locator('.template-form').getByLabel(`Incluir la identidad de «${empresa}»`);
    await expect(incluir).not.toBeChecked();
    await incluir.check();
    const barrido = process.env['DRUSE_BARRIDO_DIR'];
    if (barrido) {
      await tablero.locator('.template-form').screenshot({ path: `${barrido}/reportes-plantilla-con-identidad.png` });
    }
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
    // La identidad va dentro, con su logo.
    const llevada = JSON.parse(contenido).identity;
    expect(llevada).toEqual(expect.objectContaining({ id: identidad, name: empresa }));
    expect(llevada.logo).toEqual({ contentType: 'image/png', data: PNG });

    await tarjeta.getByRole('button', { name: /^Borrar la plantilla/ }).click();
    await tarjeta.getByRole('button', { name: 'Borrar', exact: true }).click();
    await expect(tarjeta).toHaveCount(0);

    // Un perfil sin esa identidad: se borra y se vuelve a abrir Reportes.
    expect((await page.request.delete(`/api/reports/identities/${identidad}`)).ok()).toBe(true);
    await galeria.getByRole('button', { name: 'Cerrar' }).click();
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
    await abrirReportes(page);
    await expect(reportes.locator('.datasets__item--identity', { hasText: empresa })).toHaveCount(0);
    await abrirGaleria(reportes);

    await galeria.locator('input[type="file"]').setInputFiles(archivo);
    await expect(galeria.locator('.sheet__title')).toHaveText('Importar plantilla');
    await expect(galeria.locator('.card--preview')).toContainText('municipio · texto');
    await expect(galeria.locator('.card--preview')).toContainText(
      `Incluye la identidad de empresa «${empresa}» con su logo y sus datos.`,
    );
    await galeria.getByRole('button', { name: 'Guardar en mis plantillas' }).click();
    await expect(galeria.locator('.banner--success')).toContainText('importada');

    // --- Aplicar a los pedidos: la vinculación se propone por tipo -------------
    await galeria.locator('.card', { hasText: plantilla }).getByRole('button', { name: 'Usar' }).click();
    await galeria.getByRole('combobox', { name: 'Conjunto de datos', exact: true }).selectOption({ label: `E2E Plantilla pedidos ${marca}` });

    const campo = (nombre: string) => galeria.locator('.fields__row', { hasText: nombre }).locator('select');

    await expect(campo('municipio')).toHaveValue('region');
    await expect(campo('venta')).toHaveValue('monto_total');
    await expect(campo('mes')).toHaveValue('fecha_pedido');
    await expect(galeria.locator('.identity')).toContainText('No la tienes: se añadirá a tus identidades');
    await expect(galeria.locator('.identity').getByRole('checkbox')).toBeChecked();
    if (barrido) {
      await galeria.locator('.sheet').screenshot({ path: `${barrido}/reportes-plantilla-aplicar-identidad.png` });
    }
    await galeria.getByRole('button', { name: 'Crear copia' }).click();

    // La identidad vuelve a existir, con el mismo id, y el tablero la lleva.
    await expect(reportes.locator('.datasets__item--identity', { hasText: empresa })).toHaveCount(1);
    const encabezado = tablero.locator('app-report-identity-header');
    await expect(encabezado).toContainText(empresa);
    await expect(encabezado).toContainText('NIT 900.123.456-7');
    await expect(encabezado.locator('img')).toHaveAttribute('alt', empresa);
    expect((await page.request.get(`/api/reports/identities/${identidad}/logo`)).ok()).toBe(true);

    await expect(tablero.locator('.board__heading')).toHaveText(plantilla);
    await expect(tablero.locator('.panel .chart__bar')).toHaveCount(2);
    await expect(tablero.locator('.panel')).toContainText(`Ventas ${marca}`);
    await expect(tablero.locator('.filter')).toHaveCount(2);
    await tablero.locator('.filter select').selectOption({ label: 'Sur' });
    await expect(tablero.locator('.panel .chart__bar')).toHaveCount(1);

    // Se deja como estaba: plantillas, tableros, conjuntos e identidad de esta ejecución.
    await borrarPlantillas(reportes, restos);
    await borrarRestos(reportes, restos, restos);
    await page.request.delete(`/api/reports/identities/${identidad}`);
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
  });
});

test.describe('Exportar tableros de Reportes BI', () => {
  /**
   * El criterio del hito 4.4: con un filtro de mes activo y la conexión
   * cerrada, exportar un panel y el tablero. Las cifras tienen que ser las de
   * la vista: el libro y el CSV salen del resultado guardado, ya filtrado.
   *
   * Y el de la fase 3 de la identidad de empresa: el tablero tiene una, así
   * que el libro lleva su logo en el resumen y el PDF su encabezado, su franja
   * de marca y un pie con su texto y el número de página.
   */
  test('exporta el tablero y un panel con el filtro de mes activo y la conexión cerrada', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const marca = Date.now();
    const restos = /E2E Exportar/;
    let reportes = await abrirReportes(page);

    await borrarRestos(reportes, restos, restos);

    // Un logo de verdad, dibujado en el navegador: el de 1 × 1 no se vería en las capturas.
    const identidad = crypto.randomUUID();
    const empresa = `E2E Exportar Andina ${marca}`;
    const logo = await page.evaluate(() => {
      const lienzo = document.createElement('canvas');
      lienzo.width = 240;
      lienzo.height = 80;
      const dibujo = lienzo.getContext('2d')!;
      dibujo.fillStyle = '#C2185B';
      dibujo.fillRect(0, 0, 80, 80);
      dibujo.fillStyle = '#1d2230';
      dibujo.font = 'bold 34px sans-serif';
      dibujo.fillText('ANDINA', 92, 54);
      return lienzo.toDataURL('image/png').split(',')[1];
    });
    expect(
      (
        await page.request.put(`/api/reports/identities/${identidad}`, {
          data: {
            name: empresa,
            subtitle: 'Informe mensual de ventas',
            details: ['NIT 900.123.456-7', 'Calle 10 # 20-30, Bogotá'],
            footer: 'Confidencial',
            brandColor: '#C2185B',
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (await page.request.put(`/api/reports/identities/${identidad}/logo`, { data: { data: logo } })).ok(),
    ).toBe(true);
    await page.keyboard.press('Escape');
    reportes = await abrirReportes(page);

    await reportes.getByLabel('Nombre del conjunto de datos').fill(`E2E Exportar ${marca}`);
    await anadirFuente(reportes, 'Ventas', VENTAS_SQL);
    await previsualizar(reportes);

    if (await faltaContrasena(reportes)) {
      test.info().annotations.push({ type: 'sin llavero', description: 'La fuente pidió la contraseña.' });
      return;
    }

    await anadirFuente(reportes, 'Metas', METAS_SQL);
    await previsualizar(reportes);
    await reportes.locator('.steps__item').nth(1).click();
    await previsualizar(reportes);
    await reportes.getByRole('button', { name: 'Guardar', exact: true }).click();
    await abrirVisualizacion(reportes);
    await actualizar(reportes);

    await reportes.locator('.inspector').getByLabel('Agrupar por').selectOption({ label: 'Ventas.municipio' });
    await reportes.locator('.inspector').getByLabel('Nombre del reporte').fill(`Barras ${marca}`);
    await reportes.getByRole('button', { name: 'Guardar reporte' }).click();
    await reportes.getByRole('button', { name: 'Nuevo reporte' }).click();
    await reportes.getByRole('radio', { name: 'Indicador' }).click();
    await reportes.locator('.inspector').getByLabel('Nombre del reporte').fill(`Cumplimiento ${marca}`);
    await reportes.getByRole('button', { name: 'Guardar reporte' }).click();
    await crearTablero(reportes, `E2E Exportar tablero ${marca}`, [`Barras ${marca}`, `Cumplimiento ${marca}`], empresa);

    // Se cierra la conexión: lo que se exporta sale de reports.db, no de la base.
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
    const conexion = page.locator('app-connections-sidebar .node--connection', { hasText: CONTENEDOR.nombre }).first();

    await conexion.locator('.connection-menu-trigger').click();
    await conexion.locator('[title="Desconectar"]').click();
    await expect(conexion).toHaveClass(/is-offline/, { timeout: 30_000 });

    reportes = await abrirReportes(page);
    await reportes.locator('.datasets__item', { hasText: `E2E Exportar tablero ${marca}` }).first().click();
    const tablero = reportes.locator('app-report-dashboard');

    await expect(tablero.locator('.filter input[type="date"]')).toHaveCount(2);
    const [desde, hasta] = await tablero.locator('.filter input[type="date"]').all();

    await desde.fill('2026-01-01');
    await desde.dispatchEvent('change');
    await hasta.fill('2026-01-31');
    await hasta.dispatchEvent('change');
    await expect(tablero.locator('.panel .indicator__value')).toHaveText(/60\s?%/);

    // --- Excel del tablero: un libro con su gráfico nativo ----------------------
    await tablero.getByRole('button', { name: 'Exportar', exact: true }).click();
    await expect(tablero.locator('.menu')).toContainText('Se exporta con los filtros activos.');
    const [libro] = await Promise.all([
      page.waitForEvent('download'),
      tablero.getByRole('menuitem', { name: 'Excel (.xlsx)' }).click(),
    ]);
    const bytes = readFileSync(await libro.path());

    expect(libro.suggestedFilename()).toBe(`E2E Exportar tablero ${marca}.xlsx`);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    // Los nombres de las partes del ZIP van sin comprimir: se ve que hay gráfico y cuatro hojas.
    const partes = bytes.toString('latin1');

    expect(partes).toMatch(/charts\/chart\d*\.xml/);
    expect(partes.match(/xl\/worksheets\/sheet\d+\.xml/g)?.length).toBeGreaterThanOrEqual(4);
    // Y el logo de la empresa, como imagen del resumen.
    expect(partes).toMatch(/xl\/media\/image\d*\.png/);

    // --- CSV de un panel: exactamente las barras que se ven ---------------------
    const barras = tablero.locator('.panel', { hasText: `Barras ${marca}` });

    await barras.getByRole('button', { name: `Exportar Barras ${marca}` }).click();
    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      barras.getByRole('menuitem', { name: 'CSV · lo que se ve' }).click(),
    ]);

    expect(readFileSync(await csv.path(), 'utf-8')).toBe(
      '﻿Ventas.municipio,Suma · Ventas.venta\r\n05001,80\r\n08001,100\r\n11001,40\r\n',
    );

    // --- PDF: la vista de impresión con filtros y fecha de los datos ------------
    await tablero.getByRole('button', { name: 'Exportar', exact: true }).click();
    await tablero.getByRole('menuitem', { name: 'PDF…' }).click();
    const vista = page.locator('body > app-report-print');

    await expect(vista.locator('.paper__title')).toHaveText(`E2E Exportar tablero ${marca}`);
    const papel = vista.locator('.paper__identity');

    await expect(papel).toContainText(empresa);
    await expect(papel).toContainText('NIT 900.123.456-7 · Calle 10 # 20-30, Bogotá');
    await expect(papel.locator('img')).toHaveAttribute('alt', empresa);
    // Es papel: la marca va en su tono claro, aunque Druse esté en oscuro.
    expect(
      await vista.evaluate((element) => getComputedStyle(element).getPropertyValue('--rc-brand-light').trim()),
    ).toBe('#C2185B');
    // Un <style> no se pinta: su texto se lee con textContent.
    expect(await page.locator('#druse-report-print-page').evaluate((style) => style.textContent)).toMatch(
      /@bottom-left \{ content: "Confidencial".*"Página " counter\(page\) " de " counter\(pages\)/,
    );
    await expect(vista.locator('.paper__filters')).toContainText('Fecha: 1 ene 2026 – 31 ene 2026');
    await expect(vista.locator('.paper .indicator__value')).toHaveText(/60\s?%/);
    await expect(vista.locator('.panel__meta').first()).toContainText('Datos del');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Lo que saldría por la impresora: solo el papel, en A4 apaisado.
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const barrido = process.env['DRUSE_BARRIDO_DIR'];
    if (barrido) {
      writeFileSync(`${barrido}/reportes-exportar-identidad.pdf`, pdf);
      await page.screenshot({ path: `${barrido}/reportes-exportar-identidad.png`, fullPage: true });
    }
    await vista.getByRole('button', { name: 'Cerrar' }).click();
    await expect(vista).toHaveCount(0);

    // Se deja como estaba.
    await borrarRestos(reportes, restos, restos);
    await page.request.delete(`/api/reports/identities/${identidad}`);
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
  });

  /**
   * El criterio del hito 5 con un horario de verdad: se programa para el
   * minuto siguiente y, sin pulsar «Actualizar ahora», los datos llegan solos.
   * La API de las pruebas mira los horarios cada 2 s (`Reports__ScheduleTickSeconds`).
   */
  test('programa una actualización diaria y llega sola a su hora', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    await abrir(page);
    await conectar(page);

    const restos = /E2E Programar/;
    const reportes = await abrirReportes(page);

    await borrarRestos(reportes, restos, restos);
    await reportes.getByLabel('Nombre del conjunto de datos').fill(`E2E Programar ${Date.now()}`);
    await anadirFuente(reportes, 'Ventas', VENTAS_SQL);
    await previsualizar(reportes);

    if (await faltaContrasena(reportes)) {
      test.info().annotations.push({ type: 'sin llavero', description: 'La fuente pidió la contraseña.' });
      return;
    }

    await reportes.getByRole('button', { name: 'Guardar', exact: true }).click();
    await abrirVisualizacionSinDatos(reportes);

    // La hora del minuto siguiente en la zona del navegador, que es la que
    // propone el formulario; con menos de 15 s de margen, la del otro.
    const ahora = new Date(await page.evaluate(() => Date.now()));
    const objetivo = new Date(ahora.getTime() + (ahora.getSeconds() > 45 ? 120_000 : 60_000));
    const hora = await page.evaluate(
      (instante) =>
        new Date(instante).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
      objetivo.getTime(),
    );

    await reportes.getByRole('button', { name: 'Programar', exact: true }).click();
    const formulario = reportes.locator('form.schedule');

    await expect(formulario.getByRole('radio', { name: 'Diaria' })).toHaveAttribute('aria-checked', 'true');
    await formulario.getByLabel('Hora', { exact: true }).fill(hora);
    await formulario.getByRole('button', { name: 'Guardar programación' }).click();
    await expect(formulario).toHaveCount(0);
    await expect(reportes.locator('.freshness__schedule')).toContainText('Próxima actualización');

    // Nadie pulsa nada: el servidor la despacha y la pantalla la recoge sola.
    await expect(reportes.locator('.freshness')).toContainText('Datos del', { timeout: 150_000 });
    await expect(reportes.locator('.freshness')).toContainText('3 filas');
    await expect(reportes.locator('.freshness__schedule')).toContainText('Próxima actualización');
    await expect(reportes.locator('.banner--danger')).toHaveCount(0);

    // En pausa lo dice; quitarla deja la barra sin programación.
    await reportes.getByRole('button', { name: 'Programación', exact: true }).click();
    await formulario.getByLabel(/En pausa/).check();
    await formulario.getByRole('button', { name: 'Guardar programación' }).click();
    await expect(reportes.locator('.freshness__schedule')).toContainText('en pausa');
    await reportes.getByRole('button', { name: 'Programación', exact: true }).click();
    await formulario.getByRole('button', { name: 'Quitar programación' }).click();
    await expect(reportes.locator('.freshness__schedule')).toHaveCount(0);
    await expect(reportes.getByRole('button', { name: 'Programar', exact: true })).toBeVisible();

    // El historial cuenta la actualización programada; borrar los datos deja
    // el conjunto sin resultado, pero con su historial.
    await reportes.getByRole('button', { name: 'Historial', exact: true }).click();
    const historial = reportes.locator('app-report-history');

    await expect(historial.locator('.runs tbody tr').first()).toContainText('Programada');
    await expect(historial.locator('.runs tbody tr').first()).toContainText('Correcta');
    await expect(historial.locator('.space')).toContainText('de 512 MB');
    await historial.getByRole('button', { name: 'Borrar datos guardados' }).click();
    await historial.getByRole('button', { name: 'Borrar datos', exact: true }).click();
    await expect(reportes.locator('.freshness')).toContainText('Todavía no hay datos guardados');
    await expect(historial.locator('.runs tbody tr')).toHaveCount(1);
    await expect(historial.getByRole('button', { name: 'Borrar datos guardados' })).toHaveCount(0);

    await reportes.locator('.steps__item').first().click();
    await borrarConjunto(reportes);
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
  });
});

test.describe('Reportes BI entre motores', () => {
  /**
   * El caso de validación del plan, de punta a punta y con dos motores: las
   * ventas en SQL Server y las metas en PostgreSQL. La unión izquierda da tres
   * filas, 220 en ventas y 60 % de cumplimiento con el municipio sin meta aparte.
   * El cruce lo hace .NET: ninguno de los dos motores ve al otro.
   */
  test('cruza ventas de SQL Server con metas de PostgreSQL y da el 60 %', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await abrir(page);
    await conectar(page);
    await conectarSqlServer(page);

    const restos = /E2E Multimotor/;
    const reportes = await abrirReportes(page);

    await borrarRestos(reportes, restos, restos);
    await reportes.getByLabel('Nombre del conjunto de datos').fill(`E2E Multimotor ${Date.now()}`);
    await anadirFuente(reportes, 'Ventas', VENTAS_SQLSERVER_SQL, SQLSERVER);
    await previsualizar(reportes);

    if (await faltaContrasena(reportes)) {
      test.info().annotations.push({ type: 'sin llavero', description: 'La fuente pidió la contraseña.' });
      return;
    }

    await expect(reportes.locator('.stats')).toContainText('3 filas');
    await anadirFuente(reportes, 'Metas', METAS_SQL);
    await previsualizar(reportes);
    await reportes.locator('.steps__item').nth(1).click();

    // Mes y municipio se llaman igual a los dos lados y tienen el mismo tipo,
    // aunque uno sea `date` de SQL Server y el otro `date` de PostgreSQL.
    await expect(reportes.locator('.pair')).toHaveCount(2);
    await previsualizar(reportes);
    await expect(reportes.locator('.summary')).toContainText('3');
    await expect(reportes.locator('tbody tr')).toHaveCount(3);
    await expect(reportes.locator('.diagnostic--danger')).toHaveCount(0);

    await reportes.getByRole('button', { name: 'Guardar', exact: true }).click();
    await abrirVisualizacion(reportes);
    await actualizar(reportes);
    await expect(reportes.locator('.freshness')).toContainText('3 filas');
    // Dos motores, dos lecturas: la barra dice entre qué momentos se leyeron.
    await expect(reportes.locator('.freshness')).toContainText('fuentes leídas entre');

    await reportes.getByRole('radio', { name: 'Indicador' }).click();
    await expect(reportes.locator('.indicator__value')).toHaveText(/60\s?%/);
    await expect(reportes.locator('.indicator')).toContainText('180 de 300');
    await expect(reportes.locator('.indicator')).toContainText('1 fila sin meta');

    await reportes.getByRole('radio', { name: 'Tabla' }).click();
    await expect(reportes.locator('app-report-chart tbody tr')).toHaveCount(3);

    await reportes.locator('.steps__item').first().click();
    await borrarConjunto(reportes);
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
  });
});

/** El paso Visualización de un conjunto recién guardado, todavía sin resultado. */
test.describe('Identidades de empresa', () => {
  /**
   * Un logo SVG con un script dentro: el script no se ejecuta y lo que se guarda
   * es un PNG. Un texto renombrado a .png se rechaza antes de llegar a ningún sitio.
   */
  test('crea una identidad con logo y color, y se reabre igual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await abrir(page);

    const reportes = await abrirReportes(page);
    const nombre = `Comercial Andina ${Date.now()}`;

    await reportes.getByRole('button', { name: 'Nueva identidad de empresa' }).click();
    const editor = reportes.locator('app-report-identity-editor');
    await expect(editor.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    await editor.getByLabel('Nombre de la empresa').fill(nombre);
    await editor.getByLabel('Subtítulo').fill('Informe mensual de ventas');
    await editor.getByLabel('Línea de datos 1').fill('NIT 900.123.456-7');
    await editor.getByLabel('Línea de datos 2').fill('Cra. 7 # 12-34, Bogotá');
    await editor.getByLabel('Color de marca en hexadecimal').fill('#0A6CBF');
    await expect(editor.locator('.contrast')).toContainText('Tema claro: contraste');

    const archivo = editor.locator('input[type="file"]');
    await archivo.setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('esto no es una imagen'),
    });
    await expect(editor.getByRole('alert')).toContainText('No se pudo leer esa imagen');

    await archivo.setInputFiles({
      name: 'andina.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80">
           <rect width="240" height="80" rx="14" fill="#0A6CBF"/>
           <text x="22" y="54" font-size="38" font-family="Arial" fill="#fff">ANDINA</text>
           <script>window.__scriptDelLogo = true</script>
         </svg>`,
      ),
    });
    await expect(editor.locator('.sample__logo img')).toHaveCount(2);
    expect(await page.evaluate(() => (window as { __scriptDelLogo?: boolean }).__scriptDelLogo)).toBeUndefined();

    await editor.getByLabel('Poner fondo blanco al logo en el tema oscuro').check();
    await editor.getByRole('button', { name: 'Guardar' }).click();
    await expect(editor.getByRole('status').filter({ hasText: 'Identidad guardada' })).toBeVisible();

    const barrido = process.env['DRUSE_BARRIDO_DIR'];
    if (barrido) {
      await page.screenshot({ path: `${barrido}/reportes-identidad.png` });
    }

    // Cerrar y volver: todo sale de reports.db, y el logo es ya un PNG.
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
    const otraVez = await abrirReportes(page);
    await otraVez.locator('.datasets__item', { hasText: nombre }).first().click();
    const reabierto = otraVez.locator('app-report-identity-editor');
    await expect(reabierto.getByLabel('Nombre de la empresa')).toHaveValue(nombre);
    await expect(reabierto.getByLabel('Línea de datos 2')).toHaveValue('Cra. 7 # 12-34, Bogotá');
    await expect(reabierto.getByLabel('Color de marca en hexadecimal')).toHaveValue('#0A6CBF');
    await expect(reabierto.locator('.sample__logo img').first()).toHaveAttribute(
      'src',
      /^data:image\/png;base64,/,
    );
    await expect(reabierto.locator('.sample--dark .sample__logo--white')).toHaveCount(1);

    // Y se borra, con confirmación.
    await reabierto.getByRole('button', { name: 'Borrar' }).click();
    await reabierto.locator('.confirm').getByRole('button', { name: 'Borrar' }).click();
    await expect(otraVez.locator('.datasets__item', { hasText: nombre })).toHaveCount(0);
  });
});

test.describe('Tablero con identidad de empresa', () => {
  test('el tablero lleva su encabezado y su marca, y pierde las dos al borrar la identidad', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await abrir(page);

    const id = crypto.randomUUID();
    const empresa = `Andina ${Date.now()}`;
    const creada = await page.request.put(`/api/reports/identities/${id}`, {
      data: {
        name: empresa,
        subtitle: 'Informe mensual',
        details: ['NIT 900.123.456-7'],
        brandColor: '#C2185B',
      },
    });
    expect(creada.ok()).toBe(true);
    expect(
      (await page.request.put(`/api/reports/identities/${id}/logo`, { data: { data: PNG } })).ok(),
    ).toBe(true);

    const reportes = await abrirReportes(page);
    const nombre = `Tablero de ${empresa}`;
    await reportes.getByRole('button', { name: 'Nuevo tablero' }).click();
    const tablero = reportes.locator('app-report-dashboard');
    await tablero.getByLabel('Nombre del tablero').fill(nombre);
    await tablero.locator('.inspector').getByLabel('Identidad de empresa').selectOption({ label: empresa });

    const encabezado = tablero.locator('app-report-identity-header');
    await expect(encabezado).toContainText(empresa);
    await expect(encabezado).toContainText('NIT 900.123.456-7');
    await expect(encabezado.locator('img')).toHaveAttribute('alt', empresa);
    // La marca llega a los gráficos con sus dos tonos, y el tablero la hereda.
    expect(
      await tablero.evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--rc-brand-light').trim(),
      ),
    ).toBe('#C2185B');
    await expect(tablero.locator('#board-color option').first()).toHaveText('Color de marca');

    await tablero.getByRole('button', { name: 'Guardar tablero' }).click();
    await expect(tablero.locator('.board__heading')).toHaveText(nombre);

    const barrido = process.env['DRUSE_BARRIDO_DIR'];
    if (barrido) {
      await page.screenshot({ path: `${barrido}/reportes-tablero-identidad.png` });
    }

    // Al borrarla, el aviso dice qué tablero se queda sin ella.
    await reportes.locator('.datasets__item--identity', { hasText: empresa }).click();
    const editor = reportes.locator('app-report-identity-editor');
    await editor.getByRole('button', { name: 'Borrar' }).click();
    await expect(editor.locator('.confirm')).toContainText(nombre);
    await editor.locator('.confirm').getByRole('button', { name: 'Borrar' }).click();
    await expect(reportes.locator('.datasets__item--identity', { hasText: empresa })).toHaveCount(0);

    await reportes.locator('.datasets__item', { hasText: nombre }).click();
    await expect(tablero.locator('.board__heading')).toHaveText(nombre);
    await expect(tablero.locator('app-report-identity-header')).toHaveCount(0);

    await borrarRestos(reportes, new RegExp(`^\\s*${nombre}\\s*$`), /^$/);
  });
});

test.describe('Reportes BI con el lienzo', () => {
  /**
   * Una fuente compuesta en el lienzo del compositor, cruzada con otra en SQL.
   *
   * El lienzo necesita la sesión del explorador —`conectar` la abre—, así que
   * componer funciona también en CI. Leer la fuente usa la contraseña guardada,
   * y sin llavero se acaba ahí, como en las demás pruebas.
   */
  test('una fuente se compone en el lienzo, se guarda y se reabre igual', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const tabla = `e2e_lienzo_${Date.now()}`;
    await ejecutarConAviso(
      page,
      `DO $$ DECLARE t text; BEGIN
         FOR t IN SELECT tablename FROM pg_tables WHERE tablename LIKE 'e2e_lienzo_%' LOOP
           EXECUTE format('DROP TABLE %I', t);
         END LOOP;
       END $$;
       CREATE TABLE ${tabla} (municipio text, importe numeric(10,2));
       INSERT INTO ${tabla} VALUES ('05001', 50), ('05001', 30), ('08001', 100), ('11001', 40)`,
    );

    const reportes = await abrirReportes(page);
    const nombre = `E2E Lienzo ${Date.now()}`;
    await reportes.getByLabel('Nombre del conjunto de datos').fill(nombre);

    // La fuente: conexión y base como cualquier otra, y luego el modo visual.
    await reportes.getByRole('button', { name: 'Añadir fuente' }).first().click();
    const inspector = reportes.locator('.inspector');
    const conexion = inspector.locator('select').first();
    const valor = await conexion
      .locator('option', { hasText: CONTENEDOR.nombre })
      .first()
      .getAttribute('value');
    await conexion.selectOption(valor ?? '');
    await inspector.getByLabel('Alias').fill('Lienzo');
    const base = inspector.getByLabel('Base de datos');
    await base.fill(CONTENEDOR.base);
    await base.press('Tab');
    await inspector.getByRole('radio', { name: 'Visual' }).click();

    const leer = inspector.getByRole('button', { name: 'Leer las tablas de esta base' });
    if (await leer.isVisible()) {
      await leer.click();
    }
    // La tabla se creó después de conectar: lo leído al conectar no la tiene.
    await inspector.getByRole('button', { name: 'Volver a leer las tablas' }).click();
    const elegir = inspector.getByRole('combobox', { name: 'Elige la tabla principal' });
    await expect(elegir.locator('option', { hasText: tabla })).toHaveCount(1, { timeout: 60_000 });
    await elegir.selectOption(
      (await elegir.locator('option', { hasText: tabla }).getAttribute('value'))!,
    );
    await inspector.getByRole('button', { name: 'Componer en el lienzo' }).click();

    // El compositor se abre encima, solo para SELECT y ya en el lienzo.
    const builder = page.locator('app-query-builder');
    await expect(builder.locator('app-query-canvas .box')).toHaveCount(1);
    await expect(builder.getByRole('button', { name: 'INSERT' })).toHaveCount(0);
    await builder.getByLabel('Añadir a Agrupar por').selectOption('base:municipio');
    await builder.getByLabel('Añadir a Valores').selectOption('base:importe');
    await builder.getByLabel('Nombre del cálculo sobre importe').last().fill('venta');
    await builder.getByRole('button', { name: 'Quitar COUNT(*)' }).click();
    await expect(builder.locator('textarea.sql')).toHaveValue(/SUM\("importe"\) AS "venta"/);
    await builder.getByRole('button', { name: 'Usar en la fuente' }).click();
    await expect(builder).toHaveCount(0);

    await expect(inspector).toContainText(`Tabla principal: public.${tabla}`);
    await expect(inspector.locator('.sql--readonly')).toContainText('GROUP BY "municipio"');

    await previsualizar(reportes);
    if (await faltaContrasena(reportes)) {
      test.info().annotations.push({ type: 'sin llavero', description: 'La fuente pidió la contraseña.' });
      return;
    }
    await expect(reportes.locator('.stats')).toContainText('3 filas');

    await anadirFuente(reportes, 'Metas', METAS_SQL);
    await previsualizar(reportes);
    await reportes.locator('.steps__item').nth(1).click();
    await previsualizar(reportes);
    await reportes.getByRole('button', { name: 'Guardar' }).click();
    await expect(reportes.locator('.banner--success')).toContainText('versión 1');

    // Reabierta, la fuente vuelve al lienzo con lo que se compuso.
    await page.keyboard.press('Escape');
    await expect(reportes.locator('.dialog')).toBeHidden();
    const otraVez = await abrirReportes(page);
    await otraVez.locator('.datasets__item', { hasText: nombre }).first().click();
    await otraVez.locator('.steps__item').nth(0).click();
    // La primera fuente, la del lienzo, es la que queda activa al reabrir.
    await otraVez.locator('.inspector').getByRole('button', { name: 'Editar en el lienzo' }).click();
    await expect(builder.locator('.pill--group')).toContainText('municipio');
    const barrido = process.env['DRUSE_BARRIDO_DIR'];
    if (barrido) {
      await page.screenshot({ path: `${barrido}/reportes-fuente-lienzo.png` });
    }
    await expect(builder.locator('textarea.sql')).toHaveValue(/SUM\("importe"\) AS "venta"/);

    // Escape cierra el compositor y deja el constructor abierto.
    await page.keyboard.press('Escape');
    await expect(builder).toHaveCount(0);
    await expect(otraVez.locator('.dialog')).toBeVisible();
    if (barrido) {
      await page.screenshot({ path: `${barrido}/reportes-fuente-inspector.png` });
    }
    await borrarConjunto(otraVez);
  });

  async function ejecutarConAviso(page: Page, sql: string): Promise<void> {
    await escribirSql(page, sql);
    await page.keyboard.press('Control+Enter');

    // El aviso de sentencias que cambian datos sale según lo que lea el
    // analizador: un DROP dentro de un bloque DO, por ejemplo, no lo levanta.
    const aviso = page.getByRole('alertdialog');
    const avisa = await aviso
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (avisa) {
      await aviso.getByRole('button', { name: 'Ejecutar de todos modos' }).click();
      await expect(aviso).toBeHidden({ timeout: 30_000 });
    }
    await esperarFinDeConsulta(page);
  }
});

async function abrirVisualizacionSinDatos(reportes: Locator): Promise<void> {
  await abrirVisualizacion(reportes);
  await expect(reportes.locator('.freshness')).toContainText('Todavía no hay datos guardados');
}

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
