import { expect, type Page } from '@playwright/test';
import { escribirSql } from './druse';
import { t } from './i18n';

interface ChatRequest {
  providerId: string;
  model: string;
  disclosure: string;
  context?: { sql?: string; schema?: string };
  messages: { role: string; text: string }[];
}

/** Proveedores simulados: el barrido no usa cuentas ni hace inferencias externas. */
export async function prepararContextoChat(page: Page): Promise<ChatRequest[]> {
  const requests: ChatRequest[] = [];
  await page.route('**/api/ai/providers', (route) =>
    route.fulfill({
      json: {
        providers: ['p1', 'p2'].map((id, index) => ({
          id,
          name: `Proveedor de prueba ${index + 1}`,
          kind: 'openaicompatible',
          baseUrl: 'https://proveedor.example.test/v1',
          model: 'modelo-de-prueba',
          command: '',
          disclosure: 'schema',
          ownSession: false,
          isDefault: index === 0,
          hasStoredKey: true,
        })),
        canStoreKeys: true,
        storeDescription: 'Pruebas',
      },
    }),
  );
  await page.route('**/api/ai/chat', (route) => {
    const request = route.request().postDataJSON() as ChatRequest;
    requests.push(request);
    const receipt = `event: context\ndata: ${JSON.stringify({
      providerId: request.providerId,
      model: request.model,
      disclosure: request.disclosure,
      text: [request.context?.sql, request.context?.schema]
        .filter(Boolean)
        .join('\n\n'),
    })}\n\n`;
    const reply =
      requests.length === 1
        ? `event: error\ndata: ${JSON.stringify({ message: 'Fallo de prueba', code: 'other' })}\n\n`
        : `event: chunk\ndata: ${JSON.stringify({ text: '```sql\nSELECT 1 AS original;\n```' })}\n\nevent: done\ndata: {}\n\n`;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: receipt + reply,
    });
  });
  return requests;
}

export async function comprobarContextoChat(
  page: Page,
  requests: ChatRequest[],
  capture?: (name: string) => Promise<void>,
): Promise<void> {
  await escribirSql(page, 'SELECT 1 AS original;');
  await page.getByRole('button', { name: t('ai.title'), exact: true }).click();
  const panel = page.locator('app-ai-panel');
  await expect(panel.locator('.conversation-scope')).toContainText(
    t('ai.conversationScope'),
  );
  await panel.locator('textarea').fill('Explica esta consulta');
  await panel.locator('textarea').press('Enter');
  await expect(panel.locator('.failure')).toBeVisible();
  await panel.locator('.context-detail summary').click();
  await expect(panel.locator('.context-detail pre')).toContainText(
    'SELECT 1 AS original;',
  );
  if (capture) await capture('contexto-fallo-simulado');

  await escribirSql(page, 'SELECT 2 AS cambiado;');
  await panel
    .getByRole('button', { name: t('ai.retryQuestion'), exact: true })
    .click();
  await expect(panel.locator('.sql__code')).toContainText(
    'SELECT 1 AS original;',
  );
  expect(requests).toHaveLength(2);
  expect(requests[1].context).toEqual(requests[0].context);
  expect(requests[1].messages).toEqual(requests[0].messages);
  await expect(panel.locator('.turn--user')).toHaveCount(1);
  if (capture) await capture('contexto-reintento-simulado');

  await panel.locator('.picker__current').click();
  await panel.getByRole('menuitem', { name: /Proveedor de prueba 2/ }).click();
  await expect(panel.locator('.turn--user')).toHaveCount(0);
  await panel.locator('textarea').fill('Pregunta del segundo proveedor');
  await panel.locator('textarea').press('Enter');
  await expect(panel.locator('.sql__code')).toBeVisible();
  expect(requests[2].messages).toHaveLength(1);
  await panel.locator('.picker__current').click();
  await panel.getByRole('menuitem', { name: /Proveedor de prueba 1/ }).click();
  await expect(panel.locator('.turn--user')).toContainText(
    'Explica esta consulta',
  );
  if ((await panel.locator('.context-detail').getAttribute('open')) === null) {
    await panel.locator('.context-detail summary').click();
  }
  await expect(panel.locator('.context-detail pre')).toContainText(
    'SELECT 1 AS original;',
  );
}

/** El barrido general usa el catálogo de su base de prueba, sin datos de filas. */
export async function comprobarSelectorContexto(
  page: Page,
  capture: (name: string) => Promise<void>,
): Promise<void> {
  const panel = page.locator('app-ai-panel');
  await panel
    .getByRole('button', { name: t('ai.catalog.add'), exact: true })
    .click();
  const checkbox = panel.locator('.catalog-option input').first();
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  await expect(panel.locator('.catalog-status')).toBeHidden();
  await capture('selector-tablas');
}
