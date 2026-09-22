#!/usr/bin/env node
/**
 * Guardas de los catálogos de idioma que necesitan mirar el código fuente.
 *
 * La estructura de los catálogos —mismas claves en `es` y `en`, parámetros
 * iguales, ICU válido— la comprueba una prueba del frontend
 * (`core/i18n/catalogs.spec.ts`), que usa el mismo analizador que la
 * aplicación. Aquí va lo que una prueba en el navegador no puede hacer:
 * recorrer el código para ver qué claves usa.
 *
 * - **Claves que ya no usa nadie.** Se busca cada clave como texto literal en
 *   el TypeScript y las plantillas. Una clave que se construye a trozos
 *   (`'settings.section.' + id`) se declara con un comentario
 *   `i18n-keys: settings.section.*` en el archivo que la usa.
 * - **Formatos con el idioma escrito a mano.** Había `'es'` fijo en nueve
 *   `toLocaleString`, `localeCompare` e `Intl`, y cada uno habría seguido en
 *   español con la interfaz en otro idioma. Todo pasa por `locale-format.ts`.
 * - **Cuánto falta en `pt-BR` y `fr`**, solo como información: pueden estar a
 *   medias hasta que la comunidad los complete.
 *
 * Sale con código 1 si hay claves sin usar o formatos con idioma fijo.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const frontend = join(root, 'frontend', 'src');
const catalogs = join(frontend, 'i18n');

const read = (path) => readFileSync(path, 'utf8').replace(/^﻿/, '');
const catalog = (locale) => JSON.parse(read(join(catalogs, `${locale}.json`)));

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      // Solo la carpeta de los catálogos, no `core/i18n`, que es código.
      if (path !== catalogs) {
        yield* sourceFiles(path);
      }
    } else if (/\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts')) {
      yield path;
    }
  }
}

const es = catalog('es');
const keys = Object.keys(es);

let source = '';
const prefixes = [];
const fixedLocale = [];
const fixedLocalePattern =
  /(toLocale(?:String|DateString|TimeString)\(\s*['"][a-z]{2}|localeCompare\([^)]*,\s*['"][a-z]{2}|new Intl\.\w+\(\s*['"][a-z]{2})/;

for (const file of sourceFiles(frontend)) {
  const text = read(file);
  source += text + '\n';

  if (file.endsWith('.ts') && fixedLocalePattern.test(text)) {
    fixedLocale.push(relative(root, file));
  }

  for (const match of text.matchAll(/i18n-keys:\s*([\w.*-]+(?:\s*,\s*[\w.*-]+)*)/g)) {
    for (const pattern of match[1].split(',')) {
      prefixes.push({ pattern: pattern.trim(), file: relative(root, file) });
    }
  }
}

const declared = (key) =>
  prefixes.some(({ pattern }) =>
    pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern,
  );

const unused = keys.filter(
  (key) => !source.includes(`'${key}'`) && !source.includes(`"${key}"`) && !declared(key),
);

console.log(`Catálogo fuente: ${keys.length} claves.`);

for (const locale of ['en', 'pt-BR', 'fr']) {
  const translated = Object.keys(catalog(locale)).filter((key) => key in es).length;
  const percent = keys.length === 0 ? 100 : Math.floor((translated / keys.length) * 100);
  console.log(`  ${locale.padEnd(5)} ${String(percent).padStart(3)} % (${translated} de ${keys.length})`);
}

// --- Texto visible sin pasar por el catálogo ---------------------------------
//
// Nodos de texto y atributos que se leen (`aria-label`, `title`,
// `placeholder`, `alt`) escritos a mano en las plantillas. Las que aún no se
// han migrado están en `build/i18n-pendientes.json`, que se va vaciando
// feature a feature: la fase 1 se cierra con la lista vacía.
//
// Es una heurística, no un analizador de Angular: se quitan comentarios,
// interpolaciones y bloques de control, y lo que quede con letras es texto.
const pendingPath = join(root, 'build', 'i18n-pendientes.json');
const pending = new Set(JSON.parse(read(pendingPath)));

function literalsIn(html) {
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Los nombres de tecla no se traducen: el plan lo deja así (§2.5).
    .replace(/<kbd\b[^>]*>[^<]*<\/kbd>/g, ' ')
    // Lo marcado con `translate="no"` —`NULL`, `CSV`, nombres de producto— es
    // así a propósito: es el atributo de HTML para decirlo, y también lo
    // respetan los traductores del navegador.
    .replace(/<(\w+)\b[^>]*\btranslate="no"[^>]*>[^<]*<\/\1>/g, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/@(?:if|else if|for|switch|case|defer|placeholder|loading|empty|else|default)\b\s*(\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?\s*\{/g, ' ')
    .replace(/@let\s[^;]*;/g, ' ');
  const found = [];

  for (const match of clean.matchAll(/>([^<>]+)</g)) {
    // Las entidades (`&nbsp;`, `&amp;`) no son texto aunque lleven letras.
    const text = match[1].replace(/&(?:[a-z]+|#\d+);/gi, ' ').replace(/[{}]/g, ' ').trim();

    if (/\p{L}{2,}/u.test(text)) {
      found.push(text.replace(/\s+/g, ' '));
    }
  }

  for (const match of clean.matchAll(/\s(aria-label|title|placeholder|alt)="([^"]*)"/g)) {
    // Una clave del catálogo no es texto a mano: hay componentes —el selector de
    // carpetas— que reciben el título como clave y lo traducen dentro.
    if (/\p{L}{2,}/u.test(match[2]) && !(match[2] in es)) {
      found.push(`${match[1]}="${match[2]}"`);
    }
  }

  return found;
}

const withLiterals = new Map();

for (const file of sourceFiles(frontend)) {
  // `index.html` se pinta antes que Angular: su nombre accesible lo pone
  // `prepareLocale` al decidir el idioma, y el resto es la marca.
  if (relative(frontend, file) === 'index.html') {
    continue;
  }

  // Las plantillas escritas dentro del componente (`template: \`…\``) cuentan
  // igual que las de su propio archivo.
  const html = file.endsWith('.html')
    ? read(file)
    : [...read(file).matchAll(/\btemplate:\s*`([\s\S]*?)`/g)].map((match) => match[1]).join('\n');

  // Las pipes de formato de Angular usan su propio idioma, `en-US` por
  // omisión, y no el de la interfaz: una fecha salía «8/17/26» con todo en
  // español. En las plantillas ya migradas no puede quedar ninguna.
  const relativePath = relative(root, file).replaceAll('\\', '/');

  if (html && /\|\s*(?:date|number|percent|currency)\b/.test(html) && !pending.has(relativePath)) {
    fixedLocale.push(`${relativePath} (pipe de formato de Angular)`);
  }

  if (html) {
    const found = literalsIn(html);

    if (found.length > 0) {
      withLiterals.set(relative(root, file).replaceAll('\\', '/'), found);
    }
  }
}

const unexpected = [...withLiterals].filter(([file]) => !pending.has(file));
const alreadyClean = [...pending].filter((file) => !withLiterals.has(file));
const pendingLiterals = [...withLiterals]
  .filter(([file]) => pending.has(file))
  .reduce((total, [, found]) => total + found.length, 0);

console.log(
  `\nPlantillas pendientes de migrar: ${pending.size}, con ${pendingLiterals} textos a mano.`,
);

let failed = false;

if (unexpected.length > 0) {
  failed = true;
  console.error('\nTexto visible escrito a mano en plantillas ya migradas:');

  for (const [file, found] of unexpected) {
    console.error(`  ${file}`);

    for (const text of found.slice(0, 5)) {
      console.error(`    «${text}»`);
    }
  }
}

if (alreadyClean.length > 0) {
  failed = true;
  console.error(
    '\nEstas plantillas ya no tienen texto a mano: quítalas de build/i18n-pendientes.json.',
  );

  for (const file of alreadyClean) {
    console.error(`  ${file}`);
  }
}

if (fixedLocale.length > 0) {
  failed = true;
  console.error('\nFormatos con el idioma escrito a mano (usa core/i18n/locale-format.ts):');

  for (const file of fixedLocale) {
    console.error(`  ${file}`);
  }
}

if (unused.length > 0) {
  failed = true;
  console.error(`\n${unused.length} claves que no usa nadie:`);

  for (const key of unused) {
    console.error(`  ${key}`);
  }

  console.error(
    '\nBórralas de todos los catálogos o, si se construyen a trozos, decláralas con ' +
      '«i18n-keys: prefijo.*» en el archivo que las usa.',
  );
}

if (failed) {
  process.exit(1);
}

console.log('\nTodas las claves se usan y ningún formato lleva el idioma fijo.');
