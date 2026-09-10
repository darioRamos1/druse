import { expect, test } from '@playwright/test';

import {
  CONTENEDOR,
  abrir,
  conectar,
  conjuntos,
  ejecutar,
  escribirSql,
  primeraColumna,
} from '../support/druse';

/**
 * Lo que tiene que funcionar para que Druse sirva de algo: abrir, conectarse a
 * una base real, mirar lo que hay dentro y ejecutar una consulta.
 *
 * Es el único sitio donde se prueban las tres capas juntas —Angular, la API
 * local y un motor de verdad— y por eso son pocas y gordas: cada una cuesta
 * segundos, no milisegundos, y una suite de punta a punta que tarda diez
 * minutos deja de ejecutarse a la semana.
 */
test.describe('el camino crítico', () => {
  test('la aplicación arranca con el editor listo', async ({ page }) => {
    await abrir(page);

    await expect(
      page.getByRole('button', { name: 'Ejecutar', exact: false }).first(),
    ).toBeVisible();
    await expect(page.locator('app-results-panel')).toBeVisible();

    // Sin conexión no se puede ejecutar, y la barra lo dice en lugar de dejar
    // pulsar y fallar después.
    await expect(page.locator('app-editor-toolbar .chip').first()).toContainText('sin conexión');
  });

  /**
   * Conectar sin saberse el nombre de la base.
   *
   * Es lo que pasa con un servidor ajeno: se tienen la dirección y la clave, y el
   * nombre de la base es justo lo que se venía a buscar. Aquí se comprueba lo que
   * ve el usuario: que el formulario le enseña las suyas, y que dejándolo vacío
   * la conexión abre igual.
   */
  test('se conecta sin decir la base y entra por la primera a la que tiene acceso', async ({
    page,
  }) => {
    await abrir(page);

    await page.getByRole('button', { name: 'Nueva conexión' }).click();

    const dialogo = page.locator('app-connection-dialog');

    await expect(dialogo).toBeVisible();
    await dialogo.locator('.engine', { hasText: 'PostgreSQL' }).first().click();

    const campo = (etiqueta: string) =>
      dialogo.locator(`.field:has(.field__label:text-is("${etiqueta}")) input`).first();

    // Nombre distinto en cada ejecución: los perfiles se guardan, y repetir uno
    // haría fallar la segunda vuelta por nombre duplicado.
    const nombre = `E2E sin base ${Date.now()}`;

    await campo('Nombre').fill(nombre);
    await campo('Servidor').fill(CONTENEDOR.host);
    await campo('Puerto').fill(String(CONTENEDOR.puerto));
    await campo('Usuario').fill(CONTENEDOR.usuario);
    await campo('Contraseña').fill(CONTENEDOR.contrasena);
    await dialogo.getByRole('button', { name: /Opciones avanzadas/ }).click();
    await dialogo.getByRole('button', { name: 'Sin cifrar' }).click();

    // Lo primero: que el formulario sepa decir cuáles hay.
    await dialogo.getByRole('button', { name: 'Buscar bases de datos' }).click();
    await expect(dialogo.locator('#connection-database-detail')).toContainText('disponibles', {
      timeout: 30_000,
    });
    await expect(
      dialogo.locator(`#connection-databases option[value="${CONTENEDOR.base}"]`),
    ).toHaveCount(1);

    // Y que dejándola vacía se conecte igual.
    await campo('Base de datos').fill('');
    await dialogo.getByRole('button', { name: 'Conectar' }).click();
    await expect(dialogo).toBeHidden({ timeout: 60_000 });

    const sidebar = page.locator('app-connections-sidebar');

    await expect(sidebar.getByText(nombre).first()).toBeVisible();

    // La sesión quedó abierta contra una base de verdad, y el árbol la enseña.
    await expect(sidebar.getByText(CONTENEDOR.base, { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });

    /**
     * Y se recoge lo que se ensució.
     *
     * Las pruebas comparten aplicación, y las demás bajan por el árbol buscando
     * nodos por su nombre: dejar una segunda conexión abierta con las mismas bases
     * dentro haría que alguna acabara pulsando en el árbol que no era.
     */
    const fila = sidebar.locator('.node--connection', { hasText: nombre }).first();

    await fila.locator('.connection-menu-trigger').click();
    await fila.locator('[title="Desconectar"]').click();
    await fila.locator('.connection-menu-trigger').click();
    await fila.locator('[title="Eliminar esta conexión guardada"]').click();
    await expect(sidebar.getByText(nombre)).toHaveCount(0, { timeout: 30_000 });
  });

  test('se conecta a un PostgreSQL real y enseña sus bases', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const sidebar = page.locator('app-connections-sidebar');

    await expect(sidebar.getByText(CONTENEDOR.nombre)).toBeVisible();
    await expect(sidebar.getByText(CONTENEDOR.base, { exact: true })).toBeVisible();

    // Y la pestaña queda apuntando a esa base: es lo que decide dónde cae lo
    // que se ejecute.
    await expect(page.locator('app-editor-toolbar .chip').first()).toContainText(CONTENEDOR.base);
  });

  test('ejecuta una consulta y enseña sus filas', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    await escribirSql(page, "SELECT 'hola' AS saludo");
    await ejecutar(page, 'todo');

    await expect(page.locator('app-results-grid')).toBeVisible();
    expect(await primeraColumna(page)).toEqual(['hola']);
  });

  test('varias instrucciones dan varios conjuntos de resultados', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    await escribirSql(page, "SELECT 'uno' AS a;\nSELECT 'dos' AS b;\nSELECT 'tres' AS c");
    await ejecutar(page, 'todo');

    // Cada instrucción trae el suyo, y se eligen por pestaña.
    await expect(conjuntos(page)).toHaveCount(3);
    await expect(conjuntos(page).first()).toContainText('Resultado 1');
  });

  test('una consulta a una tabla que no existe se cuenta sin romper nada', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    await escribirSql(page, 'SELECT * FROM tabla_que_no_existe_jamas');
    await ejecutar(page, 'todo');

    await expect(page.locator('app-results-panel')).toContainText('tabla_que_no_existe_jamas');

    // Y la aplicación sigue viva: se puede ejecutar otra cosa justo después.
    await escribirSql(page, 'SELECT 1 AS uno');
    await ejecutar(page, 'todo');

    expect(await primeraColumna(page)).toEqual(['1']);
  });
});
