// Las descargas se resuelven al publicar Pages: el visitante recibe HTML útil sin
// JavaScript y no necesita contactar con la API de GitHub para abrir la web.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_REPOSITORY = 'darioRamos1/druse';
const EDITIONS = [
  { id: 'comunidad', title: 'Comunidad', description: 'PostgreSQL, SQL Server, MySQL/MariaDB y SQLite. Sin controladores de Oracle ni IBM.', recommended: true },
  { id: 'completo', title: 'Completa', description: 'Todos los motores de Druse, incluidos Oracle e IBM Informix.' },
  { id: 'sin-informix', title: 'Sin Informix', description: 'Los motores de la edición completa, incluido Oracle, sin el controlador de IBM Informix.' },
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function parseVersion(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag);
  if (!match || match.slice(1, 4).some(value => !Number.isSafeInteger(Number(value)))) return null;
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(value => /^\d+$/.test(value) && value.length > 1 && value.startsWith('0'))) return null;
  return { version: tag.slice(1), numbers: match.slice(1, 4).map(Number), prerelease };
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] > right.numbers[index] ? 1 : -1;
  }
  if (!left.prerelease.length || !right.prerelease.length) return Number(!left.prerelease.length) - Number(!right.prerelease.length);
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return Number(a !== undefined) - Number(b !== undefined);
    if (a === b) continue;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) return BigInt(a) > BigInt(b) ? 1 : -1;
    if (numericA !== numericB) return numericA ? -1 : 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

function repositoryUrl(repository) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Repositorio de descargas no válido.');
  return `https://github.com/${repository}`;
}

function selectRelease(input, repository = DEFAULT_REPOSITORY) {
  const base = repositoryUrl(repository);
  if (!Array.isArray(input)) throw new Error('La respuesta de releases no es una lista.');
  const releases = input.flat();
  const candidates = [];
  for (const release of releases) {
    if (!release || release.draft !== false || !release.published_at || !Number.isFinite(Date.parse(release.published_at))) continue;
    const semver = parseVersion(release.tag_name);
    if (!semver || !Array.isArray(release.assets)) continue;
    const tag = release.tag_name;
    const assetUrl = name => {
      const expected = `${base}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
      const matches = release.assets.filter(asset => asset && asset.name === name && asset.state === 'uploaded' && asset.size > 0);
      if (matches.length !== 1 || matches[0].browser_download_url !== expected) return null;
      return expected;
    };
    const hashes = assetUrl('SHA256SUMS.txt');
    if (!hashes) continue;
    const editions = EDITIONS.map(edition => {
      const prefix = `Druse-${semver.version}-windows-x86_64-${edition.id}`;
      return { ...edition, installer: assetUrl(`${prefix}-setup.exe`), portable: assetUrl(`${prefix}-portable.zip`) };
    });
    const complete = editions.every(edition => edition.installer && edition.portable);
    if (!complete) {
      // Esta candidata ya estaba publicada antes de existir el catálogo. No
      // completamos sus enlaces con archivos de otra versión.
      if (tag !== 'v1.3.0-beta.1') continue;
      const legacyInstaller = assetUrl('Druse-Comunidad-1.3.0-beta.1-win-x64-setup.exe');
      if (!legacyInstaller) continue;
      for (const edition of editions) {
        edition.installer = edition.id === 'comunidad' ? legacyInstaller : null;
        edition.portable = null;
      }
    }
    candidates.push({ ...semver, tag, url: `${base}/releases/tag/${encodeURIComponent(tag)}`, hashes, editions, legacy: !complete });
  }
  candidates.sort((a, b) => compareVersions(b, a));
  if (!candidates.length) throw new Error('No hay una publicación completa de descargas ni una beta anterior compatible. Se conserva la web publicada.');
  return candidates[0];
}

function downloadButton(url, title, edition, secondary = false) {
  return url
    ? `<a class="button ${secondary ? 'button-secondary' : 'button-primary'}" href="${escapeHtml(url)}" aria-label="${escapeHtml(`${title} de ${edition}`)}">${title}</a>`
    : `<span class="download-unavailable">${title}: aún no disponible</span>`;
}

function renderDownloads(release) {
  const cards = release.editions.map(edition => `          <article class="download-edition" aria-labelledby="edition-${edition.id}">
            <p class="download-edition-label">${edition.recommended ? 'PARA EMPEZAR' : 'OTRAS OPCIONES'}</p>
            <h3 id="edition-${edition.id}">${edition.title}</h3>
            <p class="download-edition-description">${edition.description}</p>
            <div class="download-edition-actions">
              ${downloadButton(edition.installer, 'Instalador para Windows', edition.title)}
              ${downloadButton(edition.portable, 'Portable · ZIP', edition.title, true)}
            </div>
          </article>`).join('\n');
  return `        <div class="download-intro">
          <div class="download-copy">
            <p class="eyebrow">ELIGE CÓMO EMPEZAR</p>
            <h2 id="download-title">Tu próxima consulta<br />empieza con Druse.</h2>
            <p>Instala Druse o descarga el ZIP para ejecutarlo sin instalación. Sin instalar .NET ni Node.js.</p>
            <p class="availability" id="download-status">Versión ${escapeHtml(release.version)} · Windows x64${release.legacy ? ' · Beta de Comunidad' : ''}.</p>
          </div>
          <img class="download-logo" src="./assets/druse.png" alt="" width="100" height="100" />
        </div>
        <div class="download-editions">
${cards}
        </div>
        <div class="download-details">
          <p><strong>¿Instalador o portable?</strong> El instalador es la opción recomendada para uso habitual. Para usar el portable, extrae todo el ZIP y abre <code>druse.exe</code>. Las conexiones y preferencias se guardan en tu perfil de Windows; no se trasladan al copiar la carpeta.</p>
          <p>El portable requiere Microsoft Edge WebView2 instalado. El instalador puede descargarlo si falta. Los paquetes no tienen firma Authenticode; Windows puede mostrar SmartScreen. ${release.legacy ? 'Esta beta no se actualiza automáticamente. ' : ''}Consulta las limitaciones y comprobaciones de cada versión antes de descargar.</p>
          <p><a href="${escapeHtml(release.url)}">Notas de la versión y comprobaciones</a> · <a href="${escapeHtml(release.hashes)}">Hashes SHA-256</a> · <a href="./primeros-pasos.html">Prueba SQLite de diez minutos</a> · <a href="https://github.com/darioRamos1/druse/blob/main/CODE_SIGNING_POLICY.md">Política de firma</a></p>
        </div>`;
}

function renderGuide(release) {
  const community = release.editions.find(edition => edition.id === 'comunidad');
  const installerName = decodeURIComponent(community.installer.split('/').at(-1));
  return `          <p>Descarga el <a href="${escapeHtml(community.installer)}">instalador de Comunidad ${escapeHtml(release.version)}</a>
            y <a href="${escapeHtml(release.hashes)}">SHA256SUMS.txt</a> de la
            <a href="${escapeHtml(release.url)}">publicación oficial</a>. Desde la carpeta de descarga, comprueba el archivo en PowerShell:</p>
          <pre><code>Get-FileHash -LiteralPath '.\\${escapeHtml(installerName)}' -Algorithm SHA256</code></pre>
          <p>El resultado debe coincidir con la entrada del instalador en <code>SHA256SUMS.txt</code>.
            Esto comprueba la integridad; no sustituye a la firma del editor.
            El instalador puede necesitar conexión para obtener Microsoft Edge WebView2.
            Si Windows o tu organización bloquean la instalación, puedes reportarlo y detener la prueba.</p>
          <p>${community.portable ? `También puedes <a href="${escapeHtml(community.portable)}">descargar el portable de Comunidad ${escapeHtml(release.version)}</a>, comprobar su hash, extraer todo el ZIP y abrir <code>druse.exe</code>. Requiere WebView2 ya instalado.` : 'El portable de esta beta todavía no está disponible.'} Las conexiones se guardan en tu perfil de Windows.</p>`;
}

function replaceRegion(html, name, content) {
  const start = `<!-- ${name}:inicio -->`;
  const end = `<!-- ${name}:fin -->`;
  if (html.split(start).length !== 2 || html.split(end).length !== 2 || html.indexOf(start) >= html.indexOf(end)) throw new Error(`No se encuentra una región única ${name}.`);
  const beginning = html.indexOf(start) + start.length;
  return `${html.slice(0, beginning)}\n${content}\n        ${html.slice(html.indexOf(end))}`;
}

function generatePages(releases, root, repository = DEFAULT_REPOSITORY) {
  const release = selectRelease(releases, repository);
  const pages = [
    ['landing/index.html', 'descargas', renderDownloads(release)],
    ['landing/primeros-pasos.html', 'descarga-guia', renderGuide(release)],
  ].map(([file, name, content]) => {
    const destination = path.join(root, file);
    return [destination, replaceRegion(fs.readFileSync(destination, 'utf8'), name, content)];
  });
  // Se validan ambas páginas antes de escribir; una respuesta o plantilla rota
  // interrumpe Pages y deja intacto el despliegue que ya están usando las visitas.
  for (const [destination, html] of pages) fs.writeFileSync(destination, html);
  return release;
}

function main(args) {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  repositoryUrl(repository);
  let releases;
  if (args.length === 2 && args[0] === '--releases') releases = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  else if (args.length === 0) releases = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
  else throw new Error('Uso: node build/scripts/generar-descargas-web.cjs [--releases archivo.json]');
  const release = generatePages(releases, path.resolve(__dirname, '../..'), repository);
  console.log(`Descargas web: ${release.version}; ${release.legacy ? 'beta anterior, con disponibilidad explícita' : 'tres ediciones con instalador y portable'}.`);
}

module.exports = { EDITIONS, parseVersion, compareVersions, selectRelease, renderDownloads, renderGuide, replaceRegion, generatePages, escapeHtml };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`No se actualizaron las descargas: ${error.message}`); process.exitCode = 1; }
}
