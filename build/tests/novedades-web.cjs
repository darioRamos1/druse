const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { readReleaseNotes, selectNews, renderNews, generateNews, formatDate } = require('../scripts/generar-novedades-web.cjs');

const NOTAS = `export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '1.20.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_20_0.engines', 'whatsNew.v1_20_0.messages'],
  },
  { version: '1.11.1', date: '2026-10-30', items: ['whatsNew.v1_11_1.copyMenu'] },
  {
    version: '1.11.0',
    date: '2026-10-28',
    items: [
      'whatsNew.v1_11_0.downloads',
    ],
  },
  { version: '1.3.0', date: '2026-10-02', items: ['whatsNew.v1_3_0.history'] },
];`;

const CATALOGO = {
  'whatsNew.v1_20_0.engines': 'Más motores.',
  'whatsNew.v1_20_0.messages': 'Mensajes <en> tu idioma.',
  'whatsNew.v1_11_1.copyMenu': 'Menú de copia.',
  'whatsNew.v1_11_0.downloads': 'Descargas.',
  'whatsNew.v1_3_0.history': 'Historial.',
};

test('lee las entradas de una línea y de varias, en su orden', () => {
  const entries = readReleaseNotes(NOTAS);
  assert.deepEqual(entries.map(entry => entry.version), ['1.20.0', '1.11.1', '1.11.0', '1.3.0']);
  assert.deepEqual(entries[0].items, ['whatsNew.v1_20_0.engines', 'whatsNew.v1_20_0.messages']);
  assert.deepEqual(entries[2].items, ['whatsNew.v1_11_0.downloads']);
  assert.throws(() => readReleaseNotes('export const RELEASE_NOTES = [];'), /No se encontraron/);
});

test('no anuncia versiones que todavía no se pueden descargar', () => {
  const news = selectNews(readReleaseNotes(NOTAS), CATALOGO, '1.11.1');
  assert.deepEqual(news.map(entry => entry.version), ['1.11.1', '1.11.0', '1.3.0']);
  assert.deepEqual(news[0].lines, ['Menú de copia.']);
  assert.equal(selectNews(readReleaseNotes(NOTAS), CATALOGO, '1.20.0', 2).length, 2);
});

test('una clave sin texto detiene la generación en vez de publicar un hueco', () => {
  const { 'whatsNew.v1_11_1.copyMenu': _, ...incompleto } = CATALOGO;
  assert.throws(() => selectNews(readReleaseNotes(NOTAS), incompleto, '1.20.0'), /whatsNew\.v1_11_1\.copyMenu/);
});

test('escribe HTML escapado, con fecha en español y la versión actual marcada', () => {
  const html = renderNews(selectNews(readReleaseNotes(NOTAS), CATALOGO, '1.20.0'), '1.20.0');
  assert.match(html, /Druse 1\.20\.0/);
  assert.match(html, /Mensajes &lt;en&gt; tu idioma\./);
  assert.equal((html.match(/Versión actual/g) || []).length, 1);
  assert.doesNotMatch(html, /<script/);
  assert.equal(formatDate('2026-11-12'), '12 de noviembre de 2026');
});

test('sustituye solo su región y deja intacta la página si algo falla', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'druse-novedades-'));
  const notes = path.join(root, 'frontend/src/app/core/whats-new/release-notes.ts');
  const catalog = path.join(root, 'frontend/src/i18n/es.json');
  const index = path.join(root, 'landing/index.html');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.mkdirSync(path.dirname(catalog), { recursive: true });
  fs.mkdirSync(path.dirname(index), { recursive: true });
  fs.writeFileSync(notes, NOTAS);
  fs.writeFileSync(catalog, JSON.stringify(CATALOGO));
  const initial = '<main><!-- novedades:inicio -->anterior<!-- novedades:fin --><!-- descargas:inicio -->x<!-- descargas:fin --></main>';
  fs.writeFileSync(index, initial);
  try {
    assert.throws(() => generateNews(root, '0.1.0'), /No hay novedades publicadas/);
    assert.equal(fs.readFileSync(index, 'utf8'), initial);
    generateNews(root, '1.11.1');
    const html = fs.readFileSync(index, 'utf8');
    assert.match(html, /Druse 1\.11\.1/);
    assert.doesNotMatch(html, /1\.20\.0|anterior/);
    assert.match(html, /<!-- descargas:inicio -->x<!-- descargas:fin -->/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
