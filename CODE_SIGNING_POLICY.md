# Política de firma de código — borrador

Revisión: 14 de septiembre de 2026. Corresponde a **PUB-03** del [plan de SignPath y donaciones](docs/planes/plan-signpath-donaciones.md).

## Estado actual: sin firma

**Los instaladores de Druse no están firmados con Authenticode.** Windows puede mostrar un aviso de SmartScreen; actualmente el instalador no acredita su editor mediante esa firma.

No hay certificado propio ni servicio de firma concedido. **La solicitud a SignPath Foundation está pendiente de presentarse**, y hasta que exista una respuesta no se usa su nombre, su logotipo ni la atribución que su programa exige: hacerlo antes sería anunciar un patrocinio que no se ha concedido.

Lo que sí está firmado hoy son las **actualizaciones**: cada instalador publicado lleva su archivo `.sig` de minisign generado con la clave del actualizador de Tauri, y la aplicación rechaza cualquier actualización cuya firma no valide contra la clave pública incluida en el programa. Eso protege el canal de actualización; **no sustituye a Authenticode** ni quita el aviso de SmartScreen.

## Qué se firmaría

Cuando exista un servicio de firma:

- El instalador NSIS de cada variante y el instalador selector que publica la release.
- Los binarios propios que viajan dentro: `Druse.Host.LocalApi.exe` y las bibliotecas `Druse.*`. Un instalador firmado que suelta ejecutables sin firmar es justo lo que hace saltar a los antivirus corporativos.

**No** se firmarían los componentes de terceros. El runtime de .NET de una publicación autocontenida ya viene firmado por Microsoft, y volver a firmar un archivo ajeno afirmaría sobre su origen algo que Druse no puede afirmar. Una regla global que firme todo lo que hay en el directorio queda descartada por escrito.

## Cómo se construye lo que se publica

1. El árbol de Git debe estar limpio: `release.ps1` se niega a publicar si hay cambios sin confirmar, para que los binarios correspondan a un commit exacto.
2. `package.ps1` publica la API .NET autocontenida, comprueba el contenido del paquete contra `build/paquete-excluidos.json` y **detiene la construcción si aparece un componente excluido** de esa variante.
3. Se genera un **manifiesto** con el SHA-256 de cada archivo del paquete y de los artefactos finales, en `artifacts/paquete/`.
4. Tauri construye el instalador y, si hay clave del actualizador, su `.sig`.
5. `release.ps1` calcula el SHA-256 de ambos instaladores, los incrusta en el instalador selector y publica la release con sus artefactos y `latest.json`.

Antes de publicar, una etapa de verificación comprueba sobre los bytes finales que cada firma de actualización pertenece a la clave que lleva dentro la aplicación **y corresponde a ese archivo**, que `latest.json` coincide con los archivos y que ninguna firma Authenticode es inválida. Los manifiestos de ambas variantes son obligatorios y deben coincidir en producto, versión, variante y hashes. Por defecto, publicar exige la ejecución más reciente de `ci.yml` satisfactoria para ese commit exacto. Existe una excepción explícita `-SinComprobarCI`, registrada en `evidencia.json` junto al commit, hashes y comprobaciones; usarla no acredita una construcción verificada por SignPath.

El orden importa y está anotado: **la firma Authenticode modifica el archivo**, así que cualquier hash o `.sig` calculado antes de firmar deja de corresponder a los bytes que se reparten. Firmar va antes de calcular, siempre. Hay pruebas que alteran un artefacto firmado y exigen que se rechace, porque esa es la clase de error que no avisa hasta que la actualización falla en el equipo de otra persona.

## Quién aprueba una release

Darío Ramos, mantenedor de Druse, es quien decide qué versión se publica y quien aprueba manualmente cada firma. La cuenta de GitHub del proyecto tiene autenticación en dos pasos.

No hay firma automática desencadenada por una rama: una release sale porque alguien la aprobó, no porque un commit llegó a `main`.

## Cómo comprobar lo que descargaste

- Compara el SHA-256 del instalador con el publicado en las notas de esa versión.
- Cuando haya Authenticode, revisa las propiedades del archivo en Windows: firmante, validez y **sellado de tiempo**. Una firma sin sello deja de validar cuando el certificado caduca, incluso en copias que ya tenías.
- Descarga solo desde las releases del repositorio oficial. Un instalador de Druse alojado en otro sitio no es un instalador de Druse comprobado.

## Si algo va mal

Escribe a **druse.contacto@gmail.com** con el asunto «Firma» si encuentras un instalador de Druse firmado que no corresponda a una release publicada, un archivo cuyo hash no coincida, o cualquier señal de que una clave está en manos ajenas.

Qué pasaría entonces: se retira el artefacto de la release, se publica un aviso en las notas de la versión y en el README diciendo qué archivo estaba afectado y cómo reconocerlo, se solicita la revocación del certificado al proveedor de firma y se rota la clave del actualizador en la siguiente versión, que deja de admitir la anterior. Las claves privadas no se guardan en el repositorio: la del actualizador vive fuera del árbol y `.gitignore` excluye explícitamente `druse-updater*.key` y los archivos `.p12`.

## Summary in English

Druse installers are **not yet signed with Authenticode**. The application update files are signed with the Tauri updater key (minisign) and verified before an update is applied, which protects the update channel but is not code signing.

An application to the SignPath Foundation is **prepared but not yet submitted**; no signing service has been granted, so no SignPath attribution appears here or in the product. Releases are built from a clean Git tree, their package contents are checked against an explicit exclusion list, and a SHA-256 manifest is produced for every build. Before publishing, every signature is verified against the final bytes and the release is refused if anything does not match; publishing also requires a green CI run for that exact commit, and each release records its commit, hashes and check results. Each release is approved manually by the maintainer, whose GitHub account uses two-factor authentication. Only Druse's own binaries and installers would be submitted for signing; third-party components would not.

Report anything suspicious to `druse.contacto@gmail.com`.

CI enforcement clarification: the required run is the latest execution of `ci.yml` for the exact commit. An explicit `-SinComprobarCI` exception still exists and is recorded in local release evidence; it must not be represented as verified CI or SignPath build provenance. Both package manifests are mandatory and checked against the expected product, version, variant and hashes.
