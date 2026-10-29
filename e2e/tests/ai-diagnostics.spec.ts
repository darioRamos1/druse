import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { abrir } from '../support/druse';
import {
  comprobarDiagnosticoIa,
  prepararDiagnosticoIa,
} from '../support/ai-diagnostics';

test('la sesión válida no oculta el rechazo de 6.1 y una respuesta se invalida al cambiar el modelo', async ({
  page,
}) => {
  const { requests } = await prepararDiagnosticoIa(page);
  await abrir(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
  await page.getByRole('button', { name: 'Asistente', exact: true }).click();
  await page
    .locator('app-ai-panel')
    .getByRole('button', { name: 'Configurar un proveedor', exact: true })
    .click();
  const dialog = page.locator('app-ai-provider-dialog');
  const capture = process.env['DRUSE_BARRIDO']
    ? async (name: string) => {
        const directory = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';
        mkdirSync(directory, { recursive: true });
        await dialog
          .locator('.dialog')
          .screenshot({ path: join(directory, `${name}-oscuro.png`) });
      }
    : undefined;
  await comprobarDiagnosticoIa(page, capture);
  expect(requests).toHaveLength(2);
  expect((requests[0] as { model: string }).model).toBe('gpt-6.1-sol');
  const field = dialog
    .locator('.field', {
      has: page.locator('.field__label', { hasText: /^Modelo$/ }),
    })
    .locator('input');
  await field.fill('gpt-6-sol');
  await expect(dialog.locator('.diagnostic')).not.toContainText(
    'Respuesta del modelo comprobada',
  );
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Tema claro', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 760 });
  await page
    .locator('app-ai-panel')
    .getByRole('button', { name: 'Configurar un proveedor', exact: true })
    .click();
  await dialog
    .locator('.option', {
      has: page.locator('.option__name', { hasText: 'Tu cuenta ChatGPT' }),
    })
    .click();
  await dialog
    .getByRole('button', { name: 'Probar respuesta', exact: true })
    .click();
  await expect(dialog.locator('.diagnostic')).toContainText(
    'Respuesta del modelo comprobada',
  );
  if (process.env['DRUSE_BARRIDO']) {
    const directory = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';
    await dialog.locator('.diagnostic').scrollIntoViewIfNeeded();
    await dialog
      .locator('.dialog')
      .screenshot({
        path: join(directory, 'ia-respuesta-simulada-claro-900.png'),
      });
  }
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
});
