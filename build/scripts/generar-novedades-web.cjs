// Las novedades de la landing salen de las mismas notas que Druse enseña en
// Preferencias → Novedades: `release-notes.ts` dice qué trae cada versión y
// `es.json` lo cuenta. Así la web y la aplicación no pueden decir cosas distintas.
//
// Solo se enseñan versiones ya publicadas —hasta la que ofrecen las
// descargas—: anunciar lo que todavía no se puede descargar confundiría.
const fs = require('node:fs');
const path = require('node:path');

const { parseVersion, compareVersions, replaceRegion, escapeHtml } = require('./generar-descargas-web.cjs');

const NOTES = 'frontend/src/app/core/whats-new/release-notes.ts';
const CATALOG = 'frontend/src/i18n/es.json';
// La primera ocupa el ancho entero y las demás van de dos en dos: con cinco no queda una sola al final.
const MAX_VERSIONS = 5;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Las entradas de `release-notes.ts`, en su orden: la más reciente primero. */
function readReleaseNotes(source) {
  const entries = [];
  const pattern = /\{\s*version:\s*'([^']+)',\s*date:\s*'(\d{4}-\d{2}-\d{2})',\s*items:\s*\[([^\]]*)\]/g;
  for (const match of source.matchAll(pattern)) {
    const items = [...match[3].matchAll(/'([^']+)'/g)].map(item => item[1]);
    entries.push({ version: match[1], date: match[2], items });
  }
  if (entries.length === 0) throw new Error('No se encontraron entradas en las notas de versión.');
  return entries;
}

function formatDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} de ${MONTHS[month - 1]} de ${year}`;
}

/**
 * Las versiones publicadas hasta `version`, con sus líneas ya escritas.
 * Una clave que falte en el catálogo detiene la generación: es un fallo
 * del repositorio, no algo que deba llegar a la web.
 */
function selectNews(entries, catalog, version, limit = MAX_VERSIONS) {
  const published = parseVersion(`v${version}`);
  if (!published) throw new Error(`Versión publicada no válida: ${version}`);
  return entries
    .filter(entry => {
      const semver = parseVersion(`v${entry.version}`);
      return semver && compareVersions(semver, published) <= 0;
    })
    .slice(0, limit)
    .map(entry => ({
      ...entry,
      lines: entry.items.map(key => {
        if (typeof catalog[key] !== 'string') throw new Error(`Falta el texto de ${key} en ${CATALOG}.`);
        return catalog[key];
      }),
    }));
}

function renderNews(news, version) {
  if (news.length === 0) throw new Error('No hay novedades publicadas que enseñar.');
  const articles = news.map((entry, index) => `          <article class="news-entry" aria-labelledby="news-${index}">
            <p class="news-meta"><span class="news-version" id="news-${index}">Druse ${escapeHtml(entry.version)}</span>
              <time datetime="${escapeHtml(entry.date)}">${escapeHtml(formatDate(entry.date))}</time>${entry.version === version ? '\n              <span class="news-current">Versión actual</span>' : ''}</p>
            <ul>
${entry.lines.map(line => `              <li>${escapeHtml(line)}</li>`).join('\n')}
            </ul>
          </article>`);
  return `        <div class="news-list">
${articles.join('\n')}
        </div>`;
}

function generateNews(root, version) {
  const entries = readReleaseNotes(fs.readFileSync(path.join(root, NOTES), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, CATALOG), 'utf8'));
  const news = selectNews(entries, catalog, version);
  const destination = path.join(root, 'landing/index.html');
  const html = replaceRegion(fs.readFileSync(destination, 'utf8'), 'novedades', renderNews(news, version));
  fs.writeFileSync(destination, html);
  return news;
}

function main(args) {
  if (args.length !== 2 || args[0] !== '--version') throw new Error('Uso: node build/scripts/generar-novedades-web.cjs --version 1.20.0');
  const news = generateNews(path.resolve(__dirname, '../..'), args[1]);
  console.log(`Novedades web: ${news.map(entry => entry.version).join(', ')}.`);
}

module.exports = { readReleaseNotes, selectNews, renderNews, generateNews, formatDate };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`No se actualizaron las novedades: ${error.message}`); process.exitCode = 1; }
}
