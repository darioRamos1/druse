import { expect, test, type Page } from '@playwright/test';

import { abrir, conectar, ejecutar, escribirSql, primeraColumna } from '../support/druse';

/**
 * Migrar los datos de una tabla a otra, por donde lo hace una persona.
 *
 * Es la prueba que no pueden dar ni las unitarias ni las de integración: que el
 * asistente **se abre desde donde uno lo busca**, que enseña lo que va a pasar
 * antes de escribir, y que al terminar las filas están de verdad al otro lado.
 * Lo que se comprueba al final no es un mensaje en pantalla, es un `COUNT(*)`.
 */
test.describe('migrar datos entre tablas', () => {
  /** Nombres propios de esta prueba, para no chocar con lo que haya en la base. */
  const ORIGEN = 'e2e_migracion_origen';
  const DESTINO = 'e2e_migracion_destino';

  /**
   * Deja las dos tablas como las quiere la prueba: origen con filas, destino vacía.
   *
   * Lleva `DROP`, así que Druse pide confirmación antes de ejecutarlo —es su
   * análisis de riesgo, y saltárselo aquí sería probar una aplicación que no es
   * la que se reparte—. La prueba confirma igual que lo haría una persona.
   */
  async function prepararTablas(page: Page): Promise<void> {
    await escribirSql(
      page,
      `DROP TABLE IF EXISTS ${ORIGEN};
       DROP TABLE IF EXISTS ${DESTINO};
       CREATE TABLE ${ORIGEN} (id int, nombre text);
       INSERT INTO ${ORIGEN} VALUES (1, 'Ana'), (2, 'Bea'), (3, 'Carla');
       CREATE TABLE ${DESTINO} (id int, nombre text);`,
    );

    await page.keyboard.press('Control+Enter');

    const aviso = page.getByRole('alertdialog');

    await expect(aviso).toBeVisible({ timeout: 30_000 });
    await aviso.getByRole('button', { name: 'Ejecutar de todos modos' }).click();

    await expect(aviso).toBeHidden({ timeout: 60_000 });
  }

  /**
   * Baja por el catálogo del asistente hasta la tabla de destino.
   *
   * El recorrido es el mismo que el del explorador —base, esquema, carpeta y
   * tabla— porque el asistente pregunta por los hijos de cada nodo en lugar de
   * suponer una jerarquía: cada motor organiza su catálogo a su manera.
   */
  async function elegirDestino(page: Page, tabla: string): Promise<void> {
    const dialogo = page.locator('app-transfer-dialog');

    for (const paso of ['druse_test', 'public', 'Tables', tabla]) {
      const nodo = dialogo.locator('.browser__item', { hasText: paso }).first();

      await expect(nodo).toBeVisible({ timeout: 30_000 });
      await nodo.click();
    }

    // Al elegir la tabla se pasa a emparejar columnas.
    await expect(dialogo.locator('.mapping')).toBeVisible({ timeout: 30_000 });
  }

  async function contar(page: Page, tabla: string): Promise<string> {
    await escribirSql(page, `SELECT COUNT(*) FROM ${tabla}`);
    await ejecutar(page, 'todo');

    return (await primeraColumna(page))[0];
  }

  /**
   * Despliega un nodo del árbol y espera a que aparezca lo que cuelga de él.
   *
   * Solo pulsa si el hijo no está ya a la vista: un clic sobre un nodo abierto lo
   * pliega, así que hacerlo por costumbre escondería justo lo que se busca. Es la
   * misma cautela que toma `conectar`.
   */
  async function desplegar(page: Page, nodo: string, hijo: string): Promise<void> {
    const sidebar = page.locator('app-connections-sidebar');
    const dentro = sidebar.getByText(hijo, { exact: true }).first();

    if (await dentro.isVisible().catch(() => false)) {
      return;
    }

    await sidebar.getByText(nodo, { exact: true }).first().click();
    await expect(dentro).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Baja por el árbol hasta la tabla y abre su menú de acciones.
   *
   * El árbol es perezoso y tiene un nivel que sorprende: las tablas no cuelgan
   * del esquema, sino de una carpeta «Tables» dentro de él.
   */
  async function menuDeLaTabla(page: Page, tabla: string): Promise<void> {
    const sidebar = page.locator('app-connections-sidebar');

    // La base ya está a la vista tras conectar; de ella cuelgan los esquemas.
    await desplegar(page, 'druse_test', 'public');
    await desplegar(page, 'public', 'Tables');
    await desplegar(page, 'Tables', tabla);

    const fila = sidebar.locator('.node', { hasText: tabla }).first();

    await expect(fila).toBeVisible({ timeout: 30_000 });

    await fila.getByRole('button', { name: `Acciones para ${tabla}` }).click();
  }

  test('copia las filas de una tabla a otra y lo demuestra contándolas', async ({ page }) => {
    await abrir(page);
    await conectar(page);
    await prepararTablas(page);

    expect(await contar(page, DESTINO)).toBe('0');

    await menuDeLaTabla(page, ORIGEN);
    await page.getByRole('menuitem', { name: 'Migrar datos a…' }).click();

    const dialogo = page.locator('app-transfer-dialog');

    await expect(dialogo).toBeVisible();
    await expect(dialogo.locator('.title')).toContainText(ORIGEN);

    await elegirDestino(page, DESTINO);

    // Las dos columnas se llaman igual, así que las empareja solas.
    await expect(dialogo.locator('.hint')).toContainText('2 de 2 columnas');

    /**
     * Ver antes de escribir.
     *
     * Es el paso que justifica la función entera, así que la prueba lo hace en
     * lugar de saltárselo: lo que se enseña aquí es lo único que separa mirar de
     * escribir en otra base.
     */
    await dialogo.getByRole('button', { name: 'Ver qué va a pasar' }).click();

    await expect(dialogo.locator('.preview')).toBeVisible({ timeout: 30_000 });
    await expect(dialogo.locator('.sql__statement').first()).toContainText('SELECT');
    await expect(dialogo.locator('.sql__statement').last()).toContainText('INSERT INTO');

    await dialogo.getByRole('button', { name: 'Copiar las filas' }).click();

    await expect(dialogo.locator('.summary__title')).toContainText('Copiadas 3 filas', {
      timeout: 60_000,
    });

    // El del pie, no la aspa de la cabecera: las dos se llaman «Cerrar».
    await dialogo.locator('.foot').getByRole('button', { name: 'Cerrar' }).click();
    await expect(dialogo).toBeHidden();

    // Y lo que importa: las filas están allí de verdad.
    expect(await contar(page, DESTINO)).toBe('3');
  });

  /**
   * Vaciar el destino no se puede pedir sin escribir su nombre.
   *
   * Es la única acción del asistente que borra, y una casilla marcada sin querer
   * no se distingue de una marcada a propósito.
   */
  test('vaciar el destino exige escribir el nombre de la tabla', async ({ page }) => {
    await abrir(page);
    await conectar(page);
    await prepararTablas(page);

    await menuDeLaTabla(page, ORIGEN);
    await page.getByRole('menuitem', { name: 'Migrar datos a…' }).click();

    const dialogo = page.locator('app-transfer-dialog');

    await elegirDestino(page, DESTINO);

    await dialogo.locator('.options select').first().selectOption('Replace');

    const copiar = dialogo.getByRole('button', { name: 'Copiar las filas' });

    await expect(dialogo.locator('.danger__text')).toContainText('no se deshace');
    await expect(copiar).toBeDisabled();

    await dialogo.locator('.danger input').fill(DESTINO);

    await expect(copiar).toBeEnabled();

    // Y se cierra sin copiar: lo que se comprobaba era la puerta, no el paso.
    await dialogo.locator('.foot').getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).toBeHidden();
  });
});
