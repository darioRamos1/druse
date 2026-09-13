#!/usr/bin/env node
/**
 * Claves y firmas Minisign de usar y tirar, para las pruebas.
 *
 * La clave del actualizador no vive en el repositorio ni debe, así que las
 * pruebas que necesitan una firma válida se hacen la suya: lo que comprueban es
 * la lógica de verificación, y esa es la misma con cualquier clave.
 *
 * Como módulo:  const { nuevaClave, firmar } = require('./firma-de-prueba.cjs')
 * Como guion:   node build/tests/firma-de-prueba.cjs <carpeta> <archivo...>
 *
 * En modo guion genera una clave, firma cada archivo dejando su `.sig` al lado y
 * escribe la clave pública en `clave-publica.txt` dentro de la carpeta, que es
 * lo que necesita la prueba de verificación de releases.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** Una clave Ed25519 nueva, con la pública en el formato de `tauri.conf.json`. */
function nuevaClave() {
  const par = crypto.generateKeyPairSync('ed25519');
  const id = crypto.randomBytes(8);
  const publica = par.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const documento = [
    'untrusted comment: minisign public key',
    Buffer.concat([Buffer.from('Ed'), id, publica]).toString('base64'),
    '',
  ].join('\n');

  return {
    id,
    privada: par.privateKey,
    configurada: Buffer.from(documento, 'utf8').toString('base64'),
  };
}

/**
 * Firma un contenido como lo hace el firmante de Tauri: sobre el Blake2b-512 del
 * archivo, no sobre el archivo.
 *
 * `id` permite firmar poniendo el identificador de otra clave, que es como se
 * prueba que el identificador por sí solo no demuestra nada.
 */
function firmar(clave, contenido, { id = clave.id } = {}) {
  const resumen = crypto.createHash('blake2b512').update(contenido).digest();
  const firma = crypto.sign(null, resumen, clave.privada);
  const documento = [
    'untrusted comment: signature from tauri secret key',
    Buffer.concat([Buffer.from('ED'), id, firma]).toString('base64'),
    'trusted comment: prueba',
    crypto.randomBytes(64).toString('base64'),
    '',
  ].join('\n');

  return Buffer.from(documento, 'utf8').toString('base64');
}

if (require.main === module) {
  const [carpeta, ...archivos] = process.argv.slice(2);

  if (!carpeta || archivos.length === 0) {
    console.error('Uso: firma-de-prueba.cjs <carpeta> <archivo...>');
    process.exit(2);
  }

  const clave = nuevaClave();

  for (const archivo of archivos) {
    const ruta = path.isAbsolute(archivo) ? archivo : path.join(carpeta, archivo);
    fs.writeFileSync(`${ruta}.sig`, firmar(clave, fs.readFileSync(ruta)));
  }

  fs.writeFileSync(path.join(carpeta, 'clave-publica.txt'), clave.configurada);
  console.log(clave.configurada);
}

module.exports = { nuevaClave, firmar };
