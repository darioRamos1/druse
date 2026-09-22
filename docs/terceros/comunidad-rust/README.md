# Avisos de Rust en Druse Comunidad

Este directorio conserva 165 textos originales vinculados a 238 crates del grafo normal Windows x64, con la feature `custom-protocol`. `indice.json` identifica versiones, licencias declaradas, avisos y fuentes; los nombres de `fuentes/` son hashes SHA-256, no nombres de licencia.

## Obtener el código de terceros

Cada entrada contiene una URL `fuente` al archivo `.crate` de esa versión en el registro de Rust, y `crateSha256`, contrastado con `Cargo.lock`. El archivo es un tar comprimido con gzip que contiene el código, avisos y metadatos originales. Se puede descargar, comprobar su SHA-256 y extraer con `tar -xzf archivo.crate`. Las fuentes mantienen sus licencias originales; este índice no las sustituye ni restringe sus derechos. El código y las instrucciones de construcción de Druse están en https://github.com/darioRamos1/druse.

## Procedencia y alcance

Se recopilaron 435 referencias a documentos: 416 coinciden byte a byte con entradas de archivos `.crate` cuyo SHA-256 corresponde a `Cargo.lock`; 19 proceden de repositorios upstream en el commit registrado en `.cargo_vcs_info.json`, o del texto oficial MPL enlazado por selectors. Los documentos idénticos se almacenan una sola vez. Se buscaron avisos por nombre también en subdirectorios y en `license_file`; no se tradujeron ni normalizaron finales de línea.

El empaquetado comprueba los hashes de Cargo.lock/Cargo.toml y de cada documento. Un cambio exige revisar y renovar el expediente, no copiar automáticamente avisos de otra versión. Las URL externas se registraron al recopilar; el empaquetado no necesita descargarlas.

El recorrido separa 24 proc-macros y dependencias build/dev. No demuestra qué bytes sobreviven a la optimización, ni cierra obligaciones de código generado, avisos dentro de código fuente, compatibilidad o entrega de fuente correspondiente del conjunto GPL. Debe prepararse el archivo de fuentes de la release antes de cerrar OSS-04. Las bibliotecas nativas y NSIS tienen un expediente separado. La admisión de SignPath sigue pendiente.
