import { expect, test, type Page } from '@playwright/test';

import { abrir, conectar, escribirSql, esperarFinDeConsulta } from '../support/druse';

/**
 * El diagrama entidad-relación, de punta a punta.
 *
 * Es de los casos que solo se pueden probar aquí: el lienzo dibuja lo que el
 * catálogo de un PostgreSQL de verdad devuelve, pasando por la lectura en lote
 * de la API. Las unitarias del frontend prueban la colocación con datos
 * inventados; esto prueba que lo que llega del motor se puede dibujar.
 */
test.describe('el diagrama entidad-relación', () => {
  test('se abre desde el esquema y dibuja lo que hay', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const sidebar = page.locator('app-connections-sidebar');

    // Conectar deja a la vista las **bases**, no sus esquemas: el árbol carga
    // por niveles y `public` cuelga de `druse_test`.
    const esquema = sidebar.getByText('public', { exact: true }).first();

    if (!(await esquema.isVisible().catch(() => false))) {
      await sidebar.getByText('druse_test', { exact: true }).first().click();
    }

    await expect(esquema).toBeVisible({ timeout: 60_000 });

    await sidebar
      .locator('.node', { hasText: 'public' })
      .first()
      .getByRole('button', { name: 'Acciones para public' })
      .click();

    await page.getByRole('menuitem', { name: 'Ver diagrama' }).click();

    const panel = page.locator('app-diagram-panel');
    await expect(panel).toBeVisible();

    // Sobre un esquema se pregunta primero qué tablas entran: dibujar las
    // trescientas de una base es una tela de araña y una espera.
    const elegir = panel.locator('.chooser');
    await expect(elegir).toBeVisible({ timeout: 60_000 });
    await expect(panel.locator('.pick').first()).toBeVisible();

    // Entran todas marcadas, así que basta con confirmar.
    await panel.getByRole('button', { name: 'Dibujar' }).click();

    // La lectura del catálogo tarda: son varias tablas en una sola petición.
    const cajas = panel.locator('.node');
    await expect(cajas.first()).toBeVisible({ timeout: 60_000 });

    const dibujadas = await cajas.count();
    expect(dibujadas).toBeGreaterThan(0);

    // La leyenda está siempre, porque el círculo de «admite nulos» no se
    // entiende sin ella.
    await expect(panel.locator('.legend__item')).toHaveCount(3);

    // --- El nivel de detalle cambia lo que se ve --------------------------
    const filasCompleto = await panel.locator('.row').count();

    await panel.getByRole('button', { name: 'Plegado' }).click();
    await expect(panel.locator('.row')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Completo' }).click();
    await expect(panel.locator('.row')).toHaveCount(filasCompleto);

    // --- Marcar una tabla resalta sus vecinas -----------------------------
    await cajas.first().locator('.node__head').click();

    // Con más de una tabla, marcar una apaga algo; con una sola, no hay nada
    // que apagar y el diagrama se queda igual. Las dos son correctas.
    if (dibujadas > 1) {
      await expect(panel.locator('.node.is-dim').first()).toBeVisible();
    }

    await panel.getByRole('button', { name: 'Cerrar' }).click();
    await expect(panel).toBeHidden();
  });

  /**
   * El ciclo entero de guardar: lo que se guarda son las decisiones —qué tablas
   * entran—, y al volver a abrir el diagrama se abre como se dejó, sin
   * preguntar. Solo se ve con la base local de por medio.
   */
  test('recuerda el diagrama, y se puede olvidar', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const panel = page.locator('app-diagram-panel');

    await abrirDiagrama(page);
    await expect(panel.locator('.chooser')).toBeVisible({ timeout: 60_000 });

    // Se deja solo una tabla marcada, que es lo que hay que reconocer después.
    await panel.getByRole('button', { name: 'Ninguna' }).click();
    await panel.locator('.pick').first().click();
    await panel.getByRole('button', { name: 'Dibujar' }).click();

    await expect(panel.locator('.node')).toHaveCount(1, { timeout: 60_000 });
    await panel.getByRole('button', { name: 'Guardar' }).click();
    await panel.getByRole('button', { name: 'Cerrar' }).click();
    await expect(panel).toBeHidden();

    // Al reabrirlo no pregunta: se abre como se dejó.
    await abrirDiagrama(page);
    await expect(panel.locator('.node')).toHaveCount(1, { timeout: 60_000 });
    await expect(panel.locator('.chooser')).toBeHidden();

    // Y se puede olvidar, o el diagrama guardado sería para siempre. Además
    // deja la base de pruebas como estaba para la otra prueba.
    await panel.getByRole('button', { name: 'Olvidar' }).click();
    await expect(panel.locator('.notice')).toContainText('Se olvidó');

    await panel.getByRole('button', { name: 'Cerrar' }).click();
    await expect(panel).toBeHidden();
  });

  /**
   * La razón de ser de las relaciones sugeridas: una base sin claves foráneas.
   *
   * Se crean dos tablas relacionadas **solo por el nombre**, que es como está media
   * base heredada, y se comprueba que el diagrama las une con su trazo propio. Es
   * lo único que demuestra el dibujo de relaciones de punta a punta: el esquema de
   * pruebas no declara ni una clave foránea.
   *
   * La columna se llama `mer_cliente_id` y no `cliente_id` a propósito: lo que
   * Druse busca es el nombre **de la tabla**, y `cliente_id` no nombra a
   * `mer_cliente`. Escribirlo mal la primera vez dejó el lienzo sin líneas, que es
   * exactamente lo que tenía que pasar.
   */
  test('supone la relación que el motor no declara, y se puede apagar', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    const panel = page.locator('app-diagram-panel');

    await ejecutarConAviso(
      page,
      `DROP TABLE IF EXISTS mer_pedido;
     DROP TABLE IF EXISTS mer_cliente;
     CREATE TABLE mer_cliente (id integer PRIMARY KEY, nombre text);
     CREATE TABLE mer_pedido (id integer PRIMARY KEY, mer_cliente_id integer)`,
    );

    try {
      await abrirDiagrama(page);
      await expect(panel.locator('.chooser')).toBeVisible({ timeout: 60_000 });

      // Solo las dos nuevas, para que el diagrama diga exactamente una cosa.
      await panel.getByRole('button', { name: 'Ninguna' }).click();
      await panel.locator('.pick', { hasText: 'mer_cliente' }).first().click();
      await panel.locator('.pick', { hasText: 'mer_pedido' }).first().click();
      await panel.getByRole('button', { name: 'Dibujar' }).click();

      await expect(panel.locator('.node')).toHaveCount(2, { timeout: 60_000 });

      // Ninguna clave declarada, y aun así están unidas: eso es la suposición.
      await expect(panel.locator('.wire.is-suggested')).toHaveCount(1);
      await expect(panel.locator('.wire:not(.is-suggested)')).toHaveCount(0);

      // Y se pueden apagar, que es lo que devuelve el diagrama a lo que el motor
      // garantiza.
      await panel.locator('.toggle').click();
      await expect(panel.locator('.wire')).toHaveCount(0);

      await panel.getByRole('button', { name: 'Cerrar' }).click();
      await expect(panel).toBeHidden();
    } finally {
      // La limpieza no puede poner en rojo una prueba que pasó: si algo va mal
      // aquí, las tablas quedan y el arranque de la próxima ejecución las borra,
      // que para eso empieza por `DROP TABLE IF EXISTS`.
      await ejecutarConAviso(
        page,
        'DROP TABLE IF EXISTS mer_pedido;\nDROP TABLE IF EXISTS mer_cliente',
      ).catch(() => {});
    }
  });

  /**
   * Ejecuta SQL que Druse considera peligroso, confirmando como lo haría alguien.
   *
   * Lleva `DROP`, así que la aplicación pide confirmación: es su análisis de
   * riesgo, y saltárselo aquí sería probar una aplicación que no es la que se
   * reparte.
   */
  async function ejecutarConAviso(page: Page, sql: string): Promise<void> {
    await escribirSql(page, sql);
    await page.keyboard.press('Control+Enter');

    const aviso = page.getByRole('alertdialog');
    await expect(aviso).toBeVisible({ timeout: 30_000 });
    const respuesta = page.waitForResponse(
      (response) =>
        response.url().includes('/api/queries') && response.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await aviso.getByRole('button', { name: 'Ejecutar de todos modos' }).click();
    await expect(aviso).toBeHidden({ timeout: 30_000 });
    await respuesta;
    await esperarFinDeConsulta(page);
  }
});

/** Abre el diagrama desde el menú del esquema `public`. */
async function abrirDiagrama(page: Page): Promise<void> {
  const sidebar = page.locator('app-connections-sidebar');
  const esquema = sidebar.getByText('public', { exact: true }).first();

  if (!(await esquema.isVisible().catch(() => false))) {
    await sidebar.getByText('druse_test', { exact: true }).first().click();
  }

  await expect(esquema).toBeVisible({ timeout: 60_000 });

  await sidebar
    .locator('.node', { hasText: 'public' })
    .first()
    .getByRole('button', { name: 'Acciones para public' })
    .click();

  await page.getByRole('menuitem', { name: 'Ver diagrama' }).click();
}
