import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, test, type Page } from '@playwright/test';

import {
  abrir,
  ejecutar,
  escribirSql,
  esperarFinDeConsulta,
  primeraColumna,
  situarCursor,
} from '../support/druse';

/**
 * SQLite, por donde lo usa una persona.
 *
 * **Es la única de punta a punta que no necesita ningún contenedor**: el motor
 * es un archivo, y el archivo lo crea esta prueba. Por eso corre siempre, en
 * cualquier máquina.
 *
 * Lo que comprueba es lo que solo se ve con las tres capas juntas: que el
 * formulario cambie de forma —sin servidor, sin puerto, sin usuario, con una
 * ruta—, que lo que hay dentro del archivo llegue al árbol, y que **reconstruir
 * una tabla desde el diseñador no se lleve nada por delante**, que en este motor
 * es lo que cuesta.
 */
/**
 * La ruta es **fija y no aleatoria**, y eso importa.
 *
 * Las pruebas comparten la aplicación y sus conexiones guardadas: un archivo
 * distinto en cada ejecución dejaría el perfil de la anterior apuntando a algo
 * que ya no está, y la segunda pasada fallaría al conectar sin que nada del
 * producto hubiera cambiado.
 */
const CARPETA = process.env['DRUSE_E2E_SQLITE_DIR'] ?? join(tmpdir(), 'druse-e2e-sqlite');
const ARCHIVO = join(CARPETA, 'ventas.db');

/**
 * Dónde deja su captura esta prueba, cuando se le pide.
 *
 * La captura del barrido se toma **aquí y no en el barrido** porque aquel
 * recorrido trabaja sobre PostgreSQL, y lo que hay que enseñar —una tabla que se
 * reconstruye entera con sus condiciones dentro— solo pasa en el motor que es un
 * archivo. Se guarda donde las demás y con el mismo criterio: solo si se pide.
 */
const BARRIDO = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';

test.beforeAll(() => {
  // Se parte de cero en cada ejecución, pero en el mismo sitio.
  try {
    rmSync(ARCHIVO, { force: true });
  } catch {
    // Lo tenía abierto la ejecución anterior; se reutiliza lo que haya.
  }

  mkdirSync(CARPETA, { recursive: true });

  // El archivo lo crea la prueba y no Druse: abrir un archivo que no está tiene
  // que fallar, y por eso el proveedor no lo crea nunca.
  const db = new DatabaseSync(ARCHIVO);

  // La tabla de clientes lleva **de todo lo que se pierde al reconstruirla**:
  // una condición de comprobación, un disparador, una vista que la mira y una
  // tabla hija que la referencia en cascada. Es el material de la segunda prueba.
  db.exec(`
    DROP TRIGGER IF EXISTS tr_clientes;
    DROP TABLE IF EXISTS pedidos;
    DROP TABLE IF EXISTS altas;
    DROP VIEW IF EXISTS resumen;
    DROP TABLE IF EXISTS clientes;
    CREATE TABLE clientes (
      id     INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      email  TEXT,
      nit    TEXT,
      CONSTRAINT ck_nombre CHECK (length(nombre) > 1)
    );
    CREATE TABLE pedidos (
      id         INTEGER PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes (id) ON DELETE CASCADE,
      total      NUMERIC(10,2)
    );
    CREATE TABLE altas (cuando TEXT);
    CREATE VIEW resumen AS SELECT nombre, email FROM clientes;
    CREATE TRIGGER tr_clientes AFTER INSERT ON clientes
    BEGIN
      INSERT INTO altas (cuando) VALUES ('alta');
    END;
    INSERT INTO clientes (id, nombre, email, nit) VALUES (1, 'Ana', 'ana@ejemplo.test', '900');
    INSERT INTO pedidos (id, cliente_id, total) VALUES (10, 1, 5), (11, 1, 7);
  `);

  db.close();
});

// No se borra al terminar: **la conexión sigue abierta en la aplicación**, que
// es lo normal cuando la suite acaba, y Windows no deja borrar un archivo que
// otro proceso tiene abierto. El archivo se rehace al empezar la siguiente
// ejecución, que es cuando de verdad estorba.

/**
 * Deja la conexión de SQLite conectada, la cree esta llamada o ya estuviera.
 *
 * Lo comparten las dos pruebas porque el perfil se guarda: la segunda ejecución
 * —y la segunda prueba— lo encuentran hecho, y ahí es donde apareció en su día el
 * fallo de volver a pedir una contraseña que este motor no tiene.
 */
async function conectado(page: Page) {
  const sidebar = page.locator('app-connections-sidebar');
  const fila = sidebar.locator('.node--connection', { hasText: 'E2E SQLite' }).first();

  if ((await fila.count()) === 0) {
    await page.getByRole('button', { name: 'Nueva conexión' }).first().click();

    const dialogo = page.locator('app-connection-dialog');

    await expect(dialogo).toBeVisible();
    await dialogo.locator('.engine', { hasText: 'SQLite' }).first().click();

    const campo = (etiqueta: string) =>
      dialogo.locator(`.field:has(.field__label:text-is("${etiqueta}")) input`).first();

    await campo('Nombre').fill('E2E SQLite');
    await campo('Archivo').fill(ARCHIVO);

    await dialogo.getByRole('button', { name: 'Conectar' }).click();
    await expect(dialogo).toBeHidden({ timeout: 60_000 });
  }

  await expect(fila).toBeVisible({ timeout: 60_000 });

  if ((await fila.getAttribute('class'))?.includes('is-offline')) {
    await fila.click();
  }

  await expect(fila).not.toHaveClass(/is-offline/, { timeout: 60_000 });

  return { sidebar, fila };
}

/** El menú de acciones de un nodo del árbol. */
async function menuDeNodo(page: Page, nodo: string) {
  await page
    .locator('app-connections-sidebar .node', { hasText: nodo })
    .first()
    .getByRole('button', { name: `Acciones para ${nodo}` })
    .click();
}

/** Abre el árbol hasta las tablas del archivo. */
async function hastaLasTablas(page: Page) {
  const { sidebar } = await conectado(page);

  const base = sidebar.getByText('main', { exact: true }).first();

  await expect(base).toBeVisible({ timeout: 60_000 });
  await base.click();

  const esquema = sidebar.getByText('main', { exact: true }).nth(1);

  await expect(esquema).toBeVisible({ timeout: 30_000 });
  await esquema.click();

  const tablas = sidebar.getByText('Tables', { exact: true }).first();

  await expect(tablas).toBeVisible({ timeout: 30_000 });
  await tablas.click();

  return sidebar;
}

test.describe('SQLite de punta a punta', () => {
  test('el fondo de resultados se ajusta, persiste y se quita sin cambiar el editor', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await abrir(page);
    await hastaLasTablas(page);
    await menuDeNodo(page, 'clientes');
    await page.getByRole('menuitem', { name: 'Abrir SELECT', exact: true }).click();
    await escribirSql(page, "WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 40) SELECT id, 'Ana' AS nombre, 'ana@ejemplo.test' AS email FROM n");
    await ejecutar(page, 'todo');
    await expect(page.locator('app-results-grid .row')).toHaveCount(40);
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, 800, 400);
      gradient.addColorStop(0, '#2457c5');
      gradient.addColorStop(1, '#ffb464');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 800, 400);
      ctx.fillStyle = '#164f69';
      ctx.beginPath();
      ctx.moveTo(0, 400);
      ctx.lineTo(260, 60);
      ctx.lineTo(440, 280);
      ctx.lineTo(630, 140);
      ctx.lineTo(800, 400);
      ctx.fill();
      return canvas.toDataURL().split(',')[1];
    });
    const preferences = async () => {
      await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
      await page.locator('app-settings-dialog').getByRole('tab', { name: 'Resultados', exact: true }).click();
    };
    await preferences();
    const panel = page.locator('#settings-panel-results');
    const editorBefore = await page.locator('html').evaluate(el => (el as HTMLElement).style.getPropertyValue('--dr-editor-background'));
    const chooser = page.waitForEvent('filechooser');
    await panel.getByRole('button', { name: /Elegir imagen|Cambiar imagen/ }).click();
    await (await chooser).setFiles({ name: 'montanas.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
    await expect(panel.locator('.file__name')).toHaveText('montanas.png');
    await panel.getByRole('slider', { name: /Intensidad/ }).fill('25');
    await panel.getByRole('button', { name: 'Encajar', exact: true }).click();
    const preview = panel.locator('.grid-preview');
    await expect.poll(() => preview.evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('0.25');
    await expect.poll(() => preview.evaluate(el => getComputedStyle(el, '::before').backgroundImage)).toContain('data:image/png');
    if (process.env['DRUSE_BARRIDO_DIR']) {
      mkdirSync(BARRIDO, { recursive: true });
      await page.screenshot({ path: join(BARRIDO, 'results-background-settings.png') });
    }
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    const grid = page.locator('app-results-grid');
    await expect.poll(() => grid.evaluate(el => getComputedStyle(el, '::before').backgroundSize)).toBe('contain');
    await grid.locator('.cell--value').first().click();
    await expect(grid.locator('.cell--value').first()).toHaveClass(/is-selected/);
    await grid.locator('.body').evaluate(el => { el.scrollTop = 350; });
    await expect(grid.locator('.head')).toBeVisible();
    if (process.env['DRUSE_BARRIDO_DIR']) {
      await page.screenshot({ path: join(BARRIDO, 'results-background-grid.png') });
    }
    await page.getByRole('button', { name: 'Tema claro', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => grid.evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('0.25');
    if (process.env['DRUSE_BARRIDO_DIR']) {
      await page.screenshot({ path: join(BARRIDO, 'results-background-light.png') });
    }
    await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Preferencias', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('html').evaluate(el => (el as HTMLElement).style.getPropertyValue('--dr-grid-background'))).toContain('data:image/png');
    await preferences();
    await expect(panel.locator('.file__name')).toHaveText('montanas.png');
    await expect(panel.getByRole('slider', { name: /Intensidad/ })).toHaveValue('25');
    await panel.getByRole('button', { name: 'Quitar', exact: true }).click();
    await expect(panel.locator('.file__name')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('druse.gridBackground'))).toBeNull();
    expect(await page.locator('html').evaluate(el => (el as HTMLElement).style.getPropertyValue('--dr-editor-background'))).toBe(editorBefore);
    expect(await preview.evaluate(el => getComputedStyle(el, '::before').backgroundImage)).toBe('none');
  });

  test('combina COUNT SUM MIN con una lista IN y con subconsultas UNION', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await abrir(page);
    await hastaLasTablas(page);
    await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
    await menuDeNodo(page, 'pedidos');
    await page.getByRole('menuitem', { name: 'Componer consulta', exact: true }).click();
    const builder = page.locator('app-query-builder');
    for (const fn of ['COUNT', 'SUM', 'MIN']) {
      await builder.getByRole('button', { name: `Añadir ${fn}`, exact: true }).click();
    }
    await builder.getByLabel('Columna agregada', { exact: true }).nth(1).selectOption('base:total');
    await builder.getByLabel('Columna agregada', { exact: true }).nth(2).selectOption('base:total');
    await builder.getByRole('button', { name: 'Añadir filtro', exact: true }).click();
    await builder.getByLabel('Columna', { exact: true }).selectOption('cliente_id');
    await builder.getByLabel('Operador', { exact: true }).selectOption('IN');
    await builder.getByRole('textbox', { name: 'Lista de valores', exact: true }).fill('1, 2');
    await expect(builder.locator('textarea.sql')).not.toHaveValue(/GROUP BY/);
    await builder.getByRole('button', { name: 'Probar con 10 filas', exact: true }).click();
    await expect(builder.locator('app-results-grid .cell__text')).toHaveText(['2', '12', '5']);
    await builder.getByLabel('Comparar IN con', { exact: true }).selectOption('query');
    await builder.getByRole('textbox', { name: 'Subconsulta SELECT', exact: true }).fill(
      "SELECT id FROM clientes WHERE nombre = 'Ana'\nUNION\nSELECT id FROM clientes WHERE nombre = 'Luis';",
    );
    await builder.getByRole('button', { name: 'Probar con 10 filas', exact: true }).click();
    await expect(builder.locator('app-results-grid .cell__text')).toHaveText(['2', '12', '5']);
    if (process.env['DRUSE_BARRIDO_DIR']) {
      mkdirSync(BARRIDO, { recursive: true });
      await page.screenshot({ path: join(BARRIDO, 'query-builder-aggregates-in.png') });
    }
  });

  test('el compositor permite buscar columnas y revisar resultados en ambos temas', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await abrir(page);
    await hastaLasTablas(page);
    await page
      .getByRole('button', { name: 'Tema oscuro', exact: true })
      .click();
    await menuDeNodo(page, 'clientes');
    await page
      .getByRole('menuitem', { name: 'Componer consulta', exact: true })
      .click();
    const builder = page.locator('app-query-builder');
    const search = builder.getByRole('searchbox', {
      name: 'Buscar por nombre o tipo…',
    });
    await expect(search).toBeVisible();
    await search.fill('nombre');
    await builder.getByRole('button', { name: 'Seleccionar visibles' }).click();
    await expect(builder.locator('textarea.sql')).toHaveValue(
      /SELECT "nombre"/,
    );
    await search.fill('');
    await builder.getByRole('button', { name: 'Probar con 10 filas' }).click();
    await expect(builder.locator('app-results-grid')).toContainText('Ana');
    await builder.getByRole('button', { name: 'Desmarcar todas' }).click();
    await expect(
      builder.getByRole('status').filter({ hasText: 'SQL anterior' }),
    ).toBeVisible();

    const previewBefore = await builder.locator('.preview').boundingBox();
    await builder.locator('.builder-workspace > .body').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect((await builder.locator('.preview').boundingBox())?.y).toBe(
      previewBefore?.y,
    );
    await builder.locator('.builder-workspace > .body').evaluate((element) => {
      element.scrollTop = 0;
    });
    if (process.env['DRUSE_BARRIDO_DIR']) {
      mkdirSync(BARRIDO, { recursive: true });
      await page.screenshot({ path: join(BARRIDO, 'query-builder-dark.png') });
    }

    await builder.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.getByRole('button', { name: 'Tema claro', exact: true }).click();
    await menuDeNodo(page, 'clientes');
    await page
      .getByRole('menuitem', { name: 'Componer consulta', exact: true })
      .click();
    await expect(search).toBeVisible();
    if (process.env['DRUSE_BARRIDO_DIR']) {
      await page.screenshot({ path: join(BARRIDO, 'query-builder-light.png') });
    }

    await page.setViewportSize({ width: 600, height: 800 });
    await expect(builder.locator('.dialog')).toBeVisible();
    expect(
      await builder
        .locator('.builder-workspace')
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    if (process.env['DRUSE_BARRIDO_DIR']) {
      await page.screenshot({
        path: join(BARRIDO, 'query-builder-narrow.png'),
      });
    }
  });

  test('el formulario pierde el servidor y el árbol trae lo que hay dentro', async ({ page }) => {
    await abrir(page);

    const sidebar = page.locator('app-connections-sidebar');
    const fila = sidebar.locator('.node--connection', { hasText: 'E2E SQLite' }).first();

    if ((await fila.count()) === 0) {
      await page.getByRole('button', { name: 'Nueva conexión' }).first().click();

      const dialogo = page.locator('app-connection-dialog');

      await expect(dialogo).toBeVisible();
      await dialogo.locator('.engine', { hasText: 'SQLite' }).first().click();

      const campo = (etiqueta: string) =>
        dialogo.locator(`.field:has(.field__label:text-is("${etiqueta}")) input`).first();

      // --- El formulario cambia de forma ------------------------------------
      // Estas cuatro comprobaciones son la razón de ser de esta prueba: lo que
      // se ve es lo que el motor declara, no lo que el componente supone.
      await expect(campo('Servidor')).toHaveCount(0);
      await expect(campo('Puerto')).toHaveCount(0);
      await expect(campo('Usuario')).toHaveCount(0);
      await expect(dialogo.getByRole('button', { name: 'Opciones avanzadas' })).toHaveCount(0);

      // Y la base de datos se llama archivo, porque eso es.
      await expect(campo('Archivo')).toBeVisible();

      // **Examinar y crear no están aquí**, y es correcto: los dos abren un
      // diálogo del sistema, y esto corre en un navegador. Dentro de la
      // aplicación de escritorio sí aparecen. Se comprueba para que quede dicho
      // que la ausencia es la decisión y no un olvido.
      await expect(dialogo.getByRole('button', { name: 'Examinar…' })).toHaveCount(0);
      await expect(dialogo.getByRole('button', { name: 'Crear una nueva' })).toHaveCount(0);

      await campo('Nombre').fill('E2E SQLite');
      await campo('Archivo').fill(ARCHIVO);

      await dialogo.getByRole('button', { name: 'Conectar' }).click();
      await expect(dialogo).toBeHidden({ timeout: 60_000 });
    }

    // --- El árbol -----------------------------------------------------------
    // Se mira el estado de **su fila** y no si aparece un nodo llamado `main`:
    // la suite deja varias conexiones abiertas y ese nombre es de los que se
    // repiten, así que buscarlo daría por conectado lo que no lo está.
    await expect(fila).toBeVisible({ timeout: 60_000 });

    if ((await fila.getAttribute('class'))?.includes('is-offline')) {
      await fila.click();
    }

    await expect(fila).not.toHaveClass(/is-offline/, { timeout: 60_000 });

    const base = sidebar.getByText('main', { exact: true }).first();

    await expect(base).toBeVisible({ timeout: 60_000 });

    // El esquema sintético, igual que en MySQL y Oracle: un nivel que el motor
    // no tiene y que el explorador necesita para comportarse igual en los seis.
    await base.click();

    const esquema = sidebar.getByText('main', { exact: true }).nth(1);

    await expect(esquema).toBeVisible({ timeout: 30_000 });
    await esquema.click();

    // **Dos carpetas y no cuatro**: aquí no hay funciones ni procedimientos, y
    // enseñarlas vacías diría que la base no tiene ninguno.
    await expect(sidebar.getByText('Tables', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(sidebar.getByText('Views', { exact: true }).first()).toBeVisible();
    await expect(sidebar.getByText('Procedures', { exact: true })).toHaveCount(0);

    // Y lo que hay dentro del archivo llega hasta aquí.
    await sidebar.getByText('Tables', { exact: true }).first().click();

    await expect(sidebar.getByText('clientes', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(sidebar.getByText('pedidos', { exact: true }).first()).toBeVisible();
  });

  /**
   * Cambiar el tipo de una columna **desde el diseñador, con el archivo de
   * verdad**.
   *
   * Es la prueba que no se puede hacer más abajo: en SQLite ese cambio no es un
   * `ALTER`, es reconstruir la tabla entera, y lo que cuelga de ella se va con
   * ella si nadie lo recoge. Aquí se comprueba en el producto montado, que es
   * donde se notaría: la condición de comprobación que el motor no publica en
   * ningún `PRAGMA` tiene que llegar hasta la pantalla, y después del cambio
   * tienen que seguir en pie el disparador, la vista, la condición y —sobre
   * todo— las filas de la tabla hija, que la cascada del borrado se llevaría.
   */
  test('reconstruir una tabla desde el diseñador no se lleva nada por delante', async ({
    page,
  }) => {
    await abrir(page);

    const sidebar = await hastaLasTablas(page);

    await expect(sidebar.getByText('clientes', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    await menuDeNodo(page, 'clientes');
    await page.getByRole('menuitem', { name: 'Modificar tabla' }).click();

    const disenador = page.locator('app-table-designer');

    await expect(disenador).toBeVisible({ timeout: 30_000 });

    // --- Lo que el motor no publica, en la pantalla -----------------------
    // `ck_nombre` no sale de ningún catálogo: sale del texto del `CREATE TABLE`.
    // Verla aquí es ver el camino entero, del archivo a la interfaz.
    await disenador.getByRole('tab', { name: 'Restricciones' }).click();

    await expect(disenador.getByRole('button', { name: 'Añadir condición' })).toBeVisible();

    const condicion = disenador.locator('.rows__item', { hasText: 'Condición' }).first();

    await expect(condicion).toBeVisible();
    await expect(condicion.getByLabel('Nombre de la restricción')).toHaveValue('ck_nombre');
    await expect(condicion.getByLabel('Contenido de la restricción')).toHaveValue(
      'length(nombre) > 1',
    );

    // --- El cambio: `nit` pasa de texto a número --------------------------
    await disenador.getByRole('tab', { name: 'Columnas' }).click();

    // La fila se busca por el **valor** del campo del nombre, no por el texto de
    // la fila: los nombres viven dentro de campos de edición, y ahí no hay texto
    // que buscar.
    const nombres = await disenador
      .getByLabel('Nombre de la columna')
      .evaluateAll((campos) => campos.map((campo) => (campo as HTMLInputElement).value));

    expect(nombres).toContain('nit');

    const fila = disenador.locator('.columns__row').nth(nombres.indexOf('nit'));

    await fila.getByLabel('Tipo de dato').fill('INTEGER');
    await page.keyboard.press('Escape');

    // **Primero se lee el SQL y luego se aplica.** No es un paso de adorno del
    // diseñador: el botón de aplicar no se habilita hasta que el SQL está a la
    // vista, y aquí sirve además para ver que lo que se va a ejecutar es una
    // reconstrucción y no un `ALTER` que este motor no sabe hacer.
    await disenador.getByRole('button', { name: 'Ver SQL' }).click();

    await expect(disenador.locator('pre.sql')).toContainText('clientes_druse_nueva', {
      timeout: 30_000,
    });

    await disenador.getByRole('button', { name: 'Aplicar cambios' }).click();

    // **El diálogo se queda abierto con lo que hizo**, y está bien que se quede:
    // lo que se acaba de ejecutar no es un `ALTER` sino una tabla rehecha, y eso
    // se lee antes de cerrar.
    await expect(disenador.locator('.done')).toContainText('aplicados', { timeout: 60_000 });

    if (process.env['DRUSE_BARRIDO']) {
      await disenador.locator('.dialog').first().screenshot({
        path: `${BARRIDO}/18-sqlite-reconstruccion.png`,
      });
    }

    // El del pie, no la aspa de la cabecera: las dos se llaman igual.
    await disenador.locator('.foot').getByRole('button', { name: 'Cerrar' }).click();
    await expect(disenador).toBeHidden({ timeout: 30_000 });

    // --- Lo que tiene que seguir en pie ----------------------------------
    // La pestaña se abre **desde el árbol**, con «Abrir SELECT» sobre una tabla
    // del archivo: así nace apuntando a esta conexión y a esta base. Apuntar una
    // pestaña ya abierta serviría igual, pero la suite deja pestañas de otras
    // pruebas mirando a servidores que en esta ejecución están apagados.
    // Se vuelve a bajar por el árbol en vez de dar por hecho cómo quedó: aplicar
    // un cambio lo recarga, y recargarlo lo pliega.
    await hastaLasTablas(page);
    await menuDeNodo(page, 'pedidos');
    await page.getByRole('menuitem', { name: 'Abrir SELECT' }).click();

    // Las filas de la hija son lo primero porque son lo único irrecuperable: si
    // la cascada se las llevó, ya no están en ninguna parte.
    await escribirSql(page, 'SELECT COUNT(*) FROM pedidos');
    await ejecutar(page, 'todo');
    await expect(async () => expect(await primeraColumna(page)).toEqual(['2'])).toPass({
      timeout: 30_000,
    });

    // La vista sigue leyendo.
    await escribirSql(page, 'SELECT nombre FROM resumen');
    await ejecutar(page, 'todo');
    await expect(async () => expect(await primeraColumna(page)).toEqual(['Ana'])).toPass({
      timeout: 30_000,
    });

    // La condición sigue impidiendo lo que impedía, que es la única forma de
    // saber que está: una guardada que no rechaza nada no sirve de nada.
    await escribirSql(page, "INSERT INTO clientes (id, nombre, nit) VALUES (2, 'B', 1)");
    await ejecutar(page, 'todo');
    await expect(page.locator('app-results-panel')).toContainText('CHECK', {
      timeout: 30_000,
    });

    // Y el disparador dispara: una alta buena deja su rastro en `altas`.
    await escribirSql(page, "INSERT INTO clientes (id, nombre, nit) VALUES (3, 'Bea', 800)");
    await ejecutar(page, 'todo');

    await escribirSql(page, 'SELECT COUNT(*) FROM altas');
    await ejecutar(page, 'todo');
    await expect(async () => expect(await primeraColumna(page)).toEqual(['2'])).toPass({
      timeout: 30_000,
    });
  });

  /**
   * Un cambio rechazado **por los datos que ya había** se puede ir a ver.
   *
   * Escribir una condición que la tabla de hoy no cumple es lo más normal del
   * mundo al ordenar una base que creció sin reglas, y hasta ahora el aviso
   * decía qué pasaba sin decir dónde: encontrar las filas era escribir la
   * consulta a mano, con el diseñador abierto por delante.
   *
   * Esto es lo que no se puede probar más abajo: que el rechazo llega con su
   * consulta, que el botón la abre en una pestaña **de esta conexión** y que lo
   * que sale al ejecutarla son las filas culpables. Y de paso, que el cambio no
   * se aplicó: la tabla no se queda con una condición que su contenido incumple.
   */
  test('lo que el diseñador rechaza se puede ir a ver sin salir de Druse', async ({ page }) => {
    await abrir(page);
    await hastaLasTablas(page);

    await menuDeNodo(page, 'clientes');
    await page.getByRole('menuitem', { name: 'Modificar tabla' }).click();

    const disenador = page.locator('app-table-designer');

    await expect(disenador).toBeVisible({ timeout: 30_000 });

    await disenador.getByRole('tab', { name: 'Restricciones' }).click();

    // **Primero la que ya existe.** El diálogo se dibuja antes de que llegue la
    // estructura de la tabla, y lo que llega la reemplaza: añadir una condición
    // en ese hueco la borra al instante siguiente, y lo que queda delante es la
    // de siempre, que no se deja escribir por venir del catálogo.
    await expect(
      disenador.locator('.rows__item', { hasText: 'Condición' }).first(),
    ).toBeVisible({ timeout: 30_000 });

    await disenador.getByRole('button', { name: 'Añadir condición' }).click();

    // Los campos de las que ya existen están deshabilitados, así que **buscar el
    // que se deja escribir** es buscar la recién añadida sin depender de su sitio
    // en la lista.
    const nombre = disenador
      .locator('.rows__item input[aria-label="Nombre de la restricción"]:not([disabled])')
      .last();

    await expect(nombre).toBeVisible({ timeout: 30_000 });
    await nombre.fill('ck_nombre_largo');

    await disenador
      .locator('.rows__item input[aria-label="Contenido de la restricción"]:not([disabled])')
      .last()
      .fill('length(nombre) > 50');

    await disenador.getByRole('button', { name: 'Ver SQL' }).click();

    await expect(disenador.locator('pre.sql')).toContainText('ck_nombre_largo', {
      timeout: 30_000,
    });

    await disenador.getByRole('button', { name: 'Aplicar cambios' }).click();

    // El aviso dice **por qué**, no «CHECK constraint failed»: quien lo lee acaba
    // de escribir esa condición y creería que la escribió mal.
    await expect(disenador.locator('.feedback')).toContainText('no cumplen', {
      timeout: 60_000,
    });

    if (process.env['DRUSE_BARRIDO']) {
      await disenador.locator('.dialog').first().screenshot({
        path: `${BARRIDO}/19-sqlite-rechazo-con-consulta.png`,
      });
    }

    await disenador.getByRole('button', { name: 'Ver las filas que lo impiden' }).click();

    // El diálogo se cierra solo: la pestaña queda detrás, y dejarlo abierto sería
    // un botón que aparenta no hacer nada.
    await expect(disenador).toBeHidden({ timeout: 30_000 });

    const consulta = await page.evaluate(
      () => (window as any).monaco.editor.getEditors()[0].getValue() as string,
    );

    expect(consulta).toContain('length(nombre) > 50');

    // Se ejecuta tal cual llegó, sin reescribirla: lo que se comprueba es que la
    // consulta que manda el motor vale contra la tabla que hay ahora mismo.
    const respuesta = page.waitForResponse(
      (r) => r.url().includes('/api/queries') && r.request().method() === 'POST',
      { timeout: 60_000 },
    );

    await page
      .locator('app-editor-toolbar')
      .getByRole('button', { name: 'Ejecutar', exact: true })
      .click();

    await respuesta;
    await esperarFinDeConsulta(page);

    await expect(page.locator('app-results-grid')).toContainText('Ana', { timeout: 30_000 });

    // Y no se aplicó nada: la tabla no se queda con una condición que incumple.
    await escribirSql(page, "SELECT sql FROM sqlite_master WHERE name = 'clientes'");
    await ejecutar(page, 'todo');

    await expect(async () => {
      const [definicion] = await primeraColumna(page);

      expect(definicion).toContain('ck_nombre');
      expect(definicion).not.toContain('ck_nombre_largo');
    }).toPass({ timeout: 30_000 });
  });

  /**
   * Las columnas se sugieren también sin alias ni tabla delante.
   *
   * Antes solo aparecían detrás de un punto. Y había un segundo fallo debajo que
   * solo veía quien no usa alias: en `FROM clientes JOIN pedidos`, `JOIN` se
   * tomaba por alias de `clientes` y `pedidos` desaparecía de la consulta.
   *
   * Va en SQLite porque no necesita contenedor, y porque las tablas no se abren
   * en el explorador: sus columnas tienen que llegar bajo demanda, que es el
   * camino que se ejercita aquí.
   */
  test('sugiere las columnas sueltas aunque las tablas no tengan alias', async ({ page }) => {
    await abrir(page);
    await hastaLasTablas(page);

    // La pestaña se abre desde el árbol para que nazca apuntando a este archivo:
    // el autocompletado mira la conexión de la pestaña, y la suite deja otras
    // mirando a servidores que en esta ejecución no están.
    await menuDeNodo(page, 'altas');
    await page.getByRole('menuitem', { name: 'Abrir SELECT' }).click();

    await escribirSql(
      page,
      'SELECT  FROM clientes JOIN pedidos ON pedidos.cliente_id = clientes.id',
    );

    // El cursor, justo detrás de «SELECT ».
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];

      editor.setPosition({ lineNumber: 1, column: 8 });
      editor.focus();
      editor.trigger('e2e', 'editor.action.triggerSuggest', {});
    });

    const desplegable = page.locator('.druse-overflow-widgets .suggest-widget').filter({ visible: true });

    await expect(desplegable).toBeVisible({ timeout: 30_000 });

    const nombres = async () =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '.monaco-editor .suggest-widget .monaco-list-row .monaco-icon-name-container',
          ),
        ).map((nombre) => nombre.textContent?.trim() ?? ''),
      );

    // Las columnas llegan después de pedirlas, así que se reintenta.
    await expect(async () => {
      const etiquetas = await nombres();

      // Las que solo tiene una tabla, sueltas.
      expect(etiquetas).toContain('nombre');
      expect(etiquetas).toContain('email');
      // `id` está en las dos: suelta, SQLite la rechazaría por ambigua.
      expect(etiquetas).toContain('clientes.id');
      expect(etiquetas).toContain('pedidos.id');
      expect(etiquetas).not.toContain('id');
    }).toPass({ timeout: 30_000 });

    if (process.env['DRUSE_BARRIDO']) {
      await page
        .locator('app-sql-editor')
        .screenshot({ path: `${BARRIDO}/22-autocompletado-sin-alias.png` });
    }

    // Y lo que se inserta es SQL que el motor acepta: se elige `total`, que solo
    // está en `pedidos`, y la consulta se ejecuta.
    await page.keyboard.type('tota');
    await expect(async () => {
      expect((await nombres())[0]).toBe('total');
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press('Enter');

    const consulta = await page.evaluate(
      () => (window as any).monaco.editor.getEditors()[0].getValue() as string,
    );

    expect(consulta).toBe(
      'SELECT total FROM clientes JOIN pedidos ON pedidos.cliente_id = clientes.id',
    );

    await ejecutar(page, 'todo');

    await expect(async () => {
      expect(await primeraColumna(page)).toEqual(['5', '7']);
    }).toPass({ timeout: 30_000 });
  });

  /**
   * Y en el WHERE, **escribiendo**, sin pedir el desplegable a mano.
   *
   * La anterior lo abre con la acción del editor y el cursor en el SELECT. Esta
   * teclea detrás del WHERE y del AND, que es como se usa: si el desplegable no
   * saliera solo al escribir, quien filtra sin alias seguiría sin ayuda aunque la
   * lógica de debajo supiera qué columnas ofrecer.
   */
  test('sugiere las columnas sueltas en el WHERE al escribir', async ({ page }) => {
    await abrir(page);
    await hastaLasTablas(page);

    await menuDeNodo(page, 'altas');
    await page.getByRole('menuitem', { name: 'Abrir SELECT' }).click();

    const inicio =
      'SELECT pedidos.id FROM clientes JOIN pedidos ON pedidos.cliente_id = clientes.id WHERE ';

    await escribirSql(page, inicio);
    await page.evaluate(() => {
      const editor = (window as any).monaco.editor.getEditors()[0];
      const model = editor.getModel();

      editor.setPosition(model.getPositionAt(model.getValueLength()));
      editor.focus();
    });

    const desplegable = page.locator('.druse-overflow-widgets .suggest-widget').filter({ visible: true });

    const nombres = async () =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '.monaco-editor .suggest-widget .monaco-list-row .monaco-icon-name-container',
          ),
        ).map((nombre) => nombre.textContent?.trim() ?? ''),
      );

    // Primera condición: una columna que solo tiene `pedidos`.
    await page.keyboard.type('tot', { delay: 60 });
    await expect(desplegable).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      expect((await nombres())[0]).toBe('total');
    }).toPass({ timeout: 30_000 });

    if (process.env['DRUSE_BARRIDO']) {
      await page
        .locator('app-sql-editor')
        .screenshot({ path: `${BARRIDO}/23-autocompletado-where.png` });
    }

    await page.keyboard.press('Enter');
    await page.keyboard.type(" > 6 AND ", { delay: 30 });
    await page.keyboard.press('Escape');

    // Segunda, detrás del AND: `id` está en las dos tablas y sale calificada.
    await page.keyboard.type('id', { delay: 60 });
    await expect(desplegable).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      const etiquetas = await nombres();

      expect(etiquetas).toContain('clientes.id');
      expect(etiquetas).toContain('pedidos.id');
      expect(etiquetas).not.toContain('id');
    }).toPass({ timeout: 30_000 });

    if (process.env['DRUSE_BARRIDO']) {
      await page
        .locator('app-sql-editor')
        .screenshot({ path: `${BARRIDO}/24-autocompletado-where-ambigua.png` });
    }

    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('nomb', { delay: 60 });
    await expect(async () => {
      expect((await nombres())[0]).toBe('nombre');
    }).toPass({ timeout: 30_000 });
    await page.keyboard.press('Enter');
    await page.keyboard.type(" = 'Ana'", { delay: 30 });
    await page.keyboard.press('Escape');

    const consulta = await page.evaluate(
      () => (window as any).monaco.editor.getEditors()[0].getValue() as string,
    );

    expect(consulta).toBe(`${inicio}total > 6 AND nombre = 'Ana'`);

    await ejecutar(page, 'todo');

    await expect(async () => {
      expect(await primeraColumna(page)).toEqual(['11']);
    }).toPass({ timeout: 30_000 });
  });

  /**
   * Una tabla ancha enseña **todas** sus columnas, la última incluida.
   *
   * La última columna se estira para ocupar lo que sobra de la ventana. Cuando
   * las demás ya pasaban del ancho visible no sobraba nada, y se quedaba en
   * cero píxeles: el `SELECT *` parecía traer una columna menos. Es de la
   * cuadrícula y no del motor —apareció en SQL Server—, así que basta SQLite.
   */
  test('un resultado con muchas columnas no pierde la última', async ({ page }) => {
    await abrir(page);
    await hastaLasTablas(page);
    await menuDeNodo(page, 'clientes');
    await page.getByRole('menuitem', { name: 'Abrir SELECT' }).click();

    const columnas = Array.from({ length: 60 }, (_, i) => `'valor ${i + 1}' AS campo_${i + 1}`);

    await escribirSql(page, `SELECT ${columnas.join(', ')}`);
    await ejecutar(page, 'todo');

    const cabeceras = page.locator('app-results-grid .cell--head');

    await expect(cabeceras).toHaveCount(60, { timeout: 30_000 });

    const ultima = cabeceras.last();

    await ultima.scrollIntoViewIfNeeded();
    await expect(ultima).toContainText('campo_60');

    const caja = await ultima.boundingBox();

    expect(caja?.width ?? 0).toBeGreaterThanOrEqual(84);
  });

  /**
   * Las ayudas que explican el SQL mientras se escribe.
   *
   * Lo que no se ve en las pruebas del frontend es que Monaco las pinte de
   * verdad: la firma al abrir el paréntesis, la explicación al posarse encima y
   * el arreglo rápido sobre un nombre mal escrito.
   */
  test('el editor explica las funciones y arregla los nombres mal escritos', async ({ page }) => {
    await abrir(page);
    await hastaLasTablas(page);
    await menuDeNodo(page, 'clientes');
    await page.getByRole('menuitem', { name: 'Abrir SELECT' }).click();

    const editor = page.locator('app-sql-editor');

    // --- Ayuda de parámetros ----------------------------------------------
    await escribirSql(page, 'SELECT ROUND(id');
    await situarCursor(page, 1, 16);
    await page.keyboard.type(', ');

    // Fuera del editor: las ventanas emergentes viven en su propia capa.
    const firma = page.locator('.druse-overflow-widgets .parameter-hints-widget');

    await expect(firma).toBeVisible({ timeout: 15_000 });
    await expect(firma).toContainText('ROUND(número, decimales)');
    await expect(firma.locator('.parameter.active')).toHaveText('decimales');

    if (process.env['DRUSE_BARRIDO']) {
      await page.screenshot({ path: `${BARRIDO}/25-ayuda-parametros.png` });
    }

    await page.keyboard.press('Escape');

    // --- Arreglo rápido ------------------------------------------------------
    await escribirSql(page, 'SELECT * FROM clientess');

    const marca = editor.locator('.squiggly-warning');

    await expect(marca).toBeVisible({ timeout: 15_000 });

    await situarCursor(page, 1, 18);
    await page.keyboard.press('Control+.');

    const arreglo = page.locator('.action-widget').getByText('Cambiar por clientes');

    await expect(arreglo).toBeVisible({ timeout: 15_000 });

    if (process.env['DRUSE_BARRIDO']) {
      await page.screenshot({ path: `${BARRIDO}/26-arreglo-rapido.png` });
    }

    // Con el teclado, como se llega a él: Monaco tapa su menú con una capa que
    // se come los clics sintéticos de la prueba.
    await page.keyboard.press('Enter');

    const texto = await page.evaluate(
      () => (window as any).monaco.editor.getEditors()[0].getValue() as string,
    );

    expect(texto).toBe('SELECT * FROM clientes');
  });
});
