import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { expect, test } from '@playwright/test';

import { abrir } from '../support/druse';

/**
 * SQLite, por donde lo usa una persona.
 *
 * **Es la única de punta a punta que no necesita ningún contenedor**: el motor
 * es un archivo, y el archivo lo crea esta prueba. Por eso corre siempre, en
 * cualquier máquina.
 *
 * Lo que comprueba es lo que solo se ve con las tres capas juntas: que el
 * formulario cambie de forma —sin servidor, sin puerto, sin usuario, con una
 * ruta— y que lo que hay dentro del archivo llegue al árbol.
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

  db.exec(`
    DROP TABLE IF EXISTS pedidos;
    DROP TABLE IF EXISTS clientes;
    DROP VIEW IF EXISTS resumen;
    CREATE TABLE clientes (
      id     INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      email  TEXT
    );
    CREATE TABLE pedidos (
      id         INTEGER PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes (id),
      total      NUMERIC(10,2)
    );
    CREATE VIEW resumen AS SELECT nombre, email FROM clientes;
    INSERT INTO clientes (id, nombre, email) VALUES (1, 'Ana', 'ana@ejemplo.test');
  `);

  db.close();
});

// No se borra al terminar: **la conexión sigue abierta en la aplicación**, que
// es lo normal cuando la suite acaba, y Windows no deja borrar un archivo que
// otro proceso tiene abierto. El archivo se rehace al empezar la siguiente
// ejecución, que es cuando de verdad estorba.

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
});
