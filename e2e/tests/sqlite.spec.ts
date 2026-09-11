import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, test, type Page } from '@playwright/test';

import { abrir, ejecutar, escribirSql, primeraColumna } from '../support/druse';

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
const CARPETA = join(tmpdir(), 'druse-e2e-sqlite');
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
});
