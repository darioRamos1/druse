import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrir, apuntarPestanaA } from '../support/druse';
import { comprobarMuestraContexto } from '../support/ai-rows';
import { confirmarEnvio } from '../support/ai-context';
import { t } from '../support/i18n';
import type {
  AiChatRequest,
  AiChatPreview,
} from '../../frontend/src/app/shared/models/ai';

for (const locale of ['es', 'en']) {
  test(`selecciona, oculta y revisa una muestra real sin enviar filas automáticamente (${locale})`, async ({
    page,
  }) => {
    page.setDefaultTimeout(15_000);
    const directory = join(tmpdir(), 'druse-chat-filas');
    mkdirSync(directory, { recursive: true });
    const database = join(directory, `filas-${locale}-${Date.now()}.db`);
    const db = new DatabaseSync(database);
    db.exec(
      'CREATE TABLE muestra (id INTEGER, etiqueta TEXT, secreto TEXT, opcional TEXT, detalle TEXT, archivo BLOB);',
    );
    const insert = db.prepare('INSERT INTO muestra VALUES (?, ?, ?, ?, ?, ?);');
    for (let index = 1; index <= 22; index++)
      insert.run(
        index,
        'ETIQUETA_EXCLUIDA',
        'NO_COMPARTIR',
        index === 1 ? null : '',
        'á'.repeat(700) + 'FIN_NO_COMPARTIR',
        new Uint8Array([1, 2, 3]),
      );
    db.close();
    const saved = await page.request.post('/api/ai/providers', {
      data: {
        name: `Filas ${locale} ${Date.now()}`,
        kind: 'localcli',
        command: 'codex',
        model: 'gpt-6.1-sol',
        baseUrl: '',
        disclosure: 'schemaAndRows',
        ownSession: false,
        isDefault: true,
      },
    });
    expect(saved.ok()).toBe(true);
    const provider = (await saved.json()).provider;
    const requests: AiChatRequest[] = [];
    const receipts: AiChatPreview[] = [];
    let queries = 0;
    let previews = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/queries') && request.method() === 'POST')
        queries++;
      if (
        request.url().endsWith('/api/ai/chat/preview') &&
        request.method() === 'POST'
      )
        previews++;
    });
    await page.route('**/api/ai/chat', async (route) => {
      const payload = route.request().postDataJSON() as AiChatRequest;
      const preparedResponse = await page.request.post('/api/ai/chat/preview', {
        data: payload,
      });
      expect(preparedResponse.ok()).toBe(true);
      const prepared = (await preparedResponse.json()) as AiChatPreview;
      expect(prepared.valid).toBe(true);
      expect(prepared.hash).toBe(payload.previewHash);
      requests.push(payload);
      receipts.push(prepared);
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          `event: context\ndata: ${JSON.stringify({ text: prepared.context, hash: prepared.hash, usage: prepared.usage, providerId: payload.providerId, model: payload.model, disclosure: payload.disclosure })}\n\n` +
          'event: chunk\ndata: {"text":"La muestra contiene datos omitidos; no permite inferir los valores ocultos."}\n\nevent: done\ndata: {}\n\n',
      });
    });
    await abrir(page, locale);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const connectionName = `Filas SQLite ${locale} ${Date.now()}`;
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
    await comprobarMuestraContexto(
      page,
      undefined,
      'SELECT id, etiqueta, secreto, opcional, detalle, archivo FROM muestra ORDER BY id;',
    );
    expect(requests).toHaveLength(0);
    expect(previews).toBe(0);
    expect(queries).toBe(1);
    const panel = page.locator('app-ai-panel');
    const picker = panel.locator('app-ai-rows');
    for (const column of [3, 4, 5])
      await picker
        .locator('.column')
        .nth(column)
        .locator('input')
        .first()
        .check();
    await expect(
      panel.getByRole('button', { name: t('ai.send'), exact: true }),
    ).toBeDisabled();
    await expect(picker.locator('.accept')).toBeVisible();
    await picker
      .getByLabel(t('ai.rows.acceptTruncation'), { exact: true })
      .check();
    await picker
      .getByRole('button', { name: t('ai.rows.next'), exact: true })
      .click();
    await picker
      .getByLabel(t('ai.rows.pickRow', { n: 11 }), { exact: true })
      .check();
    await expect(
      panel.getByRole('button', { name: t('ai.send'), exact: true }),
    ).toBeDisabled();
    await picker
      .getByLabel(t('ai.rows.acceptTruncation'), { exact: true })
      .check();
    await picker
      .getByRole('button', { name: t('ai.rows.previous'), exact: true })
      .click();
    await expect(
      picker.getByLabel(t('ai.rows.pickRow', { n: 1 }), { exact: true }),
    ).toBeChecked();
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
    await capture('filas-selector');
    const prepare = async () => {
      await panel
        .getByRole('button', { name: t('ai.send'), exact: true })
        .click();
      await expect(panel.locator('app-ai-preview')).toBeVisible();
    };
    await prepare();
    const preview = panel.locator('app-ai-preview');
    let text = await preview.locator('.attached-context').innerText();
    expect(text).not.toContain('NO_COMPARTIR');
    expect(text).not.toContain('ETIQUETA_EXCLUIDA');
    expect(text).not.toContain('consulta_posterior');
    expect(text).toContain('"kind":"masked"');
    expect(text).toContain('"kind":"binary"');
    expect(text).toContain('"kind":"null"');
    expect(text).toContain('"value":""');
    expect(text).toContain('"kind":"truncated"');
    await preview
      .getByRole('button', { name: t('ai.preview.back'), exact: true })
      .click();
    await expect(
      picker.getByLabel(t('ai.rows.acceptTruncation'), { exact: true }),
    ).toBeChecked();
    await expect(
      picker.getByLabel(t('ai.rows.pickRow', { n: 1 }), { exact: true }),
    ).toBeChecked();
    await expect(
      picker
        .locator('.column')
        .nth(2)
        .getByLabel(t('ai.rows.mask'), { exact: true }),
    ).toBeChecked();
    await prepare();
    await preview
      .getByLabel(t('ai.preview.history'), { exact: true })
      .selectOption('0');
    await expect(preview).toBeVisible();
    await capture('filas-previa');
    text = await preview.locator('.attached-context').innerText();
    expect(requests).toHaveLength(0);
    await confirmarEnvio(page);
    await expect(panel.locator('.turn--assistant')).toContainText(
      'La muestra contiene datos omitidos',
    );
    expect(receipts[0].context).toBe(text);
    expect(receipts[0].usage.rowsBytes).toBeGreaterThan(0);
    expect(requests[0].context?.sql).toBeUndefined();
    expect(requests[0].context?.source.database).toBe('main');
    expect(requests[0].context?.rows?.rows.map((row) => row.index)).toEqual([
      0, 1, 10,
    ]);
    expect(
      requests[0].context?.rows?.columns.map((column) => column.name),
    ).toEqual(['id', 'secreto', 'opcional', 'detalle', 'archivo']);
    expect(JSON.stringify(requests[0])).not.toContain('NO_COMPARTIR');
    expect(JSON.stringify(requests[0])).not.toContain('sessionId');
    await expect(picker).toHaveCount(0);
    await panel.locator('.context-detail summary').click();
    await expect(panel.locator('.context-detail pre')).toHaveText(text);

    const revoked = await page.request.post('/api/ai/providers', {
      data: { ...provider, disclosure: 'schema' },
    });
    expect(revoked.ok()).toBe(true);
    await page
      .locator('app-results-panel')
      .getByRole('button', { name: t('ai.rows.analyze'), exact: true })
      .click();
    await expect(picker.getByRole('alert')).toContainText(t('ai.rows.blocked'));
    await expect(
      panel.getByRole('button', { name: t('ai.send'), exact: true }),
    ).toBeDisabled();
    await picker
      .getByRole('button', { name: t('ai.rows.remove'), exact: true })
      .click();
    await panel.locator('.composer__input').fill('Pregunta sin muestra');
    await prepare();
    expect(
      await preview.locator('.attached-context').innerText(),
    ).not.toContain('executionId');
    await confirmarEnvio(page);
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].context?.rows).toBeUndefined();
    expect(requests[1].messages).toEqual([
      { role: 'user', text: 'Pregunta sin muestra' },
    ]);
    expect(queries).toBe(1);
  });
}
