#!/usr/bin/env node
// Inventario local de preparación, no aprobación legal ni detector exhaustivo.
// No imprime contenido del código ni valores candidatos a secretos.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'artifacts/open-source-audit');
fs.mkdirSync(out, { recursive: true });
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const json = p => JSON.parse(read(p));
const git = args => cp.execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
const rel = p => path.relative(root, p).replaceAll('\\', '/');
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
const rows = [];
const missing = [];
const xml = (s, tag) => s.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() || '';
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function row(ecosystem, name, version, usage, complete, without, license, evidence, source, note = '') {
  rows.push({ ecosystem, component: name, version, usage, complete, without_informix: without,
    license: license || 'NO DETERMINADA', evidence, source,
    decision: 'PENDIENTE REVISION', note });
}
function walk(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, predicate) : predicate(p) ? [p] : [];
  });
}

function inventory() {
  for (const folder of ['frontend', 'e2e']) {
    const file = path.join(root, folder, 'package-lock.json');
    const lock = json(file);
    for (const [location, item] of Object.entries(lock.packages)) {
      if (!location || item.link) continue;
      const name = item.name || location.split('node_modules/').at(-1);
      let license = item.license;
      if (!license) {
        const manifest = path.join(root, folder, location, 'package.json');
        if (fs.existsSync(manifest)) license = json(manifest).license;
      }
      if (typeof license === 'object') license = license.type || JSON.stringify(license);
      row('npm', name, item.version || 'sin version', `${folder}:${item.dev ? 'desarrollo' : 'grafo produccion'}`,
        folder === 'frontend' && !item.dev ? 'posible codigo en bundle' : 'herramienta; no inferir inclusion',
        'igual frontend; no depende del proveedor', license, `${folder}/package-lock.json:${location}`,
        `https://www.npmjs.com/package/${name}/v/${item.version}`,
        'El lock incluye plataformas opcionales; no equivale al contenido distribuido.');
    }
  }

  const hostPath = path.join(root, 'backend/src/Druse.Host.LocalApi/obj/project.assets.json');
  const host = json(hostPath);
  const target = host.targets['net10.0/win-x64'] || host.targets[Object.keys(host.targets)[0]];
  const nameToKey = new Map(Object.keys(target).map(k => [k.slice(0, k.lastIndexOf('/')), k]));
  const roots = [...Object.keys(host.project.frameworks['net10.0'].dependencies),
    ...Object.keys(host.project.restore.frameworks['net10.0'].projectReferences).map(p => path.basename(p, '.csproj'))];
  function closure(exclude) {
    const visited = new Set();
    function visit(name) {
      if (exclude.has(name)) return;
      const key = nameToKey.get(name);
      if (!key || visited.has(key)) return;
      visited.add(key);
      Object.keys(target[key].dependencies || {}).forEach(visit);
    }
    roots.forEach(visit);
    return visited;
  }
  const complete = closure(new Set());
  const without = closure(new Set(['Druse.Provider.Informix', 'Druse.Jdbc']));
  const packages = new Map();
  const assets = walk(path.join(root, 'backend'), p => p.endsWith('/project.assets.json') || p.endsWith('\\project.assets.json'));
  for (const file of assets) {
    const a = json(file);
    for (const [key, lib] of Object.entries(a.libraries || {})) {
      if (lib.type !== 'package') continue;
      const record = packages.get(key) || { lib, uses: new Set(), folders: Object.keys(a.packageFolders || {}) };
      record.uses.add(rel(file).split('/obj/')[0]); packages.set(key, record);
    }
    for (const framework of Object.values(a.project.frameworks || {})) {
      for (const d of framework.downloadDependencies || []) {
        const version = d.version.match(/[0-9]+\.[0-9]+\.[0-9]+(?:[-+][^,\]]+)?/)?.[0];
        if (!version) continue;
        const key = `${d.name}/${version}`;
        if (!packages.has(key)) packages.set(key, { lib: { path: key.toLowerCase() }, uses: new Set(['runtime pack de restauracion']), folders: Object.keys(a.packageFolders || {}) });
      }
    }
  }
  for (const [key, record] of packages) {
    const cut = key.lastIndexOf('/'); const name = key.slice(0, cut); const version = key.slice(cut + 1);
    const folder = record.folders.map(f => path.join(f, record.lib.path)).find(p => fs.existsSync(p));
    const spec = folder && fs.readdirSync(folder).find(n => n.endsWith('.nuspec'));
    const specText = spec ? read(path.join(folder, spec)) : '';
    const licenseTag = specText.match(/<license\s+type="([^"]+)"[^>]*>([^<]+)<\/license>/);
    let license = ''; let evidence = `NuGet:${key}`;
    if (licenseTag) {
      license = licenseTag[1] === 'expression' ? licenseTag[2] : `Archivo: ${licenseTag[2]}`;
      evidence += `/${licenseTag[1] === 'file' ? licenseTag[2] : spec}`;
      if (licenseTag[1] === 'file') {
        const file = path.resolve(folder, licenseTag[2]);
        if (!file.startsWith(path.resolve(folder) + path.sep) || !fs.existsSync(file)) {
          missing.push({ ecosystem: 'NuGet', component: name, version, reason: 'archivo de licencia no disponible' });
        } else if (name === 'Oracle.ManagedDataAccess.Core') {
          license = 'Oracle Free Distribution, Hosting, and Use Terms and Conditions';
        } else if (/^Net\.IBM\.Data\.Db2/.test(name)) {
          license = 'IBM IPLA / License Information';
        } else if (name === 'Microsoft.Data.SqlClient.SNI.runtime') {
          license = 'Microsoft Software License Terms - SQLCLIENT SNI';
        } else {
          const terms = read(file);
          if (terms.trimStart().startsWith('MIT License')) license = 'MIT';
          else if (terms.includes('Classpath') && terms.includes('IKVM')) {
            license = 'IKVM: Zlib y GPL-2.0 con Classpath exception, segun archivo';
          }
        }
      }
    } else license = xml(specText, 'licenseUrl');
    row('NuGet', name, version, [...record.uses].sort().join(';'), complete.has(key) ? 'grafo host' : 'build/test/runtime pack',
      without.has(key) ? 'grafo host inferido' : complete.has(key) ? 'excluido del grafo inferido' : 'sin inferir',
      license, evidence, `https://www.nuget.org/packages/${name}/${version}`,
      'Inferencia desde assets restaurados: confirmar con publicacion limpia y archivos del paquete.');
  }

  const lockPath = path.join(root, 'shells/desktop-tauri/Cargo.lock');
  const registry = path.join(process.env.CARGO_HOME || path.join(os.homedir(), '.cargo'), 'registry/src');
  const registries = fs.existsSync(registry) ? fs.readdirSync(registry).map(p => path.join(registry, p)) : [];
  for (const block of read(lockPath).split('[[package]]').slice(1)) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1];
    const version = block.match(/^version = "([^"]+)"/m)?.[1];
    const source = block.match(/^source = "([^"]+)"/m)?.[1];
    if (!source || !name || !version) continue;
    const manifest = registries.map(p => path.join(p, `${name}-${version}`, 'Cargo.toml')).find(p => fs.existsSync(p));
    const text = manifest ? read(manifest).split(/\n\[(?!package\])/)[0] : '';
    const license = text.match(/^license = "([^"]+)"/m)?.[1] || text.match(/^license-file = "([^"]+)"/m)?.[1];
    row('Cargo', name, version, 'lock multiplataforma: runtime/build por resolver', 'posible; requiere cargo tree objetivo',
      'igual shell; no depende del proveedor', license,
      manifest ? `Cargo registry:${name}-${version}/Cargo.toml` : 'shells/desktop-tauri/Cargo.lock; metadatos locales ausentes',
      `https://crates.io/crates/${name}/${version}`);
  }

  const mavenDir = path.join(os.homedir(), '.m2/repository');
  const mavenSeen = new Set();
  function maven(group, artifact, version) {
    const id = `${group}:${artifact}:${version}`;
    if (mavenSeen.has(id)) return; mavenSeen.add(id);
    const relative = `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}.pom`;
    const pom = path.join(mavenDir, relative); const text = fs.existsSync(pom) ? read(pom) : '';
    const licenses = xml(text, 'licenses');
    row('Maven', `${group}:${artifact}`, version, 'JDBC Informix via IKVM', 'si, puente compilado', 'no, inferido',
      [...licenses.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1]).join(' OR '), `Maven:${relative}`,
      `https://repo.maven.apache.org/maven2/${relative}`,
      text ? 'POM local; revisar herencia, perfiles y obligaciones del JAR.' : 'POM local ausente.');
    for (const d of xml(text, 'dependencies').matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
      const g = xml(d[1], 'groupId'), a = xml(d[1], 'artifactId'), v = xml(d[1], 'version');
      // Una dependencia opcional de una dependencia no se hereda en Maven.
      if (g && a && v && !v.includes('$') && !['test', 'provided'].includes(xml(d[1], 'scope')) && xml(d[1], 'optional') !== 'true') maven(g, a, v);
    }
  }
  const jdbcProject = read(path.join(root, 'backend/src/Druse.Jdbc/Druse.Jdbc.csproj'));
  for (const m of jdbcProject.matchAll(/<MavenReference\s+Include="([^:"]+):([^"]+)"\s+Version="([^"]+)"/g)) maven(m[1], m[2], m[3]);
  for (const [component, licenseFile] of [['Inter', 'inter-LICENSE.txt'], ['JetBrains Mono', 'jetbrains-mono-LICENSE.txt']]) {
    row('asset', component, 'archivo local', 'landing', 'no; solo web', 'no; solo web', 'SIL OFL 1.1',
      `landing/assets/${licenseFile}`, 'archivo versionado', 'Confirmar correspondencia entre fuente binaria y aviso.');
  }
  row('asset', 'Marca e iconos Druse', 'archivo local', 'landing y shell', 'si', 'si', '',
    'landing/assets/druse.png; shells/desktop-tauri/icons', 'repositorio', 'Pendiente procedencia y derechos del titular.');
  row('runtime', 'WebView2', 'Evergreen: variable', 'runtime Windows externo', 'verificar bootstrapper y terminos', 'igual', '',
    'shells/desktop-tauri/tauri.conf.json', 'https://developer.microsoft.com/en-us/microsoft-edge/webview2/',
    'No clasificar como OSI sin revisar excepcion de biblioteca de sistema con SignPath.');

  rows.sort((a, b) => `${a.ecosystem}/${a.component}/${a.version}/${a.usage}`.localeCompare(`${b.ecosystem}/${b.component}/${b.version}/${b.usage}`));
  const columns = Object.keys(rows[0]);
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  fs.writeFileSync(path.join(root, 'docs/licencias-dependencias.csv'), '\uFEFF' + [columns, ...rows.map(r => columns.map(c => r[c]))].map(r => r.map(quote).join(',')).join('\n') + '\n');
  for (const r of rows) if (r.license === 'NO DETERMINADA') missing.push({ ecosystem: r.ecosystem, component: r.component, version: r.version, reason: 'metadatos de licencia ausentes' });
  const apiDir = path.join(root, 'shells/desktop-tauri/api');
  const files = walk(apiDir, () => true).map(p => ({ path: rel(p), bytes: fs.statSync(p).size, sha256: sha(p) }));
  save('package-files.json', files);
  const summary = { generatedAt: new Date().toISOString(), head: git(['rev-parse', 'HEAD']).toString().trim(), rows: rows.length,
    ecosystems: Object.fromEntries([...new Set(rows.map(r => r.ecosystem))].map(e => [e, rows.filter(r => r.ecosystem === e).length])),
    missing, packageFiles: files.length, packageBytes: files.reduce((n, f) => n + f.bytes, 0), assetsFiles: assets.length,
    limitations: ['Sin aprobacion legal', 'Grafo sin Informix inferido, no nueva compilacion', 'Licencias de runtime y archivos terceros pendientes', 'Metadatos de obj pueden estar desactualizados: no se ejecuto restore'] };
  save('inventory-summary.json', summary);
  console.log(JSON.stringify({ inventoryRows: rows.length, missing: missing.length, packageFiles: files.length, ecosystems: summary.ecosystems }));
}

function history() {
  const objects = git(['rev-list', '--objects', '--all']).toString('utf8').trim().split('\n').map(line => {
    const split = line.indexOf(' '); return { oid: line.slice(0, split < 0 ? undefined : split), path: split < 0 ? '' : line.slice(split + 1) };
  });
  const input = objects.map(o => o.oid).join('\n') + '\n';
  const stats = cp.execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { cwd: root, input, maxBuffer: 64 * 1024 * 1024 }).toString().trim().split('\n');
  const sizes = new Map(stats.map(line => { const [oid, type, size] = line.split(' '); return [oid, { type, size: Number(size) }]; }));
  const blobs = objects.filter(o => sizes.get(o.oid)?.type === 'blob');
  const eligible = blobs.filter(o => sizes.get(o.oid).size <= 5 * 1024 * 1024);
  const batch = cp.execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: eligible.map(o => o.oid).join('\n') + '\n', maxBuffer: 256 * 1024 * 1024 });
  const findings = [], binaries = []; let offset = 0, texts = 0;
  const detectors = [
    ['private-key-header', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
    ['private-ip', /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
    ['credential-literal-review', /(?:password|pwd|api[_-]?key|secret)\s*[=:]\s*["'][^"'\r\n]{4,}["']/i],
    ['email-review', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ];
  for (const obj of eligible) {
    const end = batch.indexOf(10, offset); const header = batch.subarray(offset, end).toString().split(' ');
    if (header[0] !== obj.oid || header[1] !== 'blob') throw new Error('Objeto git inesperado');
    const size = Number(header[2]); const body = batch.subarray(end + 1, end + 1 + size); offset = end + 2 + size;
    if (body.includes(0)) { binaries.push({ ...obj, bytes: size }); continue; }
    texts++;
    body.toString('utf8').split(/\r?\n/).forEach((line, i) => {
      for (const [rule, expression] of detectors) if (expression.test(line)) findings.push({ rule, ...obj, line: i + 1 });
    });
  }
  const paths = git(['log', '--all', '--format=', '--name-only']).toString().split('\n').filter(Boolean);
  const sensitiveFiles = [...new Set(paths)].filter(p => /(?:\.(?:pfx|p12|pem|key|db|sqlite3?|bak|dump|sql|csv|xlsx?|zip|7z)$|(?:^|\/)\.env(?:\.|$)|secrets\.json$)/i.test(p));
  save('history-supplement.json', { head: git(['rev-parse', 'HEAD']).toString().trim(), commits: Number(git(['rev-list', '--all', '--count'])),
    refs: git(['for-each-ref', '--format=%(refname)']).toString().trim().split('\n'), blobs: blobs.length, textBlobs: texts,
    skippedLarge: blobs.filter(o => sizes.get(o.oid).size > 5 * 1024 * 1024), binaries, sensitiveFiles, findings,
    limitations: ['Solo referencias Git locales tras fetch; sin refs de PR ni objetos eliminados remotos', 'Patrones complementarios: requieren revision contextual', 'Sin OCR, contenido binario ni verificacion de credenciales contra servicios'] });
  // Snapshot aislado para Gitleaks dir; nunca copia archivos ignorados.
  const snapshot = path.join(out, `snapshot-${Date.now()}`); fs.mkdirSync(snapshot);
  const workFiles = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean);
  let copied = 0;
  for (const p of new Set(workFiles)) {
    const source = path.resolve(root, p), dest = path.resolve(snapshot, p);
    if (!source.startsWith(root + path.sep) || !dest.startsWith(snapshot + path.sep)) throw new Error('Ruta fuera del alcance');
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(source, dest); copied++;
  }
  save('snapshot.json', { path: rel(snapshot), files: copied });
  console.log(JSON.stringify({ commits: Number(git(['rev-list', '--all', '--count'])), blobs: blobs.length, textBlobs: texts, candidates: findings.length,
    binaries: binaries.length, sensitiveFiles: sensitiveFiles.length, snapshot: rel(snapshot), snapshotFiles: copied }));
}
const mode = process.argv[2];
if (!mode || mode === '--inventory') inventory();
if (!mode || mode === '--history') history();
if (mode && !['--inventory', '--history'].includes(mode)) throw new Error('Uso: node build/scripts/audit-open-source.cjs [--inventory|--history]');
