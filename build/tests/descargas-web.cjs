const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { EDITIONS, parseVersion, compareVersions, selectRelease, renderDownloads, renderGuide, generatePages, escapeHtml } = require('../scripts/generar-descargas-web.cjs');

function release(version = '1.11.0', legacy = false) {
  const tag = `v${version}`;
  const names = legacy
    ? ['Druse-Comunidad-1.3.0-beta.1-win-x64-setup.exe', 'SHA256SUMS.txt']
    : [...EDITIONS.flatMap(edition => [`Druse-${version}-windows-x86_64-${edition.id}-setup.exe`, `Druse-${version}-windows-x86_64-${edition.id}-portable.zip`]), 'SHA256SUMS.txt'];
  return {
    tag_name: tag, draft: false, prerelease: version.includes('-'), published_at: '2026-10-28T16:00:00Z',
    assets: names.map(name => ({ name, size: 42, state: 'uploaded', browser_download_url: `https://github.com/darioRamos1/druse/releases/download/${tag}/${name}` })),
  };
}

test('elige por versión semántica entre todas las páginas; descarta borradores y publicaciones sin fecha', () => {
  const draft = { ...release('9.0.0'), draft: true };
  const unpublished = { ...release('8.0.0'), published_at: null };
  const selected = selectRelease([[release('1.9.0'), draft], [release('1.11.0'), release('1.10.0'), unpublished]]);
  assert.equal(selected.version, '1.11.0');
  assert.equal(selectRelease([release('1.11.0-beta.9'), release('1.11.0-beta.10')]).version, '1.11.0-beta.10');
  assert.equal(selectRelease([release('1.11.0-rc.1'), release('1.11.0')]).version, '1.11.0');
  assert.equal(compareVersions(parseVersion('v1.11.0-beta.1'), parseVersion('v1.11.0-beta')), 1);
  assert.equal(compareVersions(parseVersion('v1.11.0-1'), parseVersion('v1.11.0-alpha')), -1);
});

test('una publicación nueva incompleta no sustituye las seis descargas anteriores ni mezcla versiones', () => {
  const incomplete = release('1.12.0');
  incomplete.assets = incomplete.assets.filter(asset => !asset.name.endsWith('-completo-portable.zip'));
  const selected = selectRelease([incomplete, release()]);
  assert.equal(selected.version, '1.11.0');
  const html = renderDownloads(selected);
  assert.equal((html.match(/href="[^"]+releases\/download[^"]+"/g) || []).length, 7);
  assert.doesNotMatch(html, /1\.12\.0|<script|fetch\(/);
  for (const edition of EDITIONS) {
    assert.match(html, new RegExp(`aria-label="Instalador para Windows de ${edition.title}"`));
    assert.match(html, new RegExp(`aria-label="Portable · ZIP de ${edition.title}"`));
  }
  assert.match(renderGuide(selected), /portable de Comunidad 1\.11\.0/);
  assert.throws(() => selectRelease([incomplete]), /No hay una publicación completa/);
});

test('la beta anterior solo ofrece el instalador que existe, con estado visible para los demás', () => {
  const selected = selectRelease([release('1.3.0-beta.1', true)]);
  const html = renderDownloads(selected);
  assert.equal(selected.legacy, true);
  assert.equal(selected.editions.filter(edition => edition.installer).length, 1);
  assert.equal(selected.editions.filter(edition => edition.portable).length, 0);
  assert.equal((html.match(/aún no disponible/g) || []).length, 5);
  assert.match(html, /Druse-Comunidad-1\.3\.0-beta\.1-win-x64-setup.exe/);
  assert.doesNotMatch(html, /href="[^"]+portable/);
  assert.match(renderGuide(selected), /portable de esta beta todavía no está disponible/);
});

test('no anuncia archivos vacíos, duplicados, a medio subir, sin hashes o con enlaces ajenos', () => {
  for (const mutate of [
    value => { value.assets[0].size = 0; },
    value => { value.assets[0].state = 'open'; },
    value => { value.assets.push({ ...value.assets[0] }); },
    value => { value.assets = value.assets.filter(asset => asset.name !== 'SHA256SUMS.txt'); },
    value => { value.assets[0].browser_download_url = 'https://example.com/Druse.exe'; },
    value => { value.assets[0].browser_download_url += '?redirect=malicious'; },
    value => { value.tag_name = 'v1.11.0"><script>alert(1)</script>'; },
  ]) {
    const invalid = release();
    mutate(invalid);
    assert.throws(() => selectRelease([invalid]), /No hay una publicación completa/);
  }
  for (const input of [null, {}, 'respuesta inválida']) assert.throws(() => selectRelease(input), /no es una lista/);
  assert.throws(() => selectRelease([], 'evil.org/o/r'), /Repositorio/);
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('un fallo de catálogo o plantilla deja ambas páginas intactas; la generación es repetible', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'druse-descargas-'));
  const folder = path.join(root, 'landing');
  fs.mkdirSync(folder);
  const index = path.join(folder, 'index.html');
  const guide = path.join(folder, 'primeros-pasos.html');
  const initial = '<main><!-- descargas:inicio -->anterior<!-- descargas:fin --></main>';
  fs.writeFileSync(index, initial);
  fs.writeFileSync(guide, 'plantilla incompleta');
  try {
    assert.throws(() => generatePages([], root), /No hay una publicación completa/);
    assert.equal(fs.readFileSync(index, 'utf8'), initial);
    assert.throws(() => generatePages([release()], root), /región única/);
    assert.equal(fs.readFileSync(index, 'utf8'), initial);
    assert.equal(fs.readFileSync(guide, 'utf8'), 'plantilla incompleta');
    fs.writeFileSync(guide, '<!-- descarga-guia:inicio -->anterior<!-- descarga-guia:fin -->');
    generatePages([release()], root);
    const html = fs.readFileSync(index, 'utf8');
    generatePages([release()], root);
    assert.equal(fs.readFileSync(index, 'utf8'), html);
    assert.match(fs.readFileSync(guide, 'utf8'), /Get-FileHash/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

module.exports = { release };
