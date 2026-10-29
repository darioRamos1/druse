import { expect, type Page } from '@playwright/test';
import { escribirSql, ejecutar } from './druse';
import { t } from './i18n';

/** La consulta falla de verdad; solo los proveedores de IA se simulan en el barrido. */
export async function comprobarErrorContexto(
  page: Page,
  capture?: (name: string) => Promise<void>,
): Promise<void> {
  const sql = 'SELECT columna_ausente_druse FROM tabla_ausente_druse;';
  await escribirSql(page, sql);
  await ejecutar(page, 'todo');
  const explain = page.locator('app-results-panel').getByRole('button', {
    name: t('ai.executionError.explain'),
    exact: true,
  });
  await expect(explain).toBeVisible();
  await escribirSql(page, 'SELECT 42 AS consulta_posterior;');
  await explain.click();
  const panel = page.locator('app-ai-panel');
  const attachment = panel.locator('app-ai-execution-error');
  await expect(attachment).toBeVisible();
  await expect(
    attachment.getByLabel(t('ai.executionError.sql'), { exact: true }),
  ).toHaveValue(sql);
  await expect(
    attachment.getByLabel(t('ai.executionError.message'), { exact: true }),
  ).not.toHaveValue('');
  if (capture) await capture('error-adjunto');
}
