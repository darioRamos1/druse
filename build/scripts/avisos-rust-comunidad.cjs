// Copia avisos fijados; no declara compatibilidad legal ni elegibilidad SignPath.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function safeFile(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw Error('Ruta fuera del expediente.');
  const file = path.resolve(root, relative);
  const base = fs.realpathSync(root) + path.sep;
  if (!fs.realpathSync(file).startsWith(base)) throw Error('Ruta fuera del expediente.');
  return file;
}

function catalog(repo, name) {
  const root = path.join(repo, 'docs/terceros', name);
  const index = json(path.join(root, 'indice.json'));
  if (index.esquema !== 1 || !Array.isArray(index.paquetes) || !index.paquetes.length) throw Error('Expediente de avisos vacío o inválido.');
  const docs = new Map(), packages = new Set();
  for (const p of index.paquetes) {
    const key = `${p.componente}/${p.version}`;
    if (packages.has(key)) throw Error('Componente duplicado: ' + key);
    packages.add(key);
    if (!p.documentos?.length) throw Error('Componente sin avisos: ' + key);
    for (const d of p.documentos) {
      if (!/^fuentes\/[a-f0-9]{64}\.txt$/.test(d.archivo) || !/^[a-f0-9]{64}$/.test(d.sha256)) throw Error('Ruta/hash de aviso inválido.');
      const file = safeFile(root, d.archivo);
      if (hash(file) !== d.sha256) throw Error('Aviso alterado: ' + d.archivo);
      if (docs.has(d.archivo) && docs.get(d.archivo).sha256 !== d.sha256) throw Error('Aviso contradictorio.');
      docs.set(d.archivo, { file, sha256: d.sha256 });
    }
  }
  return { root, index, docs };
}

function copyNotices(repo, api) {
  const groups = ['comunidad-rust', 'comunidad-nativos'].map(name => ({name, ...catalog(repo, name)}));
  const rust = groups[0].index;
  if (rust.target !== 'x86_64-pc-windows-msvc' || JSON.stringify(rust.features) !== '["custom-protocol"]' ||
      rust.cargoLockSha256 !== hash(path.join(repo, 'shells/desktop-tauri/Cargo.lock')) ||
      rust.cargoTomlSha256 !== hash(path.join(repo, 'shells/desktop-tauri/Cargo.toml'))) {
    throw Error('Cambió el grafo Rust: revisar los avisos antes de empaquetar Comunidad.');
  }
  // Validar todo antes de escribir. Una salida anterior nunca sustituye evidencia.
  for (const group of groups) {
    group.destination = path.join(api, 'licenses', group.name);
    if (fs.existsSync(group.destination)) throw Error('La salida de avisos ya existe.');
  }
  for (const group of groups) {
    fs.mkdirSync(path.join(group.destination, 'fuentes'), {recursive:true});
    for (const [relative, doc] of group.docs) {
      const target = path.join(group.destination, relative);
      fs.copyFileSync(doc.file, target);
      if (hash(target) !== doc.sha256) throw Error('Copia de aviso distinta.');
    }
    for (const file of ['indice.json', 'README.md']) fs.copyFileSync(path.join(group.root, file), path.join(group.destination, file));
    console.log(`Avisos ${group.name}: ${group.index.paquetes.length} entradas, ${group.docs.size} textos únicos.`);
  }
}

function verifyNative(repo, nsisRoot, metadata) {
  const native = catalog(repo, 'comunidad-nativos').index;
  if (!native.nsisArchivos?.length) throw Error('Sin fijación del toolchain NSIS.');
  for (const file of native.nsisArchivos) {
    if (hash(safeFile(nsisRoot, file.ruta)) !== file.sha256) throw Error('NSIS cambió: ' + file.ruta);
  }
  const sdk = native.paquetes.find(p => p.componente === 'Microsoft.Web.WebView2 SDK');
  const bindings = metadata.packages.filter(p => p.name === 'webview2-com-sys');
  if (bindings.length !== 1 || !sdk?.loaderSha256) throw Error('SDK WebView2 ambiguo o sin evidencia.');
  const loader = path.join(path.dirname(bindings[0].manifest_path), 'x64/WebView2LoaderStatic.lib');
  if (hash(loader) !== sdk.loaderSha256) throw Error('Cambió el SDK/loader WebView2: revisar sus avisos.');
  console.log('OK: NSIS y SDK/loader WebView2 coinciden con el expediente.');
}

if (require.main === module) {
  try {
    const repo = path.resolve(__dirname, '../..');
    if (process.argv[2] === '--verify-native') {
      if (process.platform !== 'win32') throw Error('La evidencia nativa está limitada a Windows x64.');
      const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--offline', '--features', 'custom-protocol', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc', '--manifest-path', path.join(repo, 'shells/desktop-tauri/Cargo.toml')], {encoding:'utf8', maxBuffer:32*1024*1024}));
      verifyNative(repo, path.join(process.env.LOCALAPPDATA, 'tauri/NSIS'), metadata);
    } else {
      if (!process.argv[2]) throw Error('Falta el directorio de API.');
      copyNotices(repo, path.resolve(process.argv[2]));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { copyNotices, verifyNative };
