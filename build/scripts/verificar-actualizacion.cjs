#!/usr/bin/env node
/**
 * Comprueba que un artefacto corresponde a la firma con la que se va a publicar.
 *
 * Existe por un error que no avisa: **la firma Authenticode modifica el archivo**.
 * Si la `.sig` del actualizador se genera antes de firmar el instalador —o si el
 * instalador se vuelve a tocar después—, la release sale con una firma que no
 * corresponde a esos bytes. Nadie se entera al publicar: se enteran los usuarios,
 * cuando la actualización se rechaza en su equipo y la aplicación deja de poder
 * actualizarse.
 *
 * Aquí se comprueba lo que se va a repartir, con la clave pública que lleva
 * dentro la aplicación, que es exactamente lo que hará el actualizador.
 *
 * Formato Minisign, tal como lo escribe el firmante de Tauri: dos bytes de
 * algoritmo, ocho de identificador de clave y sesenta y cuatro de firma Ed25519.
 * `Ed` firma el archivo entero; `ED` firma su Blake2b-512, que es lo que usa
 * Tauri. [Formato](https://jedisct1.github.io/minisign/).
 *
 * Uso:
 *   node build/scripts/verificar-actualizacion.cjs <archivo> [<archivo.sig>]
 *   node build/scripts/verificar-actualizacion.cjs <archivo> <sig> --pubkey <base64>
 *
 * Salida: 0 si la firma corresponde, 1 si no corresponde, 2 si no se pudo
 * comprobar. **Un error de ejecución no es una firma válida**, y por eso son
 * códigos distintos.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** Cabecera DER de una clave pública Ed25519, para poder dársela a Node. */
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

/** Separa un documento Minisign en sus líneas útiles, ya sin comentarios. */
function cuerpoDe(texto) {
  return texto
    .split(/\r?\n/)
    .filter((linea) => linea && !/^(untrusted|trusted) comment:/.test(linea));
}

/**
 * Lee la clave pública configurada.
 *
 * Admite el valor tal cual está en `tauri.conf.json` —que es el documento
 * Minisign entero en base64— y también el documento ya legible.
 */
function leerClave(valor) {
  const texto = valor.includes('comment:') ? valor : Buffer.from(valor.trim(), 'base64').toString('utf8');
  const cuerpo = cuerpoDe(texto)[0];

  if (!cuerpo) {
    throw new Error('La clave pública no tiene cuerpo Minisign.');
  }

  const bytes = Buffer.from(cuerpo, 'base64');

  if (bytes.length !== 42) {
    throw new Error(`La clave pública debería ocupar 42 bytes y ocupa ${bytes.length}.`);
  }

  return {
    algoritmo: bytes.subarray(0, 2).toString('utf8'),
    id: bytes.subarray(2, 10).toString('hex'),
    clave: bytes.subarray(10),
  };
}

/** Lee un archivo `.sig`, que Tauri guarda en base64. */
function leerFirma(valor) {
  const texto = valor.includes('comment:') ? valor : Buffer.from(valor.trim(), 'base64').toString('utf8');
  const cuerpo = cuerpoDe(texto)[0];

  if (!cuerpo) {
    throw new Error('La firma no tiene cuerpo Minisign.');
  }

  const bytes = Buffer.from(cuerpo, 'base64');

  if (bytes.length !== 74) {
    throw new Error(`La firma debería ocupar 74 bytes y ocupa ${bytes.length}.`);
  }

  return {
    algoritmo: bytes.subarray(0, 2).toString('utf8'),
    id: bytes.subarray(2, 10).toString('hex'),
    firma: bytes.subarray(10),
  };
}

/**
 * Comprueba la firma de un archivo.
 *
 * Devuelve el motivo del rechazo en lugar de un booleano suelto: al publicar
 * importa distinguir «esta firma es de otra clave» de «estos bytes no son los
 * que se firmaron», porque no se arreglan igual.
 */
function verificar(rutaArchivo, rutaFirma, clavePublica) {
  const clave = leerClave(clavePublica);
  const firma = leerFirma(fs.readFileSync(rutaFirma, 'utf8'));

  if (firma.id !== clave.id) {
    return {
      valida: false,
      motivo: `La firma pertenece a la clave ${firma.id} y la aplicación confía en ${clave.id}.`,
    };
  }

  const archivo = fs.readFileSync(rutaArchivo);

  // `ED` firma el resumen Blake2b-512 del archivo, no el archivo. Confundirlos
  // da «firma inválida» sobre un artefacto que está perfectamente bien.
  const mensaje =
    firma.algoritmo === 'ED'
      ? crypto.createHash('blake2b512').update(archivo).digest()
      : archivo;

  if (firma.algoritmo !== 'ED' && firma.algoritmo !== 'Ed') {
    return { valida: false, motivo: `Algoritmo de firma desconocido: ${firma.algoritmo}.` };
  }

  const publica = crypto.createPublicKey({
    key: Buffer.concat([SPKI_ED25519, clave.clave]),
    format: 'der',
    type: 'spki',
  });

  const valida = crypto.verify(null, mensaje, publica, firma.firma);

  return {
    valida,
    motivo: valida ? null : 'Los bytes del archivo no son los que se firmaron.',
  };
}

function clavePorDefecto() {
  const config = path.join(__dirname, '../../shells/desktop-tauri/tauri.conf.json');
  const documento = JSON.parse(fs.readFileSync(config, 'utf8'));
  const clave = documento?.plugins?.updater?.pubkey;

  if (!clave) {
    throw new Error(`No hay clave pública del actualizador en ${config}.`);
  }

  return clave;
}

function principal(argumentos) {
  const posicionales = [];
  let clave = null;

  for (let i = 0; i < argumentos.length; i += 1) {
    if (argumentos[i] === '--pubkey') {
      clave = argumentos[i + 1];
      i += 1;
    } else {
      posicionales.push(argumentos[i]);
    }
  }

  const archivo = posicionales[0];
  const firma = posicionales[1] ?? `${archivo}.sig`;

  if (!archivo) {
    console.error('Uso: verificar-actualizacion.cjs <archivo> [<archivo.sig>] [--pubkey <base64>]');
    return 2;
  }

  for (const ruta of [archivo, firma]) {
    if (!fs.existsSync(ruta)) {
      console.error(`No existe: ${ruta}`);
      return 2;
    }
  }

  const resultado = verificar(archivo, firma, clave ?? clavePorDefecto());

  if (resultado.valida) {
    console.log(`OK  ${path.basename(archivo)}: la firma corresponde a estos bytes.`);
    return 0;
  }

  console.error(`RECHAZADO  ${path.basename(archivo)}: ${resultado.motivo}`);
  return 1;
}

if (require.main === module) {
  try {
    process.exit(principal(process.argv.slice(2)));
  } catch (error) {
    console.error(`No se pudo comprobar la firma: ${error.message}`);
    process.exit(2);
  }
}

module.exports = { verificar, leerClave, leerFirma };
