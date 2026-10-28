import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { abrir } from '../support/druse';
import { t } from '../support/i18n';

for (const idioma of ['es', 'en']) {
  test(`el historial pagina, conserva filtros y descarta respuestas antiguas en ${idioma}`, async ({
    page,
  }) => {
    const entries = Array.from({ length: 537 }, (_, i) => ({
      id: `00000000-0000-0000-0000-${String(537 - i).padStart(12, '0')}`,
      connectionId: '00000000-0000-0000-0000-000000000001',
      connectionName: 'Principal',
      database: i % 2 ? 'reportes' : 'ventas',
      sql: `SELECT ${537 - i} AS numero;\n-- SQL completo de la consulta\nSELECT 'historial ${537 - i}' AS marca;`,
      executedAtUtc: '2026-10-02T12:00:00.0000000+00:00',
      durationMs: 12,
      succeeded: i % 3 !== 0,
      rowCount: 1,
      errorMessage: i % 3 === 0 ? 'error original' : undefined,
    }));
    const requests: URLSearchParams[] = [];
    let release: (() => void) | undefined;
    let oldCompleted = false;
    let failures = 0;
    let cleared = false;
    let queries = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/queries') && request.method() === 'POST')
        queries++;
    });
    await page.route('**/api/history*', async (route) => {
      if (route.request().method() === 'DELETE') {
        cleared = true;
        await route.fulfill({ json: { removed: entries.length } });
        return;
      }
      const params = new URL(route.request().url()).searchParams;
      requests.push(params);
      const term = params.get('search');
      if (term === 'antigua') {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await route
          .fulfill({ json: [{ ...entries[1], sql: "SELECT 'antigua'" }] })
          .catch(() => {})
          .finally(() => {
            oldCompleted = true;
          });
        return;
      }
      if (term === 'fallo-servidor' && failures++ === 0) {
        await route.fulfill({
          status: 500,
          json: { message: 'historial inaccesible' },
        });
        return;
      }
      let found = cleared
        ? []
        : entries.filter(
            (entry) =>
              (!params.get('database') ||
                entry.database.includes(params.get('database')!)) &&
              (!params.get('connection') ||
                entry.connectionName.includes(params.get('connection')!)) &&
              (!params.has('succeeded') ||
                String(entry.succeeded) === params.get('succeeded')) &&
              (!params.get('beforeId') || entry.id < params.get('beforeId')!),
          );
      if (term === 'final' || term === 'fallo-servidor')
        found = [{ ...entries[0], sql: `SELECT '${term}'` }];
      await route.fulfill({
        json: found.slice(0, Number(params.get('limit') ?? 100)),
      });
    });
    await abrir(page, idioma);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page
      .getByRole('button', { name: t('topbar.theme.dark'), exact: true })
      .click();
    await page
      .getByRole('tab', { name: t('results.tab.history'), exact: true })
      .click();
    const history = page.locator('app-query-history');
    await expect(history.locator('.item')).toHaveCount(100);
    for (let count = 200; count <= 600; count += 100) {
      await history
        .getByRole('button', { name: t('history.more'), exact: true })
        .click();
      await expect(history.locator('.item')).toHaveCount(Math.min(count, 537));
    }
    const sql = await history.locator('.item__sql').allTextContents();
    expect(new Set(sql).size).toBe(537);
    await expect(
      history.getByRole('button', { name: t('history.more'), exact: true }),
    ).toHaveCount(0);
    await history.locator('.item__detail > summary').first().click();
    await expect(history.locator('pre').first()).toBeVisible();
    await expect(history.locator('pre').first()).toHaveText(entries[0].sql);
    expect(queries).toBe(0);
    const capture = async (name: string) => {
      if (!process.env['DRUSE_BARRIDO']) return;
      const directory = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: join(directory, `${name}-${idioma}.png`) });
    };
    await capture('historial-detalle-oscuro-1440');
    await history.locator('.filter-options > summary').click();
    await history
      .getByLabel(t('history.database'), { exact: true })
      .fill('reportes');
    await history
      .getByLabel(t('history.connection'), { exact: true })
      .fill('Principal');
    await history
      .getByLabel(t('history.from'), { exact: true })
      .fill('2026-10-02');
    await history
      .getByLabel(t('history.until'), { exact: true })
      .fill('2026-10-02');
    await history
      .getByRole('combobox', { name: t('history.outcome'), exact: true })
      .selectOption('false');
    await expect(history.locator('.item')).toHaveCount(89);
    await expect(history.locator('.item:not(.is-failed)')).toHaveCount(0);
    await page
      .getByRole('tab', { name: t('results.tab.messages'), exact: true })
      .click();
    await page
      .getByRole('tab', { name: t('results.tab.history'), exact: true })
      .click();
    await expect(
      history.getByLabel(t('history.database'), { exact: true }),
    ).toHaveValue('reportes');
    await expect(history.locator('.item')).toHaveCount(89);
    await page
      .getByRole('button', { name: t('topbar.theme.light'), exact: true })
      .click();
    await page.setViewportSize({ width: 900, height: 760 });
    await history.locator('.filter-options > summary').click();
    await history.locator('.item__detail > summary').first().click();
    await history.locator('pre').first().scrollIntoViewIfNeeded();
    await capture('historial-filtros-claro-900');
    await history.locator('.filter-options > summary').click();
    await history
      .getByRole('button', { name: t('history.reset'), exact: true })
      .click();
    await expect(history.locator('.item')).toHaveCount(100);
    const search = history.getByLabel(t('history.filter.label'), {
      exact: true,
    });
    await search.fill('antigua');
    await expect
      .poll(() => requests.some((params) => params.get('search') === 'antigua'))
      .toBe(true);
    await search.fill('final');
    await expect(history.locator('.item__sql')).toHaveText("SELECT 'final'");
    release!();
    await expect.poll(() => oldCompleted).toBe(true);
    await expect(history.locator('.item__sql')).toHaveText("SELECT 'final'");
    await search.fill('fallo-servidor');
    await expect(history.getByRole('alert')).toContainText(
      'historial inaccesible',
    );
    await history
      .getByRole('button', { name: t('history.retry'), exact: true })
      .click();
    await expect(history.locator('.item__sql')).toHaveText(
      "SELECT 'fallo-servidor'",
    );
    await history.locator('.item__sql').click();
    expect(queries).toBe(0);
    await page
      .getByRole('tab', { name: t('results.tab.history'), exact: true })
      .click();
    await history
      .getByRole('button', { name: t('history.clear'), exact: true })
      .click();
    await expect(history.locator('.item')).toHaveCount(0);
    expect(cleared).toBe(true);
  });
}
