import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { abrir, escribirSql } from '../support/druse';
import { confirmarEnvio } from '../support/ai-context';
import { t } from '../support/i18n';
import type {
  AiChatPreview,
  AiChatRequest,
} from '../../frontend/src/app/shared/models/ai';

for (const locale of ['es', 'en']) {
  test(`revisa el texto real, reduce historial y bloquea excesos sin recortar (${locale})`, async ({
    page,
  }) => {
    page.setDefaultTimeout(15_000);
    const saved = await page.request.post('/api/ai/providers', {
      data: {
        name: `Vista previa ${locale} ${Date.now()}`,
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
    const requests: AiChatRequest[] = [];
    const receipts: AiChatPreview[] = [];
    await page.route('**/api/ai/chat', async (route) => {
      const payload = route.request().postDataJSON() as AiChatRequest;
      // Composición y límites reales; únicamente se simula la inferencia externa.
      const response = await page.request.post('/api/ai/chat/preview', {
        data: payload,
      });
      expect(response.ok()).toBe(true);
      const prepared = (await response.json()) as AiChatPreview;
      expect(prepared.hash).toBe(payload.previewHash);
      expect(prepared.valid).toBe(true);
      requests.push(payload);
      receipts.push(prepared);
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          `event: context\ndata: ${JSON.stringify({ text: prepared.context, hash: prepared.hash, providerId: payload.providerId, model: payload.model, disclosure: payload.disclosure })}\n\n` +
          `event: chunk\ndata: ${JSON.stringify({ text: '```json\n{"ok":true}\n```\n```sql-replace\nSELECT 2;\n```' })}\n\nevent: done\ndata: {}\n\n`,
      });
    });
    await abrir(page, locale);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await escribirSql(page, "SELECT 'á😀' AS original;");
    await page
      .getByRole('button', { name: t('ai.title'), exact: true })
      .click();
    const panel = page.locator('app-ai-panel');
    const preview = panel.locator('app-ai-preview');
    const prepare = async (question: string) => {
      await panel.locator('.composer__input').fill(question);
      await panel
        .getByRole('button', { name: t('ai.send'), exact: true })
        .click();
      await expect(preview).toBeVisible();
    };
    await prepare('Primera pregunta');
    expect(requests).toHaveLength(0);
    const context = await preview.locator('.attached-context').innerText();
    expect(context).toContain("SELECT 'á😀' AS original;");
    await expect(preview).toContainText(t('ai.preview.unknownCapacity'));
    await escribirSql(page, 'SELECT cambiado;');
    await expect(preview.locator('.attached-context')).toHaveText(context);
    for (const theme of ['light', 'dark']) {
      await page
        .getByRole('button', { name: t(`topbar.theme.${theme}`), exact: true })
        .click();
      if (theme === 'light')
        await page.setViewportSize({ width: 900, height: 1000 });
      if (process.env['DRUSE_BARRIDO']) {
        const captures = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';
        mkdirSync(captures, { recursive: true });
        await panel.screenshot({
          path: join(captures, `chat-previa-${locale}-${theme}.png`),
        });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await confirmarEnvio(page);
    await expect(panel.locator('.code__code')).toHaveText('{"ok":true}');
    const json = panel.locator('.sql', { has: page.locator('.code__code') });
    await expect(json.getByRole('button')).toHaveCount(1);
    await expect(
      json.getByRole('button', { name: t('ai.copy'), exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: t('ai.replaceQuery'), exact: true }),
    ).toHaveCount(1);
    expect(receipts[0].context).toBe(context);
    expect(requests[0].context?.sql).toBe("SELECT 'á😀' AS original;");
    await panel.locator('.context-detail summary').click();
    await expect(panel.locator('.context-detail pre')).toHaveText(context);
    await prepare('Segunda pregunta');
    await expect(preview).toContainText(
      t('ai.preview.historyCount', { count: 1 }),
    );
    await preview
      .getByLabel(t('ai.preview.history'), { exact: true })
      .selectOption('0');
    await expect(preview.locator('.omitted')).toContainText('Primera pregunta');
    await expect(preview).toContainText(
      t('ai.preview.historyCount', { count: 0 }),
    );
    await confirmarEnvio(page);
    await expect(panel.locator('.turn--user')).toHaveCount(2);
    expect(requests[1].messages).toEqual([
      { role: 'user', text: 'Segunda pregunta' },
    ]);
    const oversized = 'SELECT ' + 'x'.repeat(17000);
    await escribirSql(page, oversized);
    await prepare('No recortes el SQL');
    await expect(
      preview.getByRole('button', { name: t('ai.preview.send'), exact: true }),
    ).toBeDisabled();
    await expect(preview.locator('.problems')).toContainText(
      t('ai.preview.tooLarge'),
    );
    expect(
      (await preview.locator('.attached-context').innerText()).includes(
        oversized,
      ),
    ).toBe(true);
    expect(requests).toHaveLength(2);
    await preview
      .getByRole('button', { name: t('ai.preview.back'), exact: true })
      .click();
    await expect(panel.locator('.composer__input')).toHaveValue(
      'No recortes el SQL',
    );
    await expect(panel.locator('.turn--user')).toHaveCount(2);
  });
}
