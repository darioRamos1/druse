import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import { abrir, escribirSql } from '../support/druse';

test('las reservadas y los operadores SQL tienen color en ambos temas', async ({
  page,
}) => {
  await abrir(page, 'es');
  await escribirSql(
    page,
    [
      'select p.*',
      'from clientes AS c',
      'INNER JOIN pedidos AS p on p.cliente_id = c.id',
      'where c.id is not null and p.total > 0',
      '-- Los nombres y los comentarios conservan su propio color.',
    ].join('\n'),
  );

  for (const theme of ['oscuro', 'claro']) {
    await page
      .getByRole('button', { name: `Tema ${theme}`, exact: true })
      .click();
    const colors = await page.evaluate(async () => {
      const monaco = (window as any).monaco;
      const samples = [
        'SELECT',
        'INNER',
        'JOIN',
        'LEFT',
        'OUTER',
        'CROSS',
        'AND',
        'or',
        'is',
        'not',
        'null',
        'IN',
        'EXISTS',
        'BETWEEN',
        'LIKE',
        'UNION',
        '*',
        '>=',
        'cliente_id',
        "'INNER JOIN'",
        '-- AND',
      ];
      const result: Record<string, string> = {};
      // Se usa el analizador real de Monaco: una regla de tema correcta no
      // basta si el lenguaje emite otro tipo de token para estas palabras.
      const probe = document.createElement('div');
      probe.className = 'monaco-editor';
      document.body.append(probe);
      try {
        for (const sample of samples) {
          probe.innerHTML = await monaco.editor.colorize(sample, 'sql', {});
          result[sample] = getComputedStyle(probe.querySelector('[class*="mtk"]')!).color;
        }
      } finally {
        probe.remove();
      }
      return result;
    });
    for (const word of [
      'INNER',
      'JOIN',
      'LEFT',
      'OUTER',
      'CROSS',
      'AND',
      'or',
      'is',
      'not',
      'null',
      'IN',
      'EXISTS',
      'BETWEEN',
      'LIKE',
      'UNION',
      '*',
      '>=',
    ]) {
      expect(colors[word], `${word}, tema ${theme}`).toBe(colors['SELECT']);
    }
    for (const other of ['cliente_id', "'INNER JOIN'", '-- AND']) {
      expect(colors[other]).not.toBe(colors['SELECT']);
    }
    if (process.env['DRUSE_BARRIDO_DIR']) {
      mkdirSync(process.env['DRUSE_BARRIDO_DIR'], { recursive: true });
      await page.screenshot({
        path: join(
          process.env['DRUSE_BARRIDO_DIR'],
          `sql-colores-${theme}.png`,
        ),
      });
    }
  }
});
