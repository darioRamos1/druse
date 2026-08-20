import { expect, test } from '@playwright/test';

import { abrir, apuntarPestana, conectar, escribirSql, situarCursor } from '../support/druse';

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

  test('comenta y descomenta las líneas seleccionadas', async ({ page }) => {
    await abrir(page);

    const original = 'SELECT 1 AS uno;\nSELECT 2 AS dos;';
    await escribirSql(page, original);

    await page.evaluate(() => {
      const editor = (window as unknown as { monaco: { editor: { getEditors(): any[] } } }).monaco
        .editor.getEditors()[0];
      const model = editor.getModel();

      editor.setSelection({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: model.getLineMaxColumn(2),
      });
      editor.focus();
    });

    const value = () =>
      page.evaluate(() =>
        (window as unknown as { monaco: { editor: { getEditors(): any[] } } }).monaco
          .editor.getEditors()[0]
          .getValue(),
      );

    await page.getByRole('button', { name: /Comentar/ }).click();
    await expect.poll(value).toBe('-- SELECT 1 AS uno;\n-- SELECT 2 AS dos;');

    await page.getByRole('button', { name: /Comentar/ }).click();
    await expect.poll(value).toBe(original);

    // Monaco conserva además el atajo estándar con el foco dentro del editor.
    await page.evaluate(() => {
      const editor = (window as unknown as { monaco: { editor: { getEditors(): any[] } } }).monaco
        .editor.getEditors()[0];

      editor.focus();
    });
    await page.keyboard.press('Control+/');
    await expect.poll(value).toBe('-- SELECT 1 AS uno;\n-- SELECT 2 AS dos;');
  });

  /**
   * El ciclo entero de un fragmento guardado: guardarlo, insertarlo y borrarlo.
   *
   * Es lo que más se pide en un editor de SQL después del autocompletado, y lo
   * que no se ve en una prueba de componente: el nombre se escribe en la propia
   * paleta, el texto sale del cursor de Monaco y lo guardado sobrevive en el
   * proceso local.
   */
  test('la paleta guarda un fragmento, lo inserta y lo borra', async ({ page }) => {
    await abrir(page);

    const nombre = `Fragmento ${Date.now()}`;

    await escribirSql(
      page,
      'SELECT 1 AS no_guardar;\nSELECT * FROM ciudad WHERE id_ciudad > 10;',
    );
    await situarCursor(page, 2, 10);

    // Guardar: la paleta pide el nombre en su propio campo.
    await page.getByRole('button', { name: 'Abrir búsqueda global' }).click();
    await page.locator('app-command-palette input').fill('fragmento');
    await page.getByText('Guardar como fragmento').first().click();

    const campo = page.locator('app-command-palette input');

    await expect(campo).toHaveAttribute('aria-label', 'Nombre del fragmento');
    await campo.fill(nombre);
    const guardado = page.waitForResponse(
      (response) =>
        response.url().includes('/api/workspace/snippets') &&
        response.request().method() === 'PUT' &&
        response.ok(),
    );
    await campo.press('Enter');
    await guardado;

    await expect(page.locator('app-command-palette')).toBeHidden();

    // Insertar: en una pestaña nueva y vacía, para que el texto solo pueda venir
    // del fragmento.
    await page.getByRole('button', { name: 'Nueva consulta' }).first().click();
    await escribirSql(page, '');

    await page.keyboard.press('Control+k');
    await page.locator('app-command-palette input').fill(nombre);

    // Con Enter y no con un clic sobre el nombre: el aviso de «guardado» lleva
    // el mismo texto y vive debajo del velo de la paleta.
    await expect(page.locator('app-command-palette')).toContainText(nombre);
    await page.keyboard.press('Enter');

    await expect(page.locator('app-sql-editor .monaco-editor')).toContainText(
      'FROM ciudad',
      { timeout: 10_000 },
    );
    await expect(page.locator('app-sql-editor .monaco-editor')).not.toContainText('no_guardar');

    // Insertar usa la pila de Monaco, no reemplaza el modelo desde fuera.
    const canUndo = await page.evaluate(() => {
      const editor = (window as unknown as { monaco: { editor: { getEditors(): any[] } } }).monaco
        .editor.getEditors()[0];

      editor.focus();

      return editor.getModel().canUndo();
    });

    expect(canUndo).toBe(true);
    await page.keyboard.press('Control+z');
    const afterUndo = await page.evaluate(() => {
      const editor = (window as unknown as { monaco: { editor: { getEditors(): any[] } } }).monaco
        .editor.getEditors()[0];

      return editor.getValue();
    });
    expect(afterUndo).toBe('');
    await expect(page.locator('app-sql-editor .monaco-editor')).not.toContainText('FROM ciudad');

    // Se vuelve a insertar para completar el ciclo con el mismo fragmento.
    await page.keyboard.press('Control+k');
    await page.locator('app-command-palette input').fill(nombre);
    await page.keyboard.press('Enter');
    await expect(page.locator('app-sql-editor .monaco-editor')).toContainText('FROM ciudad');

    // Borrar: la primera pulsación pregunta y la segunda borra.
    await page.keyboard.press('Control+k');
    await page.locator('app-command-palette input').fill(nombre);
    await page.keyboard.press('Shift+Delete');

    await expect(page.locator('app-command-palette')).toContainText('otra vez');

    const borrado = page.waitForResponse(
      (response) =>
        response.url().includes('/api/workspace/snippets/') &&
        response.request().method() === 'DELETE' &&
        response.ok(),
    );
    await page.keyboard.press('Shift+Delete');
    await borrado;
    await page.keyboard.press('Escape');

    // Y ya no está, ni siquiera tras volver a preguntarle al proceso local.
    await page.reload();
    await expect(page.locator('app-sql-editor .monaco-editor')).toBeVisible({ timeout: 90_000 });
    await page.keyboard.press('Control+k');
    await page.locator('app-command-palette input').fill(nombre);

    await expect(page.locator('app-command-palette')).toContainText('No hay coincidencias');
  });

  test('la interfaz estrecha no solapa controles y conserva sus menús', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 760 });
    await abrir(page);

    const toolbar = page.locator('app-editor-toolbar');
    const compactLabel = toolbar.locator('.run .label');
    const compactBox = await compactLabel.boundingBox();
    const toolbarBox = await toolbar.boundingBox();

    expect(compactBox?.width).toBeLessThanOrEqual(1);
    expect(toolbarBox?.height).toBeLessThanOrEqual(44);

    // Aunque el texto esté visualmente recogido, sigue nombrando el botón y el
    // desplegable queda por encima de Monaco y recibe el clic.
    await toolbar.getByRole('button', { name: /Filas/ }).click();
    await expect(toolbar.getByRole('listbox')).toBeVisible();

    const historyBox = await page.getByRole('tab', { name: 'Historial' }).boundingBox();
    const filtersBox = await page.getByRole('button', { name: 'Filtros' }).boundingBox();

    expect(historyBox && filtersBox).not.toBeNull();
    expect(
      historyBox!.x + historyBox!.width > filtersBox!.x &&
      filtersBox!.x + filtersBox!.width > historyBox!.x &&
      historyBox!.y + historyBox!.height > filtersBox!.y &&
      filtersBox!.y + filtersBox!.height > historyBox!.y,
    ).toBe(false);

    await page.setViewportSize({ width: 1440, height: 760 });
    await expect.poll(async () => (await compactLabel.boundingBox())?.width ?? 0).toBeGreaterThan(1);
  });

  test('el chip de conexión abre su menú por encima del editor', async ({ page }) => {
    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    const toolbar = page.locator('app-editor-toolbar');
    const chip = toolbar.locator('.context .chip');

    await expect(chip).toBeEnabled();
    await chip.click();

    const menu = toolbar.locator('.context__menu');

    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();

    const geometry = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      return {
        top: rect.top,
        bottom: rect.bottom,
        zIndex: Number(style.zIndex),
        viewportHeight: window.innerHeight,
      };
    });

    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.zIndex).toBeGreaterThan(0);

    // Visible no basta: una caja detrás de Monaco también cuenta como visible
    // para Playwright. La opción tiene que recibir el clic y cerrar el menú.
    await menu.locator('.context__option').first().click();
    await expect(menu).toBeHidden();
  });

  test('el degradado de las listas desaparece al llegar al final', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Abrir búsqueda global' }).click();

    const results = page.locator('app-command-palette .results');
    await expect(results).toBeVisible();

    const masks = await results.evaluate(async (element) => {
      const start = getComputedStyle(element).maskImage;
      element.scrollTop = element.scrollHeight;

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      return { start, end: getComputedStyle(element).maskImage };
    });

    expect(masks.start).not.toBe('none');
    expect(masks.end).not.toBe(masks.start);
  });

  test('el selector de tipos del diseñador usa los estilos de la aplicación', async ({ page }) => {
    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    const sidebar = page.locator('app-connections-sidebar');
    const reveal = async (parent: string, child: string) => {
      const target = sidebar.getByText(child, { exact: true }).first();

      if (!(await target.isVisible().catch(() => false))) {
        await sidebar.getByText(parent, { exact: true }).first().click();
      }

      await expect(target).toBeVisible({ timeout: 30_000 });
    };

    await reveal('druse_test', 'public');
    await reveal('public', 'Tables');

    await sidebar
      .locator('.node', { hasText: 'Tables' })
      .first()
      .getByRole('button', { name: 'Acciones para Tables' })
      .click();
    await page.getByRole('menuitem', { name: 'Crear tabla' }).click();

    const designer = page.locator('app-table-designer');
    const input = designer.getByRole('combobox', { name: 'Tipo de dato' }).first();

    await expect(designer).toBeVisible();
    await input.click();

    const menu = designer.getByRole('listbox', { name: 'Tipos de dato sugeridos' });
    await expect(menu).toBeVisible();

    const style = await menu.evaluate((element) => {
      const computed = getComputedStyle(element);

      return {
        background: computed.backgroundColor,
        border: computed.borderStyle,
        shadow: computed.boxShadow,
      };
    });

    expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.border).toBe('solid');
    expect(style.shadow).not.toBe('none');

    await input.fill('var');
    const options = menu.getByRole('option');
    await expect(options.first()).toBeVisible();
    await expect(options.first()).toContainText(/var/i);

    await input.fill('TIPO_PERSONALIZADO');
    await expect(menu).toContainText('Escribe un tipo personalizado');
    await expect(input).toHaveValue('TIPO_PERSONALIZADO');
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
