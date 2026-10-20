import { expect, type Page } from '@playwright/test';
import { escribirSql, ejecutar } from './druse';
import { t } from './i18n';

/** La selección del chat empieza vacía y es independiente de la cuadrícula. */
export async function comprobarMuestraContexto(
  page: Page,
  capture?: (name: string) => Promise<void>,
  sql = "SELECT 1 AS id, 'Dato sintético' AS etiqueta, 'NO_COMPARTIR' AS secreto UNION ALL SELECT 2, 'Otro', 'NO_COMPARTIR';",
): Promise<void> {
  await escribirSql(page, sql);
  await ejecutar(page, 'todo');
  await escribirSql(page, 'SELECT 42 AS consulta_posterior;');
  await page
    .locator('app-results-panel')
    .getByRole('button', { name: t('ai.rows.analyze'), exact: true })
    .click();
  const picker = page.locator('app-ai-panel app-ai-rows');
  await expect(picker).toBeVisible();
  await expect(picker.locator('input:checked')).toHaveCount(0);
  await picker.locator('.column').nth(0).locator('input').first().check();
  const privateColumn = picker.locator('.column').nth(2);
  await privateColumn.locator('input').first().check();
  await privateColumn.getByLabel(t('ai.rows.mask'), { exact: true }).check();
  await picker
    .getByLabel(t('ai.rows.pickRow', { n: 1 }), { exact: true })
    .check();
  await picker
    .getByLabel(t('ai.rows.pickRow', { n: 2 }), { exact: true })
    .check();
  if (capture) await capture('muestra-filas');
}
