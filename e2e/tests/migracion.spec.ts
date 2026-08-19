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
  async function prepararTablas(
    page: Page,
    options: { conClave?: boolean } = {},
  ): Promise<void> {
    // La clave primaria solo hace falta para los modos que reconocen filas; en
    // los demás se deja fuera para no dar por hecho que la tabla la tiene.
    const clave = options.conClave ? ' PRIMARY KEY' : '';

    await ejecutarConAviso(
      page,
      `DROP TABLE IF EXISTS ${ORIGEN};
       DROP TABLE IF EXISTS ${DESTINO};
       CREATE TABLE ${ORIGEN} (id int${clave}, nombre text);
       INSERT INTO ${ORIGEN} VALUES (1, 'Ana'), (2, 'Bea'), (3, 'Carla');
       CREATE TABLE ${DESTINO} (id int${clave}, nombre text);`,
    );
  }

  /**
   * Ejecuta SQL que Druse considera peligroso, confirmando como lo haría alguien.
   *
   * Lleva `DROP`, así que la aplicación pide confirmación —es su análisis de
   * riesgo, y saltárselo aquí sería probar una aplicación que no es la que se
   * reparte—.
   */
  async function ejecutarConAviso(page: Page, sql: string): Promise<void> {
    await escribirSql(page, sql);

    await page.keyboard.press('Control+Enter');

    const aviso = page.getByRole('alertdialog');

    await expect(aviso).toBeVisible({ timeout: 30_000 });

    // La respuesta se espera desde antes de confirmar: el aviso desaparece en
    // cuanto se pulsa, mucho antes de que el servidor conteste, y sin esperar a
    // que termine la consulta siguiente llegaría pisando a esta.
    const respuesta = page.waitForResponse(
      (r) => r.url().includes('/api/queries') && r.request().method() === 'POST',
      { timeout: 60_000 },
    );

    await aviso.getByRole('button', { name: 'Ejecutar de todos modos' }).click();

    await expect(aviso).toBeHidden({ timeout: 60_000 });
    await respuesta;
    await expect(page.getByRole('button', { name: 'Cancelar' }).first()).toBeDisabled({
      timeout: 30_000,
    });
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
   * Repetir la copia con «actualizar lo que ya esté» no duplica nada.
   *
   * Es el caso que hace repetible un traslado, y el que peor se comprueba sin la
   * aplicación delante: lo que importa no es el mensaje del asistente, sino que
   * al final haya tres filas y no seis.
   */
  test('repetir la copia actualizando no duplica las filas', async ({ page }) => {
    await abrir(page);
    await conectar(page);
    await prepararTablas(page, { conClave: true });

    // Dos vueltas iguales: la segunda es la que tiene que no cambiar nada.
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      await menuDeLaTabla(page, ORIGEN);
      await page.getByRole('menuitem', { name: 'Migrar datos a…' }).click();

      const dialogo = page.locator('app-transfer-dialog');

      await elegirDestino(page, DESTINO);

      await dialogo.locator('.options select').first().selectOption('Upsert');

      // La clave primaria viene propuesta: no hay que elegir nada.
      await expect(dialogo.locator('.keys')).toContainText('clave primaria');

      await dialogo.getByRole('button', { name: 'Copiar las filas' }).click();

      await expect(dialogo.locator('.summary__title')).toContainText('Copiadas 3 filas', {
        timeout: 60_000,
      });

      await dialogo.locator('.foot').getByRole('button', { name: 'Cerrar' }).click();
      await expect(dialogo).toBeHidden();

      expect(await contar(page, DESTINO)).toBe('3');
    }
  });

  /**
   * La tabla de destino se puede crear desde el propio asistente.
   *
   * Es el camino que evita salir a escribir un `CREATE TABLE` a mano y volver.
   * Dentro del mismo motor no hay tipos que traducir, así que lo que se comprueba
   * aquí es el recorrido entero: elegir dónde, ponerle nombre, ver con qué se va a
   * crear, crearla y copiar dentro **sin tocar nada más**.
   */
  test('crea la tabla de destino y copia dentro', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const nueva = `e2e_migracion_nueva_${Date.now()}`;

    await prepararTablas(page);

    await menuDeLaTabla(page, ORIGEN);
    await page.getByRole('menuitem', { name: 'Migrar datos a…' }).click();

    const dialogo = page.locator('app-transfer-dialog');

    // Se baja hasta la carpeta donde vivirá, porque de ahí salen su base y su
    // esquema: crear en la base que no era es de los errores que no se ven hasta
    // que alguien busca la tabla donde debería estar.
    for (const paso of ['druse_test', 'public', 'Tables']) {
      const nodo = dialogo.locator('.browser__item', { hasText: paso }).first();

      await expect(nodo).toBeVisible({ timeout: 30_000 });
      await nodo.click();
    }

    await dialogo.locator('.new-table input').fill(nueva);
    await dialogo.getByRole('button', { name: 'Crear tabla…' }).click();

    // Mismo motor: no hay nada que traducir, y el asistente lo dice en lugar de
    // enseñar una tabla de tipos vacía.
    await expect(dialogo.locator('.route')).toContainText(nueva, { timeout: 30_000 });
    await expect(dialogo.locator('.body')).toContainText('mismo motor');

    await dialogo.getByRole('button', { name: 'Crear la tabla' }).click();

    await expect(dialogo.locator('.mapping')).toBeVisible({ timeout: 30_000 });
    await expect(dialogo.locator('.hint')).toContainText('2 de 2 columnas');

    await dialogo.getByRole('button', { name: 'Copiar las filas' }).click();

    await expect(dialogo.locator('.summary__title')).toContainText('Copiadas 3 filas', {
      timeout: 60_000,
    });

    await dialogo.locator('.foot').getByRole('button', { name: 'Cerrar' }).click();
    await expect(dialogo).toBeHidden();

    // La tabla existe y tiene dentro lo que se copió.
    expect(await contar(page, nueva)).toBe('3');

    await escribirSql(page, `DROP TABLE IF EXISTS ${nueva}`);
    await page.keyboard.press('Control+Enter');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ejecutar de todos modos' }).click();
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
  /**
   * Varias tablas en una pasada, con el orden que exigen sus foráneas.
   *
   * Es la fase 4 vista desde la pantalla: se marcan las tablas del sitio, se
   * elige a dónde van —un sitio, no una tabla— y el asistente enseña en qué orden
   * irán antes de escribir nada. Lo que se comprueba al final son las filas de
   * las dos tablas del destino.
   */
  test('migra varias tablas a la vez, las padres antes que las hijas', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const esquema = 'e2e_pasada';

    // El destino es otro esquema con **las mismas tablas**, porque la pasada
    // empareja por nombre. Y la hija de allí lleva la foránea, que es lo que
    // obliga a ordenar.
    await ejecutarConAviso(
      page,
      `DROP SCHEMA IF EXISTS ${esquema} CASCADE;
       DROP TABLE IF EXISTS e2e_pedidos;
       DROP TABLE IF EXISTS e2e_clientes;
       CREATE TABLE e2e_clientes (id int PRIMARY KEY, nombre text);
       CREATE TABLE e2e_pedidos (id int PRIMARY KEY, cliente_id int);
       INSERT INTO e2e_clientes VALUES (1, 'Ana'), (2, 'Bea');
       INSERT INTO e2e_pedidos VALUES (10, 1), (11, 1), (12, 2);
       CREATE SCHEMA ${esquema};
       CREATE TABLE ${esquema}.e2e_clientes (id int PRIMARY KEY, nombre text);
       CREATE TABLE ${esquema}.e2e_pedidos (
         id int PRIMARY KEY,
         cliente_id int REFERENCES ${esquema}.e2e_clientes (id));`,
    );

    // La pasada sale del sitio donde viven las tablas, no del menú de una.
    await desplegar(page, 'druse_test', 'public');
    await desplegar(page, 'public', 'Tables');

    const sidebar = page.locator('app-connections-sidebar');
    const carpeta = sidebar.locator('.node', { hasText: 'Tables' }).first();

    await carpeta.getByRole('button', { name: 'Acciones para Tables' }).click();
    await page.getByRole('menuitem', { name: 'Migrar tablas a…' }).click();

    const dialogo = page.locator('app-transfer-set-dialog');

    await expect(dialogo).toBeVisible();

    // En `public` hay más tablas de otras pruebas: se empieza por ninguna y se
    // marcan las dos que interesan.
    await dialogo.getByRole('button', { name: 'Ninguna' }).click();

    for (const tabla of ['e2e_clientes', 'e2e_pedidos']) {
      await dialogo.locator('.tables__row', { hasText: tabla }).first().locator('input').check();
    }

    await dialogo.getByRole('button', { name: 'Elegir destino' }).click();

    for (const paso of ['druse_test', esquema, 'Tables']) {
      const nodo = dialogo.locator('.browser__item', { hasText: paso }).first();

      await expect(nodo).toBeVisible({ timeout: 30_000 });
      await nodo.click();
    }

    await dialogo.getByRole('button', { name: 'Migrar a' }).click();

    // El orden es el producto de la fase: la padre primero, aunque se marcaran
    // por orden alfabético.
    await expect(dialogo.locator('.plan__title')).toContainText('Se copian en este orden', {
      timeout: 30_000,
    });

    const orden = await dialogo.locator('.plan__list li').allTextContents();

    expect(orden.map((linea) => linea.trim())).toEqual([
      `${esquema}.e2e_clientes`,
      `${esquema}.e2e_pedidos`,
    ]);

    await dialogo.getByRole('button', { name: 'Copiar 2 tablas' }).click();

    await expect(dialogo.locator('.summary__title')).toContainText('Copiadas 5 filas de 2 tablas', {
      timeout: 60_000,
    });

    await dialogo.locator('.foot').getByRole('button', { name: 'Cerrar' }).click();
    await expect(dialogo).toBeHidden();

    // Lo que demuestra que la pasada sirvió: las filas están al otro lado, y la
    // hija entró sin que la foránea la rechazara.
    expect(await contar(page, `${esquema}.e2e_clientes`)).toBe('2');
    expect(await contar(page, `${esquema}.e2e_pedidos`)).toBe('3');

    await ejecutarConAviso(
      page,
      `DROP SCHEMA IF EXISTS ${esquema} CASCADE;
       DROP TABLE IF EXISTS e2e_pedidos;
       DROP TABLE IF EXISTS e2e_clientes;`,
    );
  });
});
