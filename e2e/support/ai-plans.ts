import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrir, apuntarPestanaA, escribirSql, ejecutar } from './druse';
import { confirmarEnvio } from './ai-context';
import { t } from './i18n';
import type {
  AiChatRequest,
  AiChatPreview,
} from '../../frontend/src/app/shared/models/ai';

/** Plan real de SQLite; solo la inferencia se simula para no usar una cuenta externa. */
export async function comprobarPlanContexto(
  page: Page,
  locale: string,
  capture?: (name: string) => Promise<void>,
): Promise<void> {
  page.setDefaultTimeout(15_000);
  const directory = join(tmpdir(), 'druse-chat-planes');
  mkdirSync(directory, { recursive: true });
  const database = join(directory, `plan-${locale}-${Date.now()}.db`);
  const db = new DatabaseSync(database);
  db.exec(
    'CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT); CREATE INDEX ix_nombre ON clientes(nombre);',
  );
  db.close();
  const saved = await page.request.post('/api/ai/providers', {
    data: {
      name: `Planes ${locale} ${Date.now()}`,
      kind: 'localcli',
      command: 'codex',
      model: 'gpt-6.1-sol',
      baseUrl: '',
      disclosure: 'schema',
      ownSession: false,
      isDefault: true,
    },
  });
  expect(saved.ok()).toBe(true);
  const provider = (await saved.json()).provider;
  const requests: AiChatRequest[] = [];
  const previews: AiChatPreview[] = [];
  let queries = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/queries') && request.method() === 'POST')
      queries++;
  });
  await page.route('**/api/ai/chat', async (route) => {
    const payload = route.request().postDataJSON() as AiChatRequest;
    const response = await page.request.post('/api/ai/chat/preview', {
      data: payload,
    });
    expect(response.ok()).toBe(true);
    const preview = (await response.json()) as AiChatPreview;
    expect(preview.valid).toBe(true);
    expect(preview.hash).toBe(payload.previewHash);
    requests.push(payload);
    previews.push(preview);
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        `event: context\ndata: ${JSON.stringify({ text: preview.context, hash: preview.hash, usage: preview.usage })}\n\n` +
        'event: chunk\ndata: {"text":"El plan utiliza un índice. No aporta tiempos reales."}\n\nevent: done\ndata: {}\n\n',
    });
  });
  await abrir(page, locale);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const connectionName = `Plan SQLite ${locale} ${Date.now()}`;
  await page
    .getByRole('button', { name: t('connection.title.new'), exact: true })
    .first()
    .click();
  const dialog = page.locator('app-connection-dialog');
  await dialog.locator('.engine', { hasText: 'SQLite' }).click();
  for (const [key, value] of [
    ['connection.name', connectionName],
    ['connection.file', database],
  ]) {
    await dialog
      .locator('.field', {
        has: page.locator('.field__label', { hasText: t(key) }),
      })
      .locator('input')
      .first()
      .fill(value);
  }
  await dialog
    .getByRole('button', { name: t('connection.connect'), exact: true })
    .click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await apuntarPestanaA(page, connectionName, 'main');
  const sql =
    "EXPLAIN QUERY PLAN SELECT * FROM clientes WHERE nombre = 'VALOR_PRIVADO';";
  await escribirSql(page, sql);
  await ejecutar(page, 'todo');
  await escribirSql(page, 'SELECT 42 AS consulta_posterior;');
  await page
    .locator('app-results-panel')
    .getByRole('button', { name: t('ai.plan.analyze'), exact: true })
    .click();
  const panel = page.locator('app-ai-panel');
  const editor = panel.locator('app-ai-execution-plan');
  await expect(editor).toBeVisible();
  await expect(
    editor.getByLabel(t('ai.plan.sql'), { exact: true }),
  ).toHaveValue(sql);
  await expect(
    editor.getByLabel(t('ai.plan.text'), { exact: true }),
  ).toHaveValue(/USING COVERING INDEX ix_nombre/);
  await expect(editor).toContainText(connectionName);
  expect(requests).toHaveLength(0);
  expect(queries).toBe(1);
  const reviewedSql = sql.replace('VALOR_PRIVADO', '[oculto]');
  await editor.getByLabel(t('ai.plan.sql'), { exact: true }).fill(reviewedSql);
  const reviewedText = await editor
    .getByLabel(t('ai.plan.text'), { exact: true })
    .inputValue();
  if (capture) {
    for (const [theme, width] of [
      ['dark', 1440],
      ['light', 900],
    ] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole('button', { name: t(`topbar.theme.${theme}`), exact: true })
        .click();
      await page.setViewportSize({ width, height: 1000 });
      await capture(`plan-${theme}-${width}`);
    }
  }
  await panel.getByRole('button', { name: t('ai.send'), exact: true }).click();
  const preview = panel.locator('app-ai-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.attached-context')).toContainText('ix_nombre');
  await expect(preview.locator('.attached-context')).not.toContainText(
    'VALOR_PRIVADO',
  );
  await expect(preview.locator('.attached-context')).not.toContainText(
    'consulta_posterior',
  );
  if (capture) await capture('plan-preview');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await preview
    .getByRole('button', { name: t('ai.preview.back'), exact: true })
    .click();
  await expect(
    editor.getByLabel(t('ai.plan.sql'), { exact: true }),
  ).toHaveValue(reviewedSql);
  await expect(
    editor.getByLabel(t('ai.plan.text'), { exact: true }),
  ).toHaveValue(reviewedText);
  await panel.getByRole('button', { name: t('ai.send'), exact: true }).click();
  const exactContext = await preview.locator('.attached-context').innerText();
  expect(requests).toHaveLength(0);
  await confirmarEnvio(page);
  await expect(panel.locator('.turn--assistant').last()).toContainText(
    'El plan utiliza un índice',
  );
  expect(requests).toHaveLength(1);
  expect(previews[0].context).toBe(exactContext);
  expect(previews[0].usage.planBytes).toBeGreaterThan(0);
  expect(requests[0].context?.executionPlan?.sql).toBe(reviewedSql);
  expect(requests[0].context?.sql).toBeUndefined();
  expect(requests[0].context?.rows).toBeUndefined();
  await expect(editor).toBeHidden();
  await panel
    .getByLabel(t('ai.composerLabel'), { exact: true })
    .fill('¿Qué información falta?');
  await panel.getByRole('button', { name: t('ai.send'), exact: true }).click();
  await expect(preview).toBeVisible();
  await confirmarEnvio(page);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].messages[0].context?.executionPlan?.text).toBe(
    reviewedText,
  );
  expect(requests[1].context?.executionPlan).toBeUndefined();
  expect(queries).toBe(1);
  // Revocar el permiso crea otra conversación y bloquea el adjunto pendiente.
  await page.request.post('/api/ai/providers', {
    data: { ...provider, disclosure: 'nothing' },
  });
  await page
    .locator('app-results-panel')
    .getByRole('button', { name: t('ai.plan.analyze'), exact: true })
    .click();
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(
    panel.getByRole('button', { name: t('ai.send'), exact: true }),
  ).toBeDisabled();
  expect(queries).toBe(1);
}
