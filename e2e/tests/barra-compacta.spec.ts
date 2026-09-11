import { expect, test } from '@playwright/test';
import {
  abrir,
  conectar,
  escribirSql,
  esperarFinDeConsulta,
} from '../support/druse';

test('Más responde al ancho del editor, admite teclado y cabe al 125 %', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await abrir(page);
  const toolbar = page.locator('app-editor-toolbar');
  const more = toolbar.locator('summary[aria-label="Más acciones del editor"]');
  const menu = toolbar.getByRole('group', {
    name: 'Acciones del editor',
    exact: true,
  });
  await expect(
    toolbar.getByRole('button', { name: 'Formatear', exact: true }),
  ).toBeVisible();
  await expect(more).toHaveCount(0);
  await page.getByRole('button', { name: 'Asistente', exact: true }).click();
  await expect(more).toBeVisible();
  await more.press('ArrowDown');
  await expect(
    menu.getByRole('button', { name: 'Formatear SQL', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('button', { name: /Comentar/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  await more.click();
  await menu
    .getByRole('button', { name: 'Opciones de formateo', exact: true })
    .click();
  await expect(toolbar.locator('.format__option').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toolbar.locator('.format__menu')).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await menu.getByRole('button', { name: /Comentar/ }).focus();
  await page.getByRole('button', { name: 'Asistente', exact: true }).click();
  await expect(more).toHaveCount(0);
  await expect(
    toolbar.getByRole('button', { name: 'Formatear', exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 900, height: 720 });
  await more.click();
  await menu.getByRole('button', { name: /Comentar/ }).focus();
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(
    toolbar.getByRole('button', { name: 'Opciones de formateo', exact: true }),
  ).toBeFocused();

  await page.setViewportSize({ width: 900, height: 720 });
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
    await more.click();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(901);
    expect(box.y + box.height).toBeLessThanOrEqual(721);
    await page.screenshot({ path: info.outputPath('mas-acciones-125.png') });
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
  } finally {
    await page
      .getByRole('button', { name: 'Preferencias', exact: true })
      .click();
    await setScale(original);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
  }
});

test('el menú comenta SQL y mantiene Cancelar, Commit y Rollback accesibles', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1000, height: 760 });
  await abrir(page);
  await conectar(page);
  await escribirSql(page, 'SELECT 1;');
  const toolbar = page.locator('app-editor-toolbar');
  const more = toolbar.locator('summary[aria-label="Más acciones del editor"]');
  const menu = toolbar.getByRole('group', {
    name: 'Acciones del editor',
    exact: true,
  });
  await more.click();
  await menu.getByRole('button', { name: /Comentar/ }).click();
  await expect(page.locator('app-sql-editor .view-lines')).toContainText(
    '-- SELECT 1;',
  );
  await expect(menu).toBeHidden();

  await escribirSql(page, 'SELECT 1 AS espera FROM pg_sleep(3);');
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/queries') && r.request().method() === 'POST',
  );
  await toolbar.getByRole('button', { name: 'Ejecutar', exact: true }).click();
  await expect(
    toolbar.getByRole('button', { name: 'Cancelar', exact: true }),
  ).toBeVisible();
  await more.click();
  const begin = menu.getByRole('button', { name: /Iniciar transacción/ });
  await expect(begin).toBeDisabled();
  await expect(begin).toContainText('termine la consulta');
  await response;
  await esperarFinDeConsulta(page);
  await expect(
    page.locator('app-results-grid .cell--value').first(),
  ).toHaveText('1');
  await expect(begin).toBeEnabled();
  await begin.click();
  const rollback = toolbar.getByRole('button', {
    name: 'Rollback',
    exact: true,
  });
  try {
    await expect(
      toolbar.getByRole('button', { name: 'Commit', exact: true }),
    ).toBeVisible();
    await expect(rollback).toBeEnabled();
    await expect(menu).toBeHidden();
    await page.screenshot({
      path: info.outputPath('transaccion-barra-compacta.png'),
    });
  } finally {
    if (await rollback.isVisible()) await rollback.click();
  }
  await expect(rollback).toHaveCount(0);
});
