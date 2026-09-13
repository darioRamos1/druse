#!/usr/bin/env node
/**
 * La prueba negativa que exige el plan de firma: **un artefacto alterado tiene
 * que ser rechazado**.
 *
 * Se firma aquí mismo con una clave Ed25519 de usar y tirar, generada en cada
 * ejecución. No hace falta la clave del actualizador —que no vive en el
 * repositorio ni debe— y no queda ningún secreto escrito: lo que se comprueba es
 * la lógica de verificación, y esa es la misma con cualquier clave.
 *
 * Ejecuta:  node build/tests/verificacion-de-actualizacion.cjs
 */
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { verificar } = require('../scripts/verificar-actualizacion.cjs');
const { nuevaClave, firmar } = require('./firma-de-prueba.cjs');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'druse-firma-'));

function escribir(nombre, contenido) {
  const ruta = path.join(carpeta, nombre);
  fs.writeFileSync(ruta, contenido);
  return ruta;
}

try {
  const clave = nuevaClave();
  const instalador = Buffer.from('MZ esto hace de instalador'.repeat(64));
  const archivo = escribir('druse-setup.exe', instalador);
  const firmaValida = firmar(clave, instalador);
  const firma = escribir('druse-setup.exe.sig', firmaValida);

  // 1. Lo que se firmó, tal cual.
  assert.deepStrictEqual(verificar(archivo, firma, clave.configurada), {
    valida: true,
    motivo: null,
  });

  // 2. Un byte distinto: es el caso de la firma calculada antes de firmar con
  //    Authenticode, que es lo que este guion existe para no repetir.
  const alterado = Buffer.from(instalador);
  alterado[10] ^= 0x01;
  const copiaAlterada = escribir('alterado.exe', alterado);

  const rechazo = verificar(copiaAlterada, firma, clave.configurada);
  assert.strictEqual(rechazo.valida, false, 'Un artefacto alterado no puede darse por válido.');
  assert.match(rechazo.motivo, /no son los que se firmaron/);

  // 3. Añadir bytes al final tampoco cuela: un instalador con algo pegado detrás
  //    sigue ejecutándose, así que este es el caso que más importa cazar.
  const conCola = escribir('con-cola.exe', Buffer.concat([instalador, Buffer.from('extra')]));
  assert.strictEqual(verificar(conCola, firma, clave.configurada).valida, false);

  // 4. Firma de otra clave sobre el archivo bueno: se rechaza por identificador,
  //    y se dice, porque no se arregla igual que unos bytes cambiados.
  const otra = nuevaClave();
  const firmaAjena = escribir('ajena.sig', firmar(otra, instalador));
  const rechazoAjeno = verificar(archivo, firmaAjena, clave.configurada);

  assert.strictEqual(rechazoAjeno.valida, false);
  assert.match(rechazoAjeno.motivo, /pertenece a la clave/);

  // 5. Una firma con el identificador correcto pero hecha con otra clave: el
  //    identificador no demuestra nada por sí solo, y el rechazo debe venir de
  //    la comprobación criptográfica.
  const suplantada = escribir('suplantada.sig', firmar(otra, instalador, { id: clave.id }));
  const rechazoSuplantado = verificar(archivo, suplantada, clave.configurada);

  assert.strictEqual(rechazoSuplantado.valida, false);
  assert.match(rechazoSuplantado.motivo, /no son los que se firmaron/);

  // 6. Un documento roto no puede confundirse con una firma válida.
  const rota = escribir('rota.sig', Buffer.from('untrusted comment: nada\nQUJD\n').toString('base64'));
  assert.throws(() => verificar(archivo, rota, clave.configurada), /74 bytes/);

  console.log(
    'OK: firma correcta aceptada; alterado, con cola, de otra clave, suplantado y roto, rechazados.',
  );
} finally {
  fs.rmSync(carpeta, { recursive: true, force: true });
}
