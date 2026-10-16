import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { abrir } from '../support/druse';
import {
  prepararContextoChat,
  comprobarContextoChat,
} from '../support/ai-context';
import { t } from '../support/i18n';

for (const locale of ['es', 'en']) {
  test(`el chat conserva el contexto al reintentar y separa proveedores (${locale})`, async ({
    page,
  }) => {
    const requests = await prepararContextoChat(page);
    await abrir(page, locale);
    await page.setViewportSize({ width: 1440, height: 960 });
    const panel = page.locator('app-ai-panel');
    const capture = process.env['DRUSE_BARRIDO']
      ? async (name: string) => {
          const directory = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';
          mkdirSync(directory, { recursive: true });
          await panel.screenshot({
            path: join(directory, `${name}-${locale}.png`),
          });
        }
      : undefined;
    await comprobarContextoChat(page, requests, capture);
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1440, height: 960 });
      // La preferencia de tema la cambia la aplicación desde su botón habitual.
      const label =
        theme === 'light' ? t('topbar.theme.light') : t('topbar.theme.dark');
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.setViewportSize({
        width: theme === 'light' ? 900 : 1440,
        height: 960,
      });
      await expect(panel.locator('.turn--user')).toHaveCount(1);
      if (capture) await capture(`contexto-${theme}`);
    }
  });
}
