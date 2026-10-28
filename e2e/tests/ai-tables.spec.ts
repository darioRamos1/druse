import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrir, escribirSql, apuntarPestanaA } from '../support/druse';
import { prepararContextoChat, confirmarEnvio } from '../support/ai-context';
import { t } from '../support/i18n';

const directory = join(tmpdir(), 'druse-chat-tablas');
const database = join(directory, 'ventas.db');

test.beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE IF NOT EXISTS clientes (empresa_id INTEGER, id INTEGER, nombre TEXT DEFAULT 'Sin nombre', PRIMARY KEY (empresa_id, id));
    CREATE TABLE IF NOT EXISTS facturas (id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL, importe NUMERIC DEFAULT 0,
    FOREIGN KEY (empresa_id, cliente_id) REFERENCES clientes (empresa_id, id));
    CREATE INDEX IF NOT EXISTS ix_importe ON facturas (importe DESC);
    CREATE VIEW IF NOT EXISTS resumen AS SELECT id, importe FROM facturas;`);
  for (let i = 0; i < 120; i++)
    db.exec(`CREATE TABLE IF NOT EXISTS ruido_${i} (id INTEGER PRIMARY KEY);`);
  db.close();
});

for (const locale of ['es', 'en']) {
  test(`selecciona contexto SQLite con @ sin leer el detalle de todo el catálogo (${locale})`, async ({
    page,
  }) => {
    const requests = await prepararContextoChat(page);
    const reads: { name: string }[] = [];
    page.on('request', (request) => {
      if (/\/(metadata\/columns|tables\/structure)$/.test(request.url()))
        reads.push(request.postDataJSON());
    });
    await abrir(page, locale);
    await page.setViewportSize({ width: 1440, height: 960 });
    const connectionName = `E2E contexto ${locale}`;
    const row = page.locator('app-connections-sidebar .node--connection', {
      hasText: connectionName,
    });
    if ((await row.count()) === 0) {
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
    } else if ((await row.getAttribute('class'))?.includes('is-offline'))
      await row.click();
    await expect(row).not.toHaveClass(/is-offline/);
    await apuntarPestanaA(page, connectionName, 'main');
    await escribirSql(page, 'SELECT 1;');
    await page
      .getByRole('button', { name: t('ai.title'), exact: true })
      .click();
    const panel = page.locator('app-ai-panel');
    await expect(panel.locator('.conversation-scope')).toContainText('main');
    expect(reads).toHaveLength(0);
    await panel
      .getByRole('button', { name: t('ai.catalog.add'), exact: true })
      .click();
    await expect(panel.locator('.catalog-option')).toHaveCount(123);
    expect(reads).toHaveLength(0);

    await panel.locator('textarea').fill('Usa @fact');
    await expect(panel.locator('.catalog-option')).toHaveCount(1);
    await panel.locator('textarea').press('Enter');
    await expect(panel.locator('.catalog-status')).toBeHidden();
    await expect(panel.locator('.catalog-picker')).toContainText(
      t('ai.catalog.related'),
    );
    await panel
      .locator('.catalog-picker .context-selection button', {
        hasText: 'clientes',
      })
      .click();
    await expect(panel.locator('.catalog-status')).toBeHidden();
    await panel.locator('textarea').fill('Calcula la cartera por cliente');
    await panel
      .getByRole('button', { name: t('ai.send'), exact: true })
      .click();
    await confirmarEnvio(page);
    await expect(panel.locator('.failure')).toBeVisible();
    expect(requests).toHaveLength(1);
    const schema = requests[0].context?.schema ?? '';
    expect(schema).toContain(
      'FOREIGN KEY ("empresa_id", "cliente_id") REFERENCES "main"."clientes" ("empresa_id", "id")',
    );
    expect(schema).toContain('PRIMARY KEY ("empresa_id", "id")');
    expect(schema).toContain('"importe" DESC');
    expect(schema).toContain('DEFAULT 0');
    expect(schema).not.toContain('ruido_');
    expect(new Set(reads.map((read) => read.name))).toEqual(
      new Set(['facturas', 'clientes']),
    );

    // Volver a abrir el panel conserva la selección y la relee en la sesión vigente.
    await page
      .getByRole('button', { name: t('ai.title'), exact: true })
      .click();
    await page
      .getByRole('button', { name: t('ai.title'), exact: true })
      .click();
    await expect(
      panel.getByRole('button', {
        name: t('ai.catalog.remove', { table: '"main"."facturas"' }),
        exact: true,
      }),
    ).toBeVisible();
    await panel
      .getByRole('button', { name: t('ai.catalog.add'), exact: true })
      .click();
    await expect(panel.locator('.catalog-status')).toBeHidden();
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page
        .getByRole('button', { name: t(`topbar.theme.${theme}`), exact: true })
        .click();
      if (theme === 'light')
        await page.setViewportSize({ width: 900, height: 960 });
      if (process.env['DRUSE_BARRIDO']) {
        const captures = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';
        mkdirSync(captures, { recursive: true });
        await panel.screenshot({
          path: join(captures, `chat-tablas-${locale}-${theme}.png`),
        });
      }
    }
  });
}
