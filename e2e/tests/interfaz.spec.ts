import { expect, test } from '@playwright/test';

import {
  abrir,
  apuntarPestana,
  apuntarPestanaA,
  conectar,
  conectarSqlServer,
  ejecutar,
  escribirSql,
  portapapeles,
  situarCursor,
  SQLSERVER,
} from '../support/druse';

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

  test('el constructor presenta cada JOIN como una relación legible y adaptable', async ({
    page,
  }) => {
    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    const ejecutarConAviso = async (sql: string) => {
      await escribirSql(page, sql);
      await page.keyboard.press('Control+Enter');

      const warning = page.getByRole('alertdialog');
      await expect(warning).toBeVisible({ timeout: 30_000 });
      const response = page.waitForResponse(
        (item) => item.url().includes('/api/queries') && item.request().method() === 'POST',
        { timeout: 60_000 },
      );

      await warning.getByRole('button', { name: 'Ejecutar de todos modos' }).click();
      await response;
      await expect(page.getByRole('button', { name: 'Cancelar' }).first()).toBeDisabled();
    };

    await ejecutarConAviso(
      [
        'DROP TABLE IF EXISTS public.e2e_join_ui_detail;',
        'DROP TABLE IF EXISTS public.e2e_join_ui_base;',
        'CREATE TABLE public.e2e_join_ui_base (id integer PRIMARY KEY, detail_id integer);',
        'CREATE TABLE public.e2e_join_ui_detail (id integer PRIMARY KEY, name text);',
      ].join('\n'),
    );

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

    const base = sidebar.getByText('e2e_join_ui_base', { exact: true }).first();

    if (!(await base.isVisible().catch(() => false))) {
      const tables = sidebar.locator('.node', { hasText: 'Tables' }).first();
      await sidebar.getByText('Tables', { exact: true }).first().click();

      if (!(await base.isVisible().catch(() => false))) {
        await tables.getByRole('button', { name: 'Acciones para Tables' }).click();
        await page.getByRole('menuitem', { name: 'Actualizar objetos' }).click();
      }
    }

    await expect(base).toBeVisible({ timeout: 30_000 });
    const row = sidebar.locator('.node', { hasText: 'e2e_join_ui_base' }).first();
    await row.getByRole('button', { name: 'Acciones para e2e_join_ui_base' }).click();
    await page.getByRole('menuitem', { name: 'Componer consulta' }).click();

    const builder = page.locator('app-query-builder');
    await expect(builder).toContainText('Aún no hay cruces');
    await builder.getByRole('button', { name: 'Añadir JOIN' }).click();

    const operands = builder.locator('.join-operand');
    await expect(operands).toHaveCount(2);
    await expect(operands.nth(0)).toContainText('Tabla existente');
    await expect(operands.nth(1)).toContainText('Tabla incorporada');

    const firstDesktop = await operands.nth(0).boundingBox();
    const secondDesktop = await operands.nth(1).boundingBox();
    expect(firstDesktop?.y).toBe(secondDesktop?.y);

    await page.setViewportSize({ width: 640, height: 800 });
    const firstNarrow = await operands.nth(0).boundingBox();
    const secondNarrow = await operands.nth(1).boundingBox();
    const dialog = await builder.locator('.dialog').boundingBox();

    expect(secondNarrow!.y).toBeGreaterThan(firstNarrow!.y);
    expect(dialog!.x).toBeGreaterThanOrEqual(0);
    expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(640);

    await builder.getByRole('button', { name: 'Cerrar' }).click();
    await ejecutarConAviso(
      'DROP TABLE IF EXISTS public.e2e_join_ui_detail;\nDROP TABLE IF EXISTS public.e2e_join_ui_base;',
    );
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
   * Al escribir cerca del borde inferior, Monaco abre las sugerencias hacia
   * arriba. Su valor por omisión les permite salir del editor y llegaban a tapar
   * las pestañas y las dos barras de acciones completas.
   */
  test('el autocompletado no sale del editor ni cubre sus barras', async ({ page }) => {
    await abrir(page);

    // Deja poco resultado y mucho editor, como en la captura donde el cursor
    // estaba casi al pie de la ventana y la lista tuvo que abrir hacia arriba.
    const resize = page.getByRole('separator', { name: 'Alto del panel de resultados' });
    await resize.focus();
    for (let step = 0; step < 14; step += 1) {
      await resize.press('ArrowDown');
    }

    const lineas = Array.from({ length: 80 }, (_, indice) => `-- línea ${indice + 1}`);
    lineas.push('sel');
    await escribirSql(page, lineas.join('\n'));

    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const model = editor.getModel();
      const lineNumber = model.getLineCount();

      // Reproduce el tamaño grande de fuente que hacía crecer también cada fila
      // del desplegable antes de que ambos tamaños quedaran desacoplados.
      editor.updateOptions({ fontSize: 24, lineHeight: 41 });
      editor.setPosition({ lineNumber, column: model.getLineMaxColumn(lineNumber) });
      editor.revealLine(lineNumber);
      editor.focus();
      editor.trigger('e2e', 'editor.action.triggerSuggest', {});
    });

    const editor = page.locator('app-sql-editor .monaco-editor');
    const suggestions = editor.locator('.suggest-widget').filter({ visible: true });

    await expect(suggestions).toBeVisible({ timeout: 10_000 });

    const editorBox = await editor.boundingBox();
    const suggestionsBox = await suggestions.boundingBox();

    expect(editorBox).not.toBeNull();
    expect(suggestionsBox).not.toBeNull();
    expect(suggestionsBox!.y).toBeGreaterThanOrEqual(editorBox!.y - 1);
    expect(await suggestions.locator('.monaco-list-row').count()).toBeGreaterThan(1);

    const suggestionFontSize = await suggestions.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(suggestionFontSize).toBeLessThanOrEqual(14);
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

  /**
   * La pantalla de carga tapa el arranque y se quita sola.
   *
   * Con la API local caliente el arranque dura menos que un parpadeo, así que la
   * prueba retrasa a propósito una de las lecturas: sin eso comprobaría que la
   * pantalla no está, que es justo lo contrario de lo que interesa.
   */
  test('la pantalla de carga cubre el arranque y se retira', async ({ page }) => {
    await page.route('**/api/preferences', async (route) => {
      await new Promise((listo) => setTimeout(listo, 4_000));
      await route.continue();
    });

    // `commit` y no la espera de siempre: `load` no vuelve hasta que el paquete
    // entero está evaluado, que es justo cuando la pantalla de carga empieza a
    // tener los días contados.
    await page.goto('/', { waitUntil: 'commit' });

    const carga = page.locator('#druse-splash');

    await expect(carga).toBeVisible();
    await expect(carga.getByText('Druse')).toBeVisible();

    // Delante de todo: si no cubriera, se vería la interfaz vacía por debajo.
    const cubre = await carga.evaluate((element) => {
      const caja = element.getBoundingClientRect();

      return (
        caja.width === window.innerWidth &&
        caja.height === window.innerHeight &&
        document.elementFromPoint(caja.width / 2, caja.height / 2)?.closest('#druse-splash') !==
          null
      );
    });

    expect(cubre).toBe(true);

    // Y sigue cubriendo con la interfaz encogida: el tamaño se aplica como
    // `zoom` sobre el `body`, y llega en las preferencias, o sea, mientras la
    // pantalla de carga todavía está puesta.
    const cubreEncogida = await carga.evaluate((element) => {
      document.documentElement.style.setProperty('--dr-scale', '0.8');

      const caja = element.getBoundingClientRect();
      const cubierto =
        Math.abs(caja.width - window.innerWidth) < 2 &&
        Math.abs(caja.height - window.innerHeight) < 2;

      document.documentElement.style.removeProperty('--dr-scale');

      return cubierto;
    });

    expect(cubreEncogida).toBe(true);

    // Y se retira del documento, no solo se vuelve transparente: invisible
    // seguiría interceptando cada clic de la aplicación que hay debajo.
    await expect(carga).toHaveCount(0, { timeout: 30_000 });
  });

  /**
   * Llevarse valores del resultado a otro sitio, con el formato de destino.
   *
   * Es lo que se hacía a mano: copiar celda a celda y escribir las comas y las
   * comillas alrededor. La prueba mira el portapapeles de verdad, porque el
   * formato solo sirve si sobrevive al viaje.
   */
  test('copia la selección como condición IN y como hoja de cálculo', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    // Sin tablas: lo que se prueba es la cuadrícula, no el catálogo.
    await escribirSql(
      page,
      "SELECT * FROM (VALUES (1, 'MX'), (2, 'ES'), (3, 'MX')) AS t(id, pais);",
    );
    await ejecutar(page, 'todo');

    const cabeceras = page.locator('app-results-grid .cell--head');
    const copiar = page.getByRole('button', { name: /Copiar como/ });

    await expect(copiar).toBeDisabled();

    await cabeceras.filter({ hasText: 'pais' }).click();

    // Dice qué se lleva: una columna entera son todas sus filas, no las visibles.
    await expect(copiar).toBeEnabled();
    await expect(copiar).toContainText('1 columna × 3 filas');

    await copiar.click();
    await page.getByRole('menuitem', { name: /condición IN/ }).click();

    // Sin repetir el 'MX' que aparece dos veces: en un IN no aporta nada.
    await expect.poll(() => portapapeles(page)).toBe("pais IN ('MX', 'ES')");

    // Y con el botón derecho sobre dos columnas, lo que espera una hoja.
    await cabeceras.filter({ hasText: 'id' }).click();
    await cabeceras.filter({ hasText: 'pais' }).click({ modifiers: ['Control'] });
    await cabeceras.filter({ hasText: 'pais' }).click({ button: 'right' });

    await page.locator('.copy-menu').getByRole('menuitem', { name: /Excel/ }).click();

    await expect.poll(() => portapapeles(page)).toBe('id\tpais\n1\tMX\n2\tES\n3\tMX');
  });

  /**
   * Arrastrar coge un bloque, como en una hoja de cálculo.
   *
   * Se comprueba con el ratón de verdad —bajar, mover, soltar— y no llamando a
   * los métodos: lo que falla en una selección por arrastre es siempre el orden
   * de los eventos, y eso solo aparece moviéndolo.
   */
  test('arrastrar por las celdas copia solo el bloque cogido', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    await escribirSql(
      page,
      "SELECT * FROM (VALUES (1, 'MX'), (2, 'ES'), (3, 'AR')) AS t(id, pais);",
    );
    await ejecutar(page, 'todo');

    const celdas = page.locator('app-results-grid .row .cell--value');

    // De la primera fila a la segunda, dentro de la columna del país.
    await celdas.nth(1).hover();
    await page.mouse.down();
    await celdas.nth(3).hover();
    await page.mouse.up();

    await expect(page.getByRole('button', { name: /Copiar como/ })).toContainText(
      '1 columna × 2 filas',
    );

    await celdas.nth(3).click({ button: 'right' });
    await page
      .locator('.copy-menu')
      .getByRole('menuitem', { name: /lista de valores/ })
      .click();

    // Solo las dos filas barridas: la tercera queda fuera.
    await expect.poll(() => portapapeles(page)).toBe("'MX', 'ES'");
  });

  /**
   * Probar el túnel a solas, desde el formulario.
   *
   * Lo que se comprueba aquí es la parte que ninguna prueba de componente ve: que
   * el botón aparece al marcar el túnel, que llega a la API de verdad y que lo
   * que responde se enseña. El servidor intermedio es inventado a propósito —no
   * hace falta un bastión para ver que el aviso distingue **dónde** falló—.
   */
  test('el formulario prueba el túnel por separado y dice dónde se quedó', async ({ page }) => {
    await abrir(page);

    await page.getByRole('button', { name: 'Nueva conexión' }).click();

    const dialogo = page.locator('app-connection-dialog');
    await expect(dialogo).toBeVisible();

    const campo = (etiqueta: string) =>
      dialogo.locator(`.field:has(.field__label:text-is("${etiqueta}")) input`).first();

    // Sin túnel no se ofrece: un botón que siempre contesta lo mismo enseña a no
    // leerlo.
    await expect(dialogo.getByRole('button', { name: 'Probar túnel' })).toHaveCount(0);

    await dialogo
      .locator('label.checkbox', { hasText: 'servidor SSH' })
      .locator('input')
      .check();

    const probar = dialogo.getByRole('button', { name: 'Probar túnel' });
    await expect(probar).toBeVisible();

    // El destino y el salto; ni usuario de la base ni nombre de conexión, que es
    // justo lo que este botón no exige.
    await campo('Servidor').first().fill('db.interna');
    await campo('Puerto').first().fill('5432');
    await campo('Servidor SSH').fill('bastion.que.no.existe.invalido');
    await campo('Usuario SSH').fill('operador');

    await probar.click();

    // Se queda en el salto, y lo dice nombrando el servidor que no contestó.
    await expect(dialogo.locator('.feedback')).toContainText('bastion.que.no.existe.invalido', {
      timeout: 60_000,
    });
  });

  /**
   * Coger varios registros arrastrando por la columna del número.
   *
   * Con el ratón de verdad y no llamando al componente: lo que falla en un
   * arrastre es el orden de los eventos —que el `mousedown` empiece el barrido y
   * que el `mouseenter` de cada fila lo estire— y eso solo se ve conduciendo.
   */
  test('arrastrar por los números coge las filas enteras y las copia', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    await escribirSql(
      page,
      "SELECT * FROM (VALUES (1, 'MX'), (2, 'ES'), (3, 'AR')) AS t(id, pais);",
    );
    await ejecutar(page, 'todo');

    const numeros = page.locator('app-results-grid .row .cell--number');

    // De la primera fila a la segunda, por la columna del número.
    await numeros.nth(0).hover();
    await page.mouse.down();
    await numeros.nth(1).hover();
    await page.mouse.up();

    // Dos filas enteras: las dos columnas entran sin haberlas tocado.
    await expect(page.getByRole('button', { name: /Copiar como/ })).toContainText(
      '2 columnas × 2 filas',
    );

    await numeros.nth(1).click({ button: 'right' });
    await page
      .locator('.copy-menu')
      .getByRole('menuitem', { name: /Excel/ })
      .click();

    await expect
      .poll(() => portapapeles(page))
      .toBe(['id\tpais', '1\tMX', '2\tES'].join('\n'));
  });

  /**
   * Ajustar el ancho de una columna para poder leer su título.
   *
   * Con el ratón de verdad: lo que falla en un arrastre es siempre el orden de
   * los eventos, y eso no aparece llamando a los métodos del componente.
   */
  test('el borde de la cabecera ajusta el ancho de su columna', async ({ page }) => {
    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    // Un título largo con valores cortos: el caso en el que el nombre no cabe.
    await escribirSql(
      page,
      "SELECT 1 AS identificador_de_la_operacion, 'ok' AS estado_actual_del_registro;",
    );
    await ejecutar(page, 'todo');

    const cabecera = page.locator('app-results-grid .cell--head').first();
    const anchoInicial = (await cabecera.boundingBox())!.width;

    // Arrastrar el asa del borde derecho.
    const asa = page.locator('app-results-grid .cell__resize').first();
    const caja = (await asa.boundingBox())!;

    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.mouse.move(caja.x + caja.width / 2 + 120, caja.y + caja.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => (await cabecera.boundingBox())!.width)
      .toBeGreaterThan(anchoInicial + 100);

    // El nombre entero, sin puntos suspensivos: es para lo que se ensancha.
    const nombre = cabecera.locator('.cell__name');

    expect(await nombre.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    // Y el doble clic la deja en lo justo que necesita, que es menos.
    await asa.dblclick();

    await expect.poll(async () => (await cabecera.boundingBox())!.width).toBeLessThan(
      anchoInicial + 100,
    );
    expect(await nombre.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  /**
   * En una columna apretada, lo que desaparece es el tipo y no el nombre.
   *
   * Antes ocurría al revés: `character varying` se quedaba pegado a la derecha y
   * el nombre salía cortado, que es justo el dato que hace falta para saber qué
   * columna se está mirando.
   */
  test('el tipo cede su sitio al nombre cuando la columna es estrecha', async ({ page }) => {
    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);

    await escribirSql(page, "SELECT 'x' AS nombre_bastante_largo_de_columna;");
    await ejecutar(page, 'todo');

    const cabecera = page.locator('app-results-grid .cell--head').first();
    const asa = page.locator('app-results-grid .cell__resize').first();
    const caja = (await asa.boundingBox())!;

    // Se estrecha hasta 130 px, donde el nombre ya no cabe entero. Se apunta al
    // borde izquierdo de la columna y no a un desplazamiento: el ancho de
    // partida lo decide el resultado, y restar píxeles a ojo dejaría la prueba
    // dependiendo de cuánto midiera la ventana.
    const columna = (await cabecera.boundingBox())!;

    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.mouse.move(columna.x + 130, caja.y + caja.height / 2, { steps: 8 });
    await page.mouse.up();

    const tipo = cabecera.locator('.cell__type');
    const nombre = cabecera.locator('.cell__name');

    // El tipo se ha quedado sin ancho; el nombre conserva el suyo.
    await expect.poll(() => tipo.evaluate((el) => el.clientWidth)).toBe(0);
    expect(await nombre.evaluate((el) => el.clientWidth)).toBeGreaterThan(40);
  });

  /**
   * El filtro del explorador, contra un catálogo de verdad.
   *
   * Aquí y no en el frontend porque lo que se comprueba es justo lo que los
   * dobles no tienen: que el árbol perezoso conserve lo que ya se abrió y que
   * buscarlo lo encuentre aunque su rama esté plegada. Es el caso por el que se
   * usa el campo en vez de ir abriendo carpetas a mano.
   */
  test('el filtro encuentra una tabla dentro de una rama plegada', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const sidebar = page.locator('app-connections-sidebar');

    // Se baja hasta las tablas una vez, que es lo que las trae a memoria.
    for (const [nodo, hijo] of [
      ['druse_test', 'public'],
      ['public', 'Tables'],
    ]) {
      const dentro = sidebar.getByText(hijo, { exact: true }).first();

      if (!(await dentro.isVisible().catch(() => false))) {
        await sidebar.getByText(nodo, { exact: true }).first().click();
      }

      await expect(dentro).toBeVisible({ timeout: 30_000 });
    }

    await sidebar.getByText('Tables', { exact: true }).first().click();

    /**
     * La tabla con la que se prueba sale del propio árbol, por su sangría.
     *
     * Escribir un nombre concreto ataría la prueba a lo que hayan dejado las
     * otras; el nodo más hondo, en cambio, es una tabla en cualquier caso.
     */
    const masHonda = async (): Promise<string> =>
      sidebar.locator('.node--object').evaluateAll(
        (filas) =>
          filas
            .map((fila) => ({
              sangria: parseInt(getComputedStyle(fila).paddingLeft, 10) || 0,
              nombre: fila.querySelector('.node__label')?.textContent?.trim() ?? '',
            }))
            .sort((a, b) => b.sangria - a.sangria)[0]?.nombre ?? '',
      );

    await expect.poll(masHonda, { timeout: 30_000 }).not.toBe('Tables');

    const tabla = await masHonda();

    // Y ahora se pliega el esquema entero: sin filtro, ahí abajo no queda nada.
    await sidebar.getByText('public', { exact: true }).first().click();
    await expect(sidebar.getByText('Tables', { exact: true })).toBeHidden({ timeout: 30_000 });

    /**
     * Al campo se llega con Ctrl+Shift+E desde donde se esté.
     *
     * Se prueba con el foco dentro de Monaco, que es donde se pasa el tiempo y
     * donde otros atajos se quedan por el camino.
     */
    await page.locator('app-sql-editor .monaco-editor textarea').first().focus();
    await page.keyboard.press('Control+Shift+E');

    await expect(sidebar.locator('.filter__input')).toBeFocused({ timeout: 10_000 });

    await page.keyboard.type(tabla);

    const fila = sidebar.locator('.node--object', { hasText: tabla }).first();

    await expect(fila).toBeVisible({ timeout: 30_000 });
    await expect(fila.locator('.node__hit').first()).toBeVisible();
    await expect(sidebar.locator('.filter__count')).toContainText('objeto');

    /**
     * Limpiar devuelve el árbol como estaba.
     *
     * Buscar enseña ramas plegadas, pero no las abre: si el filtro dejara tras
     * de sí lo que desplegó, el explorador acabaría abierto entero después de
     * tres búsquedas.
     */
    await sidebar.locator('.filter__clear').click();

    await expect(sidebar.locator('.filter__count')).toHaveCount(0);
    await expect(sidebar.getByText('Tables', { exact: true })).toBeHidden();
  });
});

/**
 * Lo mismo, contra SQL Server.
 *
 * Las dos mejoras de la cuadrícula —copiar con formato y ajustar el ancho— no
 * hablan con el motor, pero sí dependen de lo que el motor cuenta de cada
 * columna: su nombre, su tipo y la forma de sus valores. Un `varchar` de T-SQL
 * no llega igual que un `text` de PostgreSQL, y una columna sin alias ni
 * siquiera trae nombre. Estas pruebas comprueban que eso no rompe nada.
 */
test.describe('la cuadrícula contra SQL Server', () => {
  test.beforeEach(async ({ page }) => {
    await abrir(page);

    /**
     * Se abre PostgreSQL primero, como en la prueba de migración.
     *
     * No es un capricho: la barra del editor solo deja elegir dónde se ejecuta
     * cuando la pestaña ya apunta a alguna conexión. Sobre una pestaña que nunca
     * ha tenido ninguna, el chip se queda en «sin conexión» aunque haya un motor
     * abierto, y desde ahí no hay forma de llegar a SQL Server.
     */
    await conectar(page);
    await conectarSqlServer(page);
    await apuntarPestanaA(page, SQLSERVER.nombre, SQLSERVER.base);
  });

  test('copia la selección con formato desde un resultado de T-SQL', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await escribirSql(
      page,
      "SELECT * FROM (VALUES (1, 'MX'), (2, 'ES'), (3, 'MX')) AS t(id, pais);",
    );
    await ejecutar(page, 'todo');

    const cabeceras = page.locator('app-results-grid .cell--head');

    await cabeceras.filter({ hasText: 'pais' }).click();
    await cabeceras.filter({ hasText: 'pais' }).click({ button: 'right' });
    await page.locator('.copy-menu').getByRole('menuitem', { name: /condición IN/ }).click();

    await expect.poll(() => portapapeles(page)).toBe("pais IN ('MX', 'ES')");

    // El entero de T-SQL tiene que salir sin comillas, igual que en PostgreSQL:
    // el tipo lo clasifica el backend y es ahí donde los motores se separan.
    await cabeceras.filter({ hasText: 'id' }).click();
    await cabeceras.filter({ hasText: 'id' }).click({ button: 'right' });
    await page.locator('.copy-menu').getByRole('menuitem', { name: /condición IN/ }).click();

    await expect.poll(() => portapapeles(page)).toBe('id IN (1, 2, 3)');
  });

  test('un NULL de T-SQL sale fuera del IN', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // El NULL va con CAST: sin tipo, T-SQL no sabe qué columna está formando.
    await escribirSql(
      page,
      "SELECT * FROM (VALUES (1, 'activo'), (2, CAST(NULL AS varchar(10)))) AS t(id, estado);",
    );
    await ejecutar(page, 'todo');

    const cabecera = page.locator('app-results-grid .cell--head').filter({ hasText: 'estado' });

    await cabecera.click();
    await cabecera.click({ button: 'right' });
    await page.locator('.copy-menu').getByRole('menuitem', { name: /condición IN/ }).click();

    await expect
      .poll(() => portapapeles(page))
      .toBe("(estado IN ('activo') OR estado IS NULL)");
  });

  test('el ancho de la columna se ajusta igual', async ({ page }) => {
    await escribirSql(
      page,
      "SELECT 1 AS identificador_de_la_operacion, 'ok' AS estado_actual_del_registro;",
    );
    await ejecutar(page, 'todo');

    const cabecera = page.locator('app-results-grid .cell--head').first();
    const asa = page.locator('app-results-grid .cell__resize').first();
    const anchoInicial = (await cabecera.boundingBox())!.width;
    const caja = (await asa.boundingBox())!;

    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
    await page.mouse.down();
    await page.mouse.move(caja.x + caja.width / 2 + 120, caja.y + caja.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => (await cabecera.boundingBox())!.width)
      .toBeGreaterThan(anchoInicial + 100);

    await asa.dblclick();

    // Ajustada al contenido, el título se lee entero.
    const nombre = cabecera.locator('.cell__name');

    expect(await nombre.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  /**
   * Una columna sin alias.
   *
   * T-SQL la devuelve sin nombre —PostgreSQL la llamaría `?column?`—, y eso llega
   * hasta la cabecera y hasta el texto que se copia. Lo que no puede pasar es que
   * rompa la cuadrícula ni produzca una condición a medias sin avisar.
   */
  test('una columna sin nombre no rompe la cuadrícula', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await escribirSql(page, 'SELECT 42;');
    await ejecutar(page, 'todo');

    const cabecera = page.locator('app-results-grid .cell--head').first();

    await expect(cabecera).toBeVisible();

    await cabecera.click();
    await cabecera.click({ button: 'right' });
    await page.locator('.copy-menu').getByRole('menuitem', { name: /Para Excel/ }).click();

    // Para una hoja de cálculo, el valor es lo que importa y llega entero.
    await expect.poll(() => portapapeles(page)).toContain('42');
  });
});
