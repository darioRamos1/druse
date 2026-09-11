import { expect, test } from '@playwright/test';
import { abrir, conectar, ejecutar, escribirSql } from '../support/druse';

test('la conexión lista lleva al explorador y recupera el editor para empezar a escribir', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await abrir(page);
  await conectar(page);
  await page.locator('app-editor-tabs .tabs__add').click();

  const guide = page.getByRole('region', { name: 'Conexión lista' });
  const editor = page.locator('app-sql-editor');
  const tabs = page.locator('app-editor-tabs .tab');
  const originalCount = await tabs.count();
  await expect(guide).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Ocultar explorador de bases de datos',
      exact: true,
    })
    .click();
  await guide
    .getByRole('button', { name: 'Explorar tablas', exact: true })
    .press('Enter');
  await expect(
    page.getByRole('textbox', {
      name: 'Filtrar conexiones y objetos',
      exact: true,
    }),
  ).toBeFocused();

  await page.locator('app-results-panel .panel-toggle').click();
  await expect(editor).toBeHidden();
  await guide
    .getByRole('button', { name: 'Escribir SQL', exact: true })
    .press('Enter');
  await expect(editor).toBeVisible();
  await expect
    .poll(() =>
      editor.evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
  await expect(tabs).toHaveCount(originalCount);
  await page.keyboard.type('SELECT 42');
  await expect(guide).toHaveCount(0);
  await expect(page.locator('app-results-panel')).toContainText(
    'Los resultados aparecerán aquí',
  );
  await ejecutar(page, 'todo');
  await expect(page.locator('app-results-grid')).toBeVisible();
  await escribirSql(page, '');
  await expect(guide).toHaveCount(0);

  // Una pestaña vacía sí recupera la ayuda y ofrece los dos destinos en poco espacio.
  await page.locator('app-editor-tabs .tabs__add').click();
  await page.setViewportSize({ width: 900, height: 720 });
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  const scale = page.getByRole('slider', { name: /^Interfaz/ });
  const originalScale = Number(await scale.inputValue());
  const setScale = async (value: number) => {
    await scale.press('Home');
    for (let n = 80; n < value; n += 5) await scale.press('ArrowRight');
  };
  try {
    await setScale(125);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(guide).toBeVisible();
    for (const action of ['Explorar tablas', 'Escribir SQL']) {
      const button = guide.getByRole('button', { name: action, exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(901);
      expect(box.y + box.height).toBeLessThanOrEqual(721);
    }
    await page.screenshot({ path: info.outputPath('conexion-lista-125.png') });
    await guide
      .getByRole('button', { name: 'Escribir SQL', exact: true })
      .click();
    await expect
      .poll(() =>
        editor.evaluate((node) => node.contains(document.activeElement)),
      )
      .toBe(true);
  } finally {
    await page
      .getByRole('button', { name: 'Preferencias', exact: true })
      .click();
    await setScale(originalScale);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
  }

  // En una ventana estrecha, explorar abre el panel superpuesto antes de enfocar.
  await page.setViewportSize({ width: 680, height: 720 });
  await guide
    .getByRole('button', { name: 'Explorar tablas', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', {
      name: 'Filtrar conexiones y objetos',
      exact: true,
    }),
  ).toBeFocused();
});
