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

## Comprobación del paquete Linux

CI construye también DEB y AppImage. La API autocontenida de ambos formatos
omite únicamente `libcoreclrtraceptprovider.so`: es el proveedor opcional de
PerfCollect/LTTng, enlazado con una ABI antigua que Ubuntu 24.04 no proporciona.
La [carga de .NET 10.0.13](https://github.com/dotnet/runtime/blob/v10.0.13/src/coreclr/pal/src/misc/tracepointprovider.cpp#L109-L113)
tolera expresamente su ausencia. El CLR, los proveedores de bases de datos y
EventPipe, usado por `dotnet-trace`, se conservan.

El [linuxdeploy usado por Tauri](https://github.com/linuxdeploy/linuxdeploy/blob/659c9db/src/core/appdir.cpp#L744-L760)
inspecciona todos los ELF existentes antes de aplicar exclusiones de copia;
dejar ese proveedor dentro impediría empaquetar. La preparación arranca después
la API publicada en un directorio temporal y comprueba su proceso, puerto,
versión y respuesta de salud antes de construir los dos formatos. Cualquier
fallo detiene el trabajo. Esta preparación no afecta los paquetes de Windows.

## Publicación y recuperación

Antes de subir los archivos y antes de hacer público el borrador se comprueba
que `main` conserva el código construido. Sólo se permiten avances comprobados
de la landing o de documentación que no forme parte de los paquetes. Un cambio
de aplicación, licencia o avisos de terceros espera la validación del nuevo
commit, aunque conserve el número de versión. Una comparación inválida o con
300 archivos tampoco se da por completa. Si `main` avanza durante la subida,
el borrador se conserva sin publicar y las descargas anteriores siguen activas.

La subida crea primero un borrador. Solo se publica cuando GitHub confirma
todos los archivos, sus tamaños y sus hashes cuando los proporciona la API.
Se localiza en el listado autenticado y se comprueba y publica por su ID: la
consulta de una release por etiqueta puede devolver 404 mientras es borrador.
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
ejecución manual. El evento de una publicación solicita una ejecución desde
`main`, porque el entorno de Pages no admite despliegues desde etiquetas. Se
conserva esa protección. Así funciona también cuando GitHub no emite otro evento
`release` porque la publicación la creó su propio `GITHUB_TOKEN`.

El generador elige la versión más reciente con los seis paquetes y sus hashes.
Si hay un fallo o una publicación incompleta, conserva la web anterior. La
[guía de la landing](../guias/landing-github-pages.md) explica cómo previsualizar
las descargas y probar el catálogo sin red.
