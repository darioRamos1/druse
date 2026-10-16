import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrir, apuntarPestanaA } from '../support/druse';
import { t } from '../support/i18n';
import type { AiChatRequest } from '../../frontend/src/app/shared/models/ai';

for (const locale of ['es', 'en']) {
  test(`guarda notas, filtra su ámbito y revoca el permiso del proveedor (${locale})`, async ({
    page,
  }) => {
    const directory = join(tmpdir(), 'druse-chat-notas');
    mkdirSync(directory, { recursive: true });
    const database = join(directory, `ventas-${locale}-${Date.now()}.db`);
    const db = new DatabaseSync(database);
    db.exec('CREATE TABLE facturas (id INTEGER PRIMARY KEY, importe NUMERIC);');
    db.close();
    const providerResponse = await page.request.post('/api/ai/providers', {
      data: {
        name: `Notas ${locale} ${Date.now()}`,
        kind: 'localcli',
        command: 'codex',
        model: 'gpt-6.1-sol',
        baseUrl: '',
        disclosure: 'schema',
        ownSession: false,
        isDefault: true,
      },
    });
    expect(providerResponse.ok()).toBe(true);
    const provider = (await providerResponse.json()).provider;
    const requests: AiChatRequest[] = [];
    await page.route('**/api/ai/chat', (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'event: chunk\ndata: {"text":"Respuesta de prueba"}\n\nevent: done\ndata: {}\n\n',
      });
    });
    await abrir(page, locale);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const connectionName = `E2E notas ${locale} ${Date.now()}`;
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
    await page
      .getByRole('button', { name: t('ai.title'), exact: true })
      .click();
    const panel = page.locator('app-ai-panel');
    await panel
      .getByRole('button', { name: t('ai.catalog.add'), exact: true })
      .click();
    await panel
      .locator('.catalog-option', { hasText: 'facturas' })
      .locator('input')
      .check();
    await expect(panel.locator('.catalog-status')).toBeHidden();
    const toggleNotes = () =>
      panel
        .getByRole('button', { name: t('ai.notes.title'), exact: true })
        .click();
    await toggleNotes();
    const notes = panel.locator('app-ai-notes');
    const create = async (text: string, scope: string) => {
      await notes.locator('form select').selectOption({ label: scope });
      await notes.getByLabel(t('ai.notes.text'), { exact: true }).fill(text);
      await notes
        .getByRole('button', { name: t('ai.notes.save'), exact: true })
        .click();
      await expect(
        notes.locator('.note-text', { hasText: text }),
      ).toBeVisible();
    };
    await create('Los anulados no cuentan', `main · ${t('ai.notes.base')}`);
    await create('Importe sin IVA', '"main"."facturas".importe');
    const ask = async (text: string) => {
      const before = requests.length;
      await panel.locator('.composer__input').fill(text);
      await panel
        .getByRole('button', { name: t('ai.send'), exact: true })
        .click();
      await expect.poll(() => requests.length).toBe(before + 1);
      await expect(panel.locator('.thinking')).toHaveCount(0);
    };
    await toggleNotes();
    await ask('Sin permiso');
    expect(requests.at(-1)?.shareBusinessNotes).toBe(false);
    expect(requests.at(-1)?.context?.notes).toBeUndefined();
    await toggleNotes();
    const grant = notes.getByLabel(
      t('ai.notes.share', { provider: provider.name }),
      { exact: true },
    );
    await grant.check();
    await expect(grant).toBeEnabled();
    await expect(
      notes.getByText(t('ai.notes.willShare'), { exact: true }),
    ).toHaveCount(2);
    for (const theme of ['light', 'dark']) {
      await page
        .getByRole('button', { name: t(`topbar.theme.${theme}`), exact: true })
        .click();
      if (process.env['DRUSE_BARRIDO']) {
        const captures = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';
        mkdirSync(captures, { recursive: true });
        await panel.screenshot({
          path: join(captures, `chat-notas-${locale}-${theme}.png`),
        });
      }
    }
    await toggleNotes();
    await ask('Con reglas de negocio');
    expect(
      requests
        .at(-1)
        ?.context?.notes?.map((note) => note.text)
        .sort(),
    ).toEqual(['Importe sin IVA', 'Los anulados no cuentan']);
    expect(requests.at(-1)?.messages).toHaveLength(1);
    const renamedColumn = new DatabaseSync(database);
    renamedColumn.exec(
      'ALTER TABLE facturas RENAME COLUMN importe TO subtotal;',
    );
    renamedColumn.close();
    await toggleNotes();
    await notes
      .getByRole('button', { name: t('ai.notes.reload'), exact: true })
      .click();
    await expect(
      notes.locator('.note', { hasText: 'Importe sin IVA' }),
    ).toContainText(t('ai.notes.missingColumn'));
    await toggleNotes();
    await ask('Columna renombrada');
    expect(requests.at(-1)?.context?.notes?.map((note) => note.text)).toEqual([
      'Los anulados no cuentan',
    ]);
    await panel
      .getByRole('button', {
        name: t('ai.catalog.remove', { table: '"main"."facturas"' }),
        exact: true,
      })
      .click();
    await ask('Solo notas generales');
    expect(requests.at(-1)?.context?.notes?.map((note) => note.text)).toEqual([
      'Los anulados no cuentan',
    ]);
    await toggleNotes();
    await grant.uncheck();
    await expect(grant).toBeEnabled();
    await toggleNotes();
    await ask('Permiso revocado');
    expect(requests.at(-1)?.context?.notes).toBeUndefined();
    expect(
      requests.at(-1)?.messages.map((message) => message.text),
    ).not.toContain('Con reglas de negocio');

    // La referencia rota se conserva al volver a abrir la aplicación; no se cambia por el nuevo nombre.
    const changed = new DatabaseSync(database);
    changed.exec('ALTER TABLE facturas RENAME TO emitidas;');
    changed.close();
    await page.reload();
    await expect(page.locator('#druse-splash')).toHaveCount(0);
    if ((await row.getAttribute('class'))?.includes('is-offline'))
      await row.click();
    await apuntarPestanaA(page, connectionName, 'main');
    if (!(await panel.isVisible()))
      await page
        .getByRole('button', { name: t('ai.title'), exact: true })
        .click();
    await toggleNotes();
    await expect(notes.locator('.note')).toHaveCount(2);
    await expect(grant).not.toBeChecked();
    const columnNote = notes.locator('.note', { hasText: 'Importe sin IVA' });
    await expect(columnNote).toContainText(t('ai.notes.missingObject'));
    await columnNote
      .getByRole('button', { name: t('ai.notes.edit'), exact: true })
      .click();
    await notes.locator('form select').selectOption('base');
    await notes
      .getByRole('button', { name: t('ai.notes.save'), exact: true })
      .click();
    await expect(columnNote).toContainText(t('ai.notes.base'));
    await columnNote
      .getByRole('button', { name: t('ai.notes.edit'), exact: true })
      .click();
    await notes.getByLabel(t('ai.notes.enabled'), { exact: true }).uncheck();
    await notes
      .getByRole('button', { name: t('ai.notes.save'), exact: true })
      .click();
    await expect(columnNote).toContainText(t('ai.notes.disabled'));
    await columnNote
      .getByRole('button', { name: t('ai.notes.delete'), exact: true })
      .click();
    await expect(notes.locator('.note')).toHaveCount(1);
    const owner = requests.find((request) => request.context?.notes?.length)
      ?.context?.notes?.[0].connectionId;
    expect(owner).toBeTruthy();
    expect((await page.request.delete(`/api/connections/${owner}`)).ok()).toBe(
      true,
    );
    await page.reload();
    await expect(page.locator('#druse-splash')).toHaveCount(0);
    if (!(await panel.isVisible()))
      await page
        .getByRole('button', { name: t('ai.title'), exact: true })
        .click();
    await toggleNotes();
    await notes.getByLabel(t('ai.notes.all'), { exact: true }).check();
    const orphan = notes.locator('.note', { hasText: owner! });
    await expect(orphan).toContainText(t('ai.notes.missingConnection'));
    await expect(orphan).toContainText(t('ai.notes.excluded'));
  });
}
