import { expect, test } from '@playwright/test';
import {
  abrir,
  conectar,
  ejecutar,
  escribirSql,
  primeraColumna,
} from '../support/druse';

test('ampliar conserva SQL, filtros y tamaño; ejecutar recupera los resultados', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await abrir(page);
  await conectar(page);
  await escribirSql(
    page,
    "SELECT * FROM (VALUES ('uno'), ('dos')) AS t(nombre);",
  );
  await ejecutar(page, 'todo');
  const editor = page.locator('app-sql-editor');
  const results = page.locator('app-results-panel');
  const handle = page.getByRole('separator', {
    name: 'Alto del panel de resultados',
  });
  const editorToggle = page.locator('app-editor-toolbar .panel-toggle');
  const resultsToggle = results.locator('.panel-toggle');
  await handle.press('ArrowUp');
  const previousHeight = (await results.boundingBox())!.height;
  const previousEditorHeight = (await editor.boundingBox())!.height;
  await results.getByRole('button', { name: 'Filtros', exact: true }).click();
  const filter = page.locator('app-results-grid .filters__input').first();
  await filter.fill('uno');
  await expect.poll(() => primeraColumna(page)).toEqual(['uno']);

  // Añadir texto a través del teclado también permite comprobar el historial de deshacer.
  await page.evaluate(() => (window as any).monaco.editor.getEditors()[0].focus());
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' -- conservado');
  await expect(editor.locator('.view-lines')).toContainText('conservado');
  await editorToggle.press('Enter');
  await expect(results).toBeHidden();
  await expect(handle).toBeHidden();
  expect((await editor.boundingBox())!.height).toBeGreaterThan(
    previousEditorHeight + 100,
  );
  await info.attach('editor-ampliado', {
    body: await page.screenshot({ path: info.outputPath('editor-ampliado.png') }),
    contentType: 'image/png',
  });
  await editorToggle.press('Enter');
  await expect(results).toBeVisible();
  await expect(filter).toHaveValue('uno');
  await expect
    .poll(async () => (await results.boundingBox())!.height)
    .toBe(previousHeight);

  await resultsToggle.click();
  await expect(editor).toBeHidden();
  expect((await results.boundingBox())!.height).toBeGreaterThan(
    previousHeight + 100,
  );
  await expect(filter).toHaveValue('uno');
  await expect(
    page.getByRole('button', { name: 'Ejecutar', exact: true }),
  ).toBeVisible();
  await info.attach('resultados-ampliados', {
    body: await page.screenshot({ path: info.outputPath('resultados-ampliados.png') }),
    contentType: 'image/png',
  });
  await resultsToggle.click();
  await expect
    .poll(async () => (await results.boundingBox())!.height)
    .toBe(previousHeight);
  await page.evaluate(() => (window as any).monaco.editor.getEditors()[0].focus());
  await page.keyboard.press('Control+z');
  await expect(editor.locator('.view-lines')).not.toContainText('conservado');

  await editorToggle.click();
  await page.keyboard.press('Control+Shift+r');
  await expect(results).toBeVisible();
  await expect(
    page.locator('app-results-grid .cell--value').first(),
  ).toBeFocused();
  await resultsToggle.click();
  await resultsToggle.focus();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.evaluate((node) => node.contains(document.activeElement))).toBe(true);

  await editorToggle.click();
  await page.evaluate(() => (window as any).monaco.editor.getEditors()[0].focus());
  await ejecutar(page, 'todo');
  await expect(results).toBeVisible();
  await expect(editor).toBeVisible();
});

test('los paneles ampliados caben al 125 % y recuperan el reparto al cambiar de ventana', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await abrir(page);
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  const scale = page.getByRole('slider', { name: /^Interfaz/ });
  const original = Number(await scale.inputValue());
  const setScale = async (value: number) => {
    await scale.press('Home');
    for (let n = 80; n < value; n += 5) await scale.press('ArrowRight');
  };
  try {
    await setScale(125);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    for (const panel of ['app-editor-toolbar', 'app-results-panel']) {
      const toggle = page.locator(`${panel} .panel-toggle`);
      await toggle.click();
      await expect(toggle).toHaveAccessibleName(
        'Restaurar editor y resultados',
      );
      for (const selector of ['app-status-bar', `${panel} .panel-toggle`]) {
        const box = (await page.locator(selector).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(721);
        expect(box.x + box.width).toBeLessThanOrEqual(901);
      }
      await info.attach(`${panel}-125`, {
        body: await page.screenshot({ path: info.outputPath(`${panel}-125.png`) }),
        contentType: 'image/png',
      });
      await page.setViewportSize({ width: 1280, height: 760 });
      await toggle.click();
      await expect(page.locator('app-sql-editor')).toBeVisible();
      await expect(page.locator('app-results-panel')).toBeVisible();
      expect(
        (await page.locator('app-sql-editor').boundingBox())!.height,
      ).toBeGreaterThan(0);
      await page.setViewportSize({ width: 900, height: 720 });
    }
  } finally {
    await page
      .getByRole('button', { name: 'Preferencias', exact: true })
      .click();
    await setScale(original);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
  }
});
