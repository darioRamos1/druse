import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrir, apuntarPestanaA } from '../support/druse';
import { comprobarErrorContexto } from '../support/ai-execution-error';
import { confirmarEnvio } from '../support/ai-context';
import { t } from '../support/i18n';
import type {
  AiChatRequest,
  AiChatPreview,
} from '../../frontend/src/app/shared/models/ai';

for (const locale of ['es', 'en']) {
  test(`explica un fallo real con SQL original, revisión y permiso vigente (${locale})`, async ({
    page,
  }) => {
    page.setDefaultTimeout(15_000);
    const directory = join(tmpdir(), 'druse-chat-errores');
    mkdirSync(directory, { recursive: true });
    const database = join(directory, `errores-${locale}-${Date.now()}.db`);
    const db = new DatabaseSync(database);
    db.exec('CREATE TABLE facturas (id INTEGER PRIMARY KEY);');
    db.close();
    const response = await page.request.post('/api/ai/providers', {
      data: {
        name: `Errores ${locale} ${Date.now()}`,
        kind: 'localcli',
        command: 'codex',
        model: 'gpt-6.1-sol',
        baseUrl: '',
        disclosure: 'schema',
        ownSession: false,
        isDefault: true,
      },
    });
    expect(response.ok()).toBe(true);
    const provider = (await response.json()).provider;
    const requests: AiChatRequest[] = [];
    const receipts: AiChatPreview[] = [];
    let queries = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/queries') && request.method() === 'POST')
        queries++;
    });
    await page.route('**/api/ai/chat', async (route) => {
      const payload = route.request().postDataJSON() as AiChatRequest;
      const preparedResponse = await page.request.post('/api/ai/chat/preview', {
        data: payload,
      });
      expect(preparedResponse.ok()).toBe(true);
      const prepared = (await preparedResponse.json()) as AiChatPreview;
      expect(prepared.hash).toBe(payload.previewHash);
      expect(prepared.valid).toBe(true);
      requests.push(payload);
      receipts.push(prepared);
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          `event: context\ndata: ${JSON.stringify({ text: prepared.context, hash: prepared.hash, providerId: payload.providerId, model: payload.model, disclosure: payload.disclosure })}\n\n` +
          'event: chunk\ndata: {"text":"Revisa el nombre de la tabla."}\n\nevent: done\ndata: {}\n\n',
      });
    });
    await abrir(page, locale);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const connectionName = `Errores SQLite ${locale} ${Date.now()}`;
    await page
      .getByRole('button', { name: t('connection.title.new'), exact: true })
      .first()
      .click();
    const dialog = page.locator('app-connection-dialog');
    await dialog.locator('.engine', { hasText: 'SQLite' }).click();
    await dialog
      .locator('.field', {
        has: page.locator('.field__label', { hasText: t('connection.name') }),
      })
      .locator('input')
      .first()
      .fill(connectionName);
    await dialog
      .locator('.field', {
        has: page.locator('.field__label', { hasText: t('connection.file') }),
      })
      .locator('input')
      .first()
      .fill(database);
    await dialog
      .getByRole('button', { name: t('connection.connect'), exact: true })
      .click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await apuntarPestanaA(page, connectionName, 'main');
    const panel = page.locator('app-ai-panel');
    const capture = async (name: string) => {
      if (!process.env['DRUSE_BARRIDO']) return;
      const captures = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';
      mkdirSync(captures, { recursive: true });
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page
          .getByRole('button', {
            name: t(`topbar.theme.${theme}`),
            exact: true,
          })
          .click();
        await page.setViewportSize({
          width: theme === 'light' ? 900 : 1440,
          height: 1000,
        });
        await panel.screenshot({
          path: join(captures, `${name}-${locale}-${theme}.png`),
        });
      }
    };
    await comprobarErrorContexto(page, capture);
    expect(requests).toHaveLength(0);
    const editor = panel.locator('app-ai-execution-error');
    await editor
      .getByLabel(t('ai.executionError.sql'), { exact: true })
      .fill('SELECT tabla_revisada;');
    await editor
      .getByLabel(t('ai.executionError.message'), { exact: true })
      .fill(
        "No existe tabla_revisada\nServer=servidorPrivado;Password=clavePrivada;Database=ventas;\npassword='otraClave'",
      );
    await panel
      .getByRole('button', { name: t('ai.send'), exact: true })
      .click();
    const preview = panel.locator('app-ai-preview');
    await expect(preview).toBeVisible();
    const text = await preview.locator('.attached-context').innerText();
    expect(text).toContain('SELECT tabla_revisada;');
    expect(text).not.toContain('consulta_posterior');
    expect(text).not.toContain('servidorPrivado');
    expect(text).not.toContain('clavePrivada');
    expect(text).not.toContain('otraClave');
    expect(text).toContain('[oculto]');
    await capture('error-vista-previa');
    expect(requests).toHaveLength(0);
    await confirmarEnvio(page);
    await expect(panel.locator('.turn--assistant')).toContainText(
      'Revisa el nombre de la tabla.',
    );
    expect(receipts[0].context).toBe(text);
    expect(requests[0].context?.sql).toBeUndefined();
    expect(requests[0].context?.executionError?.sql).toBe(
      'SELECT tabla_revisada;',
    );
    expect(requests[0].context?.source.database).toBe('main');
    expect(requests[0].context?.source.connectionName).toBe(connectionName);
    expect(JSON.stringify(requests[0])).not.toContain('sessionId');
    expect(JSON.stringify(requests[0])).not.toContain('resultSets');
    await panel.locator('.context-detail summary').click();
    await expect(panel.locator('.context-detail pre')).toHaveText(text);
    await expect(editor).toHaveCount(0);
    expect(queries).toBe(1);

    const revoked = await page.request.post('/api/ai/providers', {
      data: { ...provider, disclosure: 'nothing' },
    });
    expect(revoked.ok()).toBe(true);
    await page
      .locator('app-results-panel')
      .getByRole('button', {
        name: t('ai.executionError.explain'),
        exact: true,
      })
      .click();
    await expect(editor.getByRole('alert')).toContainText(
      t('ai.executionError.blocked'),
    );
    await expect(
      panel.getByRole('button', { name: t('ai.send'), exact: true }),
    ).toBeDisabled();
    await editor
      .getByRole('button', { name: t('ai.executionError.remove'), exact: true })
      .click();
    await panel.locator('.composer__input').fill('Pregunta sin adjuntos');
    await panel
      .getByRole('button', { name: t('ai.send'), exact: true })
      .click();
    await expect(preview.locator('.attached-context')).toHaveText(
      t('ai.noAttachedContext'),
    );
    await confirmarEnvio(page);
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].context).toBeUndefined();
    expect(requests[1].messages).toEqual([
      { role: 'user', text: 'Pregunta sin adjuntos' },
    ]);
    expect(queries).toBe(1);
  });
}
