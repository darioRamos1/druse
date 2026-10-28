# Publicación de instaladores y portables

Desde la versión 1.11.0, los cambios de la aplicación incorporados a `main`
ejecutan CI general y la comprobación de Comunidad. Cuando ambos workflows
terminan satisfactoriamente para el mismo commit, **Publicar versión** construye
y publica una versión nueva. La versión se sube con `subir-version.ps1` y debe
tener su entrada de novedades, como indica `AGENTS.md`.

Esta es la regla permanente del proyecto: cuando el mantenedor autoriza subir
o publicar un ajuste, se actualizan también los instaladores, los portables y
la landing, sin pedir esas tres cosas otra vez. Publicar incluye comprobar el
resultado de la release y de Pages, además de subir el código. Las revisiones
obligatorias del repositorio siguen siendo necesarias.

No se sobrescriben versiones existentes. Un cambio posterior necesita otra
versión; las descargas de las versiones anteriores siguen disponibles. Los
cambios solo de documentación o de la landing no necesitan otra versión de la
aplicación.

## Qué se publica

- Instaladores y ZIP sin instalación de Completa, Sin Informix y Comunidad,
  todos para Windows x64 y todos de la misma versión.
- Firmas del actualizador de los instaladores y `latest.json`.
- Inventarios por edición, evidencia del commit y de las comprobaciones,
  `SHA256SUMS.txt` y el instalador selector.

Cada portable se contrasta con el inventario de su propia edición, incluyendo
los bytes de su ejecutable y de la API. Requiere WebView2 instalado, y conserva
los datos en el perfil de Windows. No incluye un perfil transportable.

La clave `TAURI_SIGNING_PRIVATE_KEY` debe estar configurada en GitHub. Su firma
protege el canal de actualización de Tauri; los paquetes todavía no tienen
firma Authenticode.

## Publicación y recuperación

La subida crea primero un borrador. Solo se publica cuando GitHub confirma
todos los archivos, sus tamaños y sus hashes cuando los proporciona la API.
Un fallo conserva el borrador y las descargas públicas anteriores.

Si queda un borrador pendiente, el siguiente intento se detiene con una
explicación. El mantenedor debe revisar el borrador en GitHub: no se sustituyen
ni eliminan sus archivos automáticamente. Para reconstruirlo desde cero,
primero debe resolver ese borrador y después volver a ejecutar la publicación.

El workflow también se puede iniciar manualmente desde Actions. Ese recorrido
exige igualmente CI y Comunidad satisfactorios para el commit seleccionado.
No usa la excepción local `-SinComprobarCI`.

## Actualización de la landing

Al terminar **Publicar versión**, Pages vuelve a generar los enlaces estáticos
desde GitHub Releases. También escucha las publicaciones manuales y permite
ejecución manual. Así funciona aunque GitHub no emita otro evento `release`
cuando la publicación la creó su propio `GITHUB_TOKEN`.

El generador elige la versión más reciente con los seis paquetes y sus hashes.
Si hay un fallo o una publicación incompleta, conserva la web anterior. La
[guía de la landing](../guias/landing-github-pages.md) explica cómo previsualizar
las descargas y probar el catálogo sin red.
