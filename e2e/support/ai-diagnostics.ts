import { expect, type Page } from '@playwright/test';

/** El catálogo anuncia 6.1, pero la primera inferencia lo rechaza: la regresión real. */
export async function prepararDiagnosticoIa(
  page: Page,
): Promise<{ requests: unknown[] }> {
  const requests: unknown[] = [];
  await page.route('**/api/ai/cli/codex*', (route) =>
    route.fulfill({
      json: {
        installed: true,
        loggedIn: true,
        account: 'cuenta de prueba',
        version: 'codex-cli 0.150.1',
        detail: 'Sesión de prueba válida',
      },
    }),
  );
  await page.route('**/api/ai/providers/models', (route) =>
    route.fulfill({ json: { models: ['gpt-6.1-sol', 'gpt-6-sol'] } }),
  );
  await page.route('**/api/ai/providers/test', (route) =>
    route.fulfill({
      json: {
        reachable: true,
        modelVerified: false,
        elapsedMs: 1,
        detail: 'Configuración local correcta; respuesta sin comprobar.',
      },
    }),
  );
  await page.route('**/api/ai/providers/test-response', (route) => {
    requests.push(route.request().postDataJSON());
    const body =
      requests.length === 1
        ? `event: error\ndata: ${JSON.stringify({ code: 'unsupportedModel', message: 'model is not supported', detail: '{"error":{"message":"gpt-6.1-sol is not supported with this ChatGPT account"}}' })}\n\n`
        : 'event: chunk\ndata: {"text":"OK"}\n\nevent: done\ndata: {}\n\n';
    return route.fulfill({ contentType: 'text/event-stream', body });
  });
  return { requests };
}

/** Se llama con el diálogo abierto; las capturas indican que el proveedor es simulado. */
export async function comprobarDiagnosticoIa(
  page: Page,
  capture?: (name: string) => Promise<void>,
): Promise<void> {
  const dialog = page.locator('app-ai-provider-dialog');
  await dialog
    .locator('.option', {
      has: page.locator('.option__name', { hasText: 'Tu cuenta ChatGPT' }),
    })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'gpt-6.1-sol', exact: true }),
  ).toHaveClass(/is-selected/);
  await dialog
    .getByRole('button', { name: 'Comprobar configuración', exact: true })
    .click();
  await expect(dialog.locator('.foot .probe')).toContainText(
    'respuesta sin comprobar',
  );
  await expect(dialog.locator('.diagnostic')).not.toContainText(
    'Respuesta del modelo comprobada',
  );
  if (capture) await capture('ia-configuracion-simulada');
  await dialog
    .getByRole('button', { name: 'Probar respuesta', exact: true })
    .click();
  await expect(dialog.locator('.diagnostic .is-bad')).toContainText(
    'no admite este modelo',
  );
  await dialog.getByText('Detalle técnico', { exact: true }).click();
  await expect(dialog.locator('.diagnostic pre')).toContainText(
    'gpt-6.1-sol is not supported',
  );
  await dialog.locator('.diagnostic').scrollIntoViewIfNeeded();
  if (capture) await capture('ia-rechazo-simulado');
  await dialog
    .getByRole('button', { name: 'Probar respuesta', exact: true })
    .click();
  await expect(dialog.locator('.diagnostic')).toContainText(
    'Respuesta del modelo comprobada',
  );
  await dialog.locator('.diagnostic').scrollIntoViewIfNeeded();
  if (capture) await capture('ia-respuesta-simulada');
}
