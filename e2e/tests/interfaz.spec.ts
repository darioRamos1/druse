import { expect, test } from '@playwright/test';

import { abrir, apuntarPestana, conectar, escribirSql } from '../support/druse';

/**
 * Lo que salió de mirar la aplicación con calma, convertido en guardarraíl.
 *
 * Son dos cosas que no se ven en una prueba de componente porque dependen de la
 * ventana entera y de Monaco: que Escape cierre lo que está encima, y que la
 * franja que el editor pega arriba tape lo que hay debajo en lugar de dejarlo
 * pasar.
 */
test.describe('la interfaz por dentro', () => {
  test('escape cierra los diálogos', async ({ page }) => {
    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    // El de conexión, que es el que más se abre.
    await page.getByRole('button', { name: 'Nueva conexión' }).click();
    await expect(page.locator('app-connection-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('app-connection-dialog')).toBeHidden();

    // Y preferencias, que es donde se vio que no lo hacía ninguno.
    await page.getByRole('button', { name: 'Preferencias' }).click();
    await expect(page.locator('app-settings-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('app-settings-dialog')).toBeHidden();
  });

  /**
   * Ctrl+K abre la búsqueda global **con el foco dentro del editor**.
   *
   * Monaco se queda con esa combinación —la usa como principio de sus propios
   * acordes—, así que el atajo que anuncia la barra de arriba solo funcionaba
   * fuera del editor, que es donde menos tiempo se pasa.
   */
  test('ctrl+k abre la búsqueda desde dentro del editor', async ({ page }) => {
    await abrir(page);

    await escribirSql(page, 'SELECT 1');
    await page.locator('app-sql-editor .monaco-editor textarea').first().focus();
    await page.keyboard.press('Control+k');

    await expect(page.locator('app-command-palette')).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('app-command-palette')).toBeHidden();
  });

  /**
   * El buscador del editor se puede encontrar sin saberse el atajo.
   *
   * Monaco lo trae desde siempre —`Ctrl+F` y `Ctrl+H`— y nada en la interfaz lo
   * decía: quien no venga de VS Code no tenía forma de saber que está.
   */
  test('la paleta ofrece buscar y reemplazar en el editor', async ({ page }) => {
    await abrir(page);
    await escribirSql(page, 'SELECT 1 AS uno');

    await page.getByRole('button', { name: 'Abrir búsqueda global' }).click();
    await page.locator('app-command-palette input').fill('reemplaz');
    await page.getByText('Buscar y reemplazar').first().click();

    // El buscador de Monaco, con su parte de reemplazo desplegada.
    const buscador = page.locator('.monaco-editor .find-widget');

    await expect(buscador).toBeVisible({ timeout: 10_000 });

    // `replaceToggled` es lo que distingue «buscar» de «buscar y reemplazar»:
    // el buscador es el mismo widget con su segunda fila desplegada.
    await expect(buscador).toHaveClass(/replaceToggled/);
    await expect(buscador.locator('.replace-part')).toBeVisible();
  });

  /**
   * Tras un alias, el desplegable trae **las columnas de su tabla**.
   *
   * Es lo que más se usa al escribir consultas de verdad, y lo que peor se
   * comprueba sin motor: hace falta el catálogo real, la resolución del alias y
   * que las columnas se pidan al vuelo aunque nadie haya abierto esa tabla en el
   * árbol.
   */
  test('tras un alias se sugieren las columnas de su tabla', async ({ page }) => {
    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    // Dos tablas con alias: si no distinguiera, saldrían las de la otra.
    await escribirSql(page, 'SELECT  FROM ciudad c JOIN accionista a ON a.id = c.id_ciudad');

    // El cursor, justo detrás de «SELECT ».
    await page.evaluate(() => {
      const editor = (window as unknown as { monaco: { editor: { getEditors(): any[] } } }).monaco
        .editor.getEditors()[0];

      editor.setPosition({ lineNumber: 1, column: 8 });
      editor.focus();
    });

    await page.keyboard.type('c.');
    await page.waitForTimeout(1500);

    const sugerencias = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('.monaco-editor .suggest-widget .monaco-list-row'),
      ).map((fila) => fila.textContent?.trim() ?? ''),
    );

    // Las de `ciudad`, con su tipo al lado; ninguna de `accionista`.
    expect(sugerencias.some((fila) => fila.startsWith('id_ciudad'))).toBe(true);
    expect(sugerencias.some((fila) => fila.startsWith('ciudad'))).toBe(true);
    expect(sugerencias.length).toBeLessThan(6);
  });

  /**
   * Bajando por un guion largo, Monaco deja pegada arriba la línea que abre el
   * bloque. Sin fondo propio se quedaba **escrita encima** del texto que pasaba
   * por debajo: el fondo del editor es transparente a propósito y esa franja lo
   * heredaba.
   */
  test('la franja pegada del editor tapa lo que pasa por debajo', async ({ page }) => {
    await abrir(page);

    // Un paréntesis que abarca muchas líneas, que es la forma del SQL de verdad
    // —un CTE, un IN largo— y lo que hace aparecer la franja.
    const cuerpo = Array.from({ length: 120 }, (_, i) => `    (${i + 1}, 'linea ${i + 1}'),`).join(
      '\n',
    );

    await escribirSql(
      page,
      `WITH datos (numero, texto) AS (\n  VALUES\n${cuerpo}\n    (999, 'fin')\n)\nSELECT * FROM datos;`,
    );

    await page.locator('app-sql-editor .monaco-editor').hover();
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(600);

    const franja = page.locator('app-sql-editor .monaco-editor .sticky-widget');

    await expect(franja).toBeVisible();

    const fondo = await franja.evaluate((element) => getComputedStyle(element).backgroundColor);

    // Opaco: cualquier cosa con alfa deja pasar el texto de debajo.
    expect(fondo).not.toContain('rgba');
    expect(fondo).not.toBe('transparent');
  });
});
