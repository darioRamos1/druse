import { expect, test, type Locator, type Page } from '@playwright/test';

import { abrir, apuntarPestana, conectar, ejecutar, escribirSql } from '../support/druse';

/**
 * Barrido visual de toda la aplicación: recorre pantallas y diálogos, los
 * fotografía y anota lo que se puede medir.
 *
 * No es una prueba de regresión —no afirma nada— sino una herramienta para
 * mirar. Las capturas van fuera de `test-results` a propósito: Playwright limpia
 * esa carpeta en cada arranque y aquí interesa poder compararlas después.
 */
const SALIDA = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';

const hallazgos: string[] = [];

async function foto(page: Page, nombre: string, sitio?: Locator): Promise<void> {
  await (sitio ?? page).screenshot({ path: `${SALIDA}/${nombre}.png` });
}

/** Lo medible: qué no cabe, qué se corta y qué botón no dice lo que hace. */
async function medir(page: Page, donde: string): Promise<void> {
  const encontrado = await page.evaluate((sitio) => {
    const problemas: string[] = [];

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(element);

      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }

      const caja = element.getBoundingClientRect();

      if (caja.width === 0 || caja.height === 0 || element.closest('.monaco-editor')) {
        continue;
      }

      // Contenido que no cabe en un contenedor que además lo recorta.
      const recorta = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const sobra = element.scrollWidth - element.clientWidth;

      if (recorta && sobra > 2 && element.children.length === 0 && element.textContent?.trim()) {
        problemas.push(`${sitio}: «${element.textContent.trim().slice(0, 32)}» se corta (${sobra}px)`);
      }

      // Alto que se desborda sin poder desplazarse.
      const sobraAlto = element.scrollHeight - element.clientHeight;

      if (style.overflowY === 'hidden' && sobraAlto > 4 && element.children.length > 0) {
        problemas.push(
          `${sitio}: <${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}> esconde ${sobraAlto}px de alto`,
        );
      }
    }

    for (const boton of Array.from(document.querySelectorAll('button'))) {
      const texto = boton.textContent?.trim() ?? '';
      const nombre = boton.getAttribute('aria-label') ?? boton.getAttribute('title') ?? '';

      if (texto.length === 0 && nombre.length === 0) {
        problemas.push(`${sitio}: botón sin nombre accesible (.${String(boton.className).split(' ')[0]})`);
      }
    }

    return [...new Set(problemas)];
  }, donde);

  hallazgos.push(...encontrado);
}

/** Abre el menú de acciones de un nodo del árbol. */
async function menuDe(page: Page, nodo: string): Promise<void> {
  await page
    .locator('app-connections-sidebar .node', { hasText: nodo })
    .first()
    .getByRole('button', { name: `Acciones para ${nodo}` })
    .click();
}

async function desplegar(page: Page, nodo: string, hijo: string): Promise<void> {
  const sidebar = page.locator('app-connections-sidebar');
  const dentro = sidebar.getByText(hijo, { exact: true }).first();

  if (await dentro.isVisible().catch(() => false)) {
    return;
  }

  await sidebar.getByText(nodo, { exact: true }).first().click();
  await expect(dentro).toBeVisible({ timeout: 30_000 });
}

test.describe('barrido visual', () => {
  /**
   * No corre con la suite: no afirma nada y tarda casi un minuto.
   *
   * Se pide a mano cuando toca mirar la aplicación con calma:
   * `DRUSE_BARRIDO=1 npx playwright test tests/barrido.spec.ts`, y las capturas
   * salen donde diga `DRUSE_BARRIDO_DIR`.
   */
  test.skip(!process.env['DRUSE_BARRIDO'], 'El barrido se pide a mano.');

  test('recorre la aplicación entera', async ({ page }) => {
    const consola: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consola.push(message.text().slice(0, 140));
      }
    });

    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);
    await desplegar(page, 'druse_test', 'public');
    await desplegar(page, 'public', 'Tables');

    // --- Trabajo normal ----------------------------------------------------
    await escribirSql(
      page,
      `SELECT generate_series AS numero,
              'texto de ejemplo bastante largo para ver cómo respira la celda' AS descripcion,
              NULL::text AS vacio,
              now() AS cuando
       FROM generate_series(1, 40)`,
    );
    await ejecutar(page, 'todo');
    await expect(page.locator('.pager__range')).toBeVisible({ timeout: 30_000 });
    await medir(page, 'resultados');
    await foto(page, '01-resultados');

    // Pestañas del panel inferior.
    await page.getByRole('tab', { name: 'Mensajes' }).click().catch(() => {});
    await page.locator('app-results-panel').getByText('Mensajes').first().click();
    await page.waitForTimeout(200);
    await medir(page, 'mensajes');
    await foto(page, '02-mensajes');

    await page.locator('app-results-panel').getByText('Historial').first().click();
    await page.waitForTimeout(400);
    await medir(page, 'historial');
    await foto(page, '03-historial');

    await page.locator('app-results-panel').getByText('Resultados').first().click();

    // --- Una consulta que falla -------------------------------------------
    await escribirSql(page, 'SELECT * FROM tabla_que_no_existe');
    await ejecutar(page, 'todo');
    await page.waitForTimeout(500);
    await medir(page, 'error de consulta');
    await foto(page, '04-error');

    // --- Menú del árbol ----------------------------------------------------
    await menuDe(page, 'Tables');
    await page.waitForTimeout(200);
    await medir(page, 'menú del árbol');
    await foto(page, '05-menu-arbol');
    await page.keyboard.press('Escape');
    await page.locator('app-sql-editor').click();

    // --- Paleta de comandos ------------------------------------------------
    // Por su botón y no por Ctrl+K: con el foco dentro de Monaco, el atajo es
    // suyo y no llega a la aplicación.
    await page.getByRole('button', { name: 'Abrir búsqueda global' }).click();
    await expect(page.locator('app-command-palette')).toBeVisible();
    await medir(page, 'paleta');
    await foto(page, '06-paleta');
    await page.keyboard.press('Escape');

    // --- Diálogos ----------------------------------------------------------
    const dialogos: [string, string, () => Promise<void>][] = [
      [
        '07-conexion',
        'app-connection-dialog',
        async () => page.getByRole('button', { name: 'Nueva conexión' }).click(),
      ],
      [
        '08-preferencias',
        'app-settings-dialog',
        async () => page.getByRole('button', { name: 'Preferencias' }).click(),
      ],
      [
        '09-disenador',
        'app-table-designer',
        async () => {
          await menuDe(page, 'Tables');
          await page.getByRole('menuitem', { name: 'Crear tabla' }).click();
        },
      ],
      [
        '10-respaldo',
        'app-backup-dialog',
        async () => {
          await menuDe(page, 'druse_test');
          await page.getByRole('menuitem', { name: 'Respaldar' }).click();
        },
      ],
      [
        '11-restaurar',
        'app-restore-dialog',
        async () => {
          await menuDe(page, 'druse_test');
          await page.getByRole('menuitem', { name: 'Restaurar' }).click();
        },
      ],
      [
        '12-migrar-varias',
        'app-transfer-set-dialog',
        async () => {
          await menuDe(page, 'Tables');
          await page.getByRole('menuitem', { name: 'Migrar tablas a…' }).click();
        },
      ],
    ];

    for (const [nombre, selector, abrirlo] of dialogos) {
      await abrirlo();

      const dialogo = page.locator(selector);

      await expect(dialogo).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(500);
      await medir(page, nombre);
      await foto(page, nombre, dialogo.locator('.dialog').first());
      await page.keyboard.press('Escape');
      await expect(dialogo).toBeHidden({ timeout: 10_000 });
    }

    // --- El asistente de una tabla, con sus pasos --------------------------
    await desplegar(page, 'Tables', 'accionista');
    await menuDe(page, 'accionista');
    await page.getByRole('menuitem', { name: 'Migrar datos a…' }).click();

    const traslado = page.locator('app-transfer-dialog');

    await expect(traslado).toBeVisible();
    await medir(page, 'migrar una tabla');
    await foto(page, '13-migrar-una', traslado.locator('.dialog'));
    await page.keyboard.press('Escape');

    // --- Tema claro en las dos pantallas que más se miran ------------------
    await page.getByRole('button', { name: 'Tema claro' }).click();
    await page.waitForTimeout(400);
    await escribirSql(page, 'SELECT 1 AS uno, 2 AS dos, 3 AS tres');
    await ejecutar(page, 'todo');
    await page.waitForTimeout(300);
    await medir(page, 'claro: resultados');
    await foto(page, '14-claro-resultados');

    await page.getByRole('button', { name: 'Nueva conexión' }).click();
    await expect(page.locator('app-connection-dialog')).toBeVisible();
    await medir(page, 'claro: conexión');
    await foto(page, '15-claro-conexion', page.locator('app-connection-dialog .dialog'));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Tema oscuro' }).click();

    // --- Anchos ------------------------------------------------------------
    for (const ancho of [1440, 1024, 900]) {
      await page.setViewportSize({ width: ancho, height: 760 });
      await page.waitForTimeout(400);
      await medir(page, `ancho ${ancho}`);
      await foto(page, `16-ancho-${ancho}`);
    }

    console.log('=== HALLAZGOS ===');
    console.log([...new Set(hallazgos)].join('\n') || '(ninguno)');
    console.log('=== CONSOLA ===');
    console.log([...new Set(consola)].join('\n') || '(limpia)');
  });
});
