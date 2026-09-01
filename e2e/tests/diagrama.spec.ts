import { expect, test, type Page } from '@playwright/test';

import { abrir, conectar } from '../support/druse';

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
