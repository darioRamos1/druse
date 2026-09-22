const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { copyNotices, verifyNative } = require('../scripts/avisos-rust-comunidad.cjs');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'druse-notices-'));
  t.after(() => { if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !path.basename(root).startsWith('druse-notices-')) throw Error('Limpieza fuera de alcance'); fs.rmSync(root, {recursive:true,force:true}); });
  function write(relative, data) { const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data); }
  const bytes=Buffer.from([65,13,10,169,66,10]), digest=sha(bytes);
  const doc={archivo:`fuentes/${digest}.txt`,sha256:digest};
  const rust={esquema:1,target:'x86_64-pc-windows-msvc',features:['custom-protocol'],cargoLockSha256:sha('lock'),cargoTomlSha256:sha('toml'),paquetes:[{componente:'test',version:'1',documentos:[doc]},{componente:'shared',version:'1',documentos:[doc]}]};
  const native={esquema:1,nsisArchivos:[{ruta:'COPYING',sha256:sha('nsis')}],paquetes:[{componente:'Microsoft.Web.WebView2 SDK',version:'1',loaderSha256:sha('loader'),documentos:[doc]}]};
  for(const [name,index] of [['comunidad-rust',rust],['comunidad-nativos',native]]) {
    write(`docs/terceros/${name}/indice.json`,JSON.stringify(index));write(`docs/terceros/${name}/${doc.archivo}`,bytes);write(`docs/terceros/${name}/README.md`,'sources');
  }
  write('shells/desktop-tauri/Cargo.lock','lock');write('shells/desktop-tauri/Cargo.toml','toml');write('nsis/COPYING','nsis');write('crate/x64/WebView2LoaderStatic.lib','loader');
  const metadata={packages:[{name:'webview2-com-sys',manifest_path:path.join(root,'crate/Cargo.toml')}]};
  return {root,api:path.join(root,'api'),bytes,doc,rust,native,metadata,write};
}
test('conserva bytes, deduplica y rechaza salida anterior',t=>{const f=fixture(t);copyNotices(f.root,f.api);assert.deepEqual(fs.readFileSync(path.join(f.api,'licenses/comunidad-rust',f.doc.archivo)),f.bytes);assert.equal(fs.readdirSync(path.join(f.api,'licenses/comunidad-rust/fuentes')).length,1);assert.throws(()=>copyNotices(f.root,f.api),/ya existe/);});
test('rechaza cambios de manifiesto y lockfile',t=>{const f=fixture(t);for(const file of ['Cargo.lock','Cargo.toml']){const location=`shells/desktop-tauri/${file}`,old=fs.readFileSync(path.join(f.root,location));f.write(location,'new');assert.throws(()=>copyNotices(f.root,f.api),/Cambió el grafo/);f.write(location,old);}});
test('rechaza aviso alterado antes de copiar',t=>{const f=fixture(t);f.write('docs/terceros/comunidad-nativos/'+f.doc.archivo,'corrupt');assert.throws(()=>copyNotices(f.root,f.api),/alterado/);assert.equal(fs.existsSync(f.api),false);});
test('rechaza rutas externas, duplicados y componentes sin textos',t=>{const f=fixture(t);const file='docs/terceros/comunidad-rust/indice.json';const original=JSON.stringify(f.rust);for(const mutate of [r=>r.paquetes[0].documentos[0].archivo='../escape',r=>r.paquetes.push(r.paquetes[0]),r=>r.paquetes[0].documentos=[]]){const r=JSON.parse(original);mutate(r);f.write(file,JSON.stringify(r));assert.throws(()=>copyNotices(f.root,f.api),/inválido|duplicado|sin avisos/);}});
test('rechaza cambios de NSIS y SDK nativo',t=>{const f=fixture(t),verify=()=>verifyNative(f.root,path.join(f.root,'nsis'),f.metadata);verify();f.write('nsis/COPYING','changed');assert.throws(verify,/NSIS cambió/);f.write('nsis/COPYING','nsis');f.write('crate/x64/WebView2LoaderStatic.lib','changed');assert.throws(verify,/Cambió el SDK/);});
