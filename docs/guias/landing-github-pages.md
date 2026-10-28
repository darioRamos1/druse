# Landing de Druse

La web está en `landing/`. Es HTML, CSS y JavaScript estático, con las fuentes y el icono locales. No necesita compilar Angular ni iniciar la API. El workflow publica **únicamente** esa carpeta.

## Vista previa

Desde la raíz, con Python instalado:

```powershell
python -m http.server 4321 --bind 127.0.0.1 --directory landing
```

Abre `http://127.0.0.1:4321`. Las rutas relativas también permiten servirla bajo `/druse/` en GitHub Pages.

## Publicar en GitHub Pages

1. El repositorio es público desde el 16 de septiembre de 2026 y la landing está en `https://darioramos1.github.io/druse/`.
2. Para publicar desde este repositorio, abre **Settings → Pages → Build and deployment → Source** y elige **GitHub Actions**.
3. Sube `landing/`, el generador `build/scripts/generar-descargas-web.cjs` y `.github/workflows/pages.yml` a `main`. El workflow **Publicar landing en GitHub Pages** se ejecuta cuando cambian esos archivos y cuando termina correctamente la publicación de una versión; también se puede lanzar desde **Actions → Run workflow**.
4. La ejecución muestra la dirección publicada. Para este repositorio, la dirección predeterminada es `https://darioramos1.github.io/druse/`.

Si usas un repositorio público separado, copia allí `landing/` y `.github/workflows/pages.yml`, conserva `main` como rama predeterminada y configura Pages del mismo modo. La dirección cambiará según el nombre del repositorio. La web y sus recursos publicados serán visibles para sus visitantes.

Referencia: [workflows personalizados de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Descargas de cada versión

Los binarios viven en GitHub Releases, separados del código de la landing. Antes de publicar Pages, `build/scripts/generar-descargas-web.cjs` consulta todas las páginas de releases con `gh api`, elige la versión semántica más reciente que tenga los seis archivos (instalador y portable de Completa, Sin Informix y Comunidad) más `SHA256SUMS.txt`, y actualiza las regiones marcadas de `index.html` y `primeros-pasos.html`. Los enlaces quedan escritos en el HTML y funcionan sin JavaScript; el navegador no consulta la API.

No hay que cambiar a mano la versión o los enlaces de la web. Se descartan borradores, archivos vacíos o a medio subir, enlaces que no coinciden con el repositorio y publicaciones nuevas incompletas. Si la consulta falla o ninguna publicación es apta, falla el despliegue y la página ya publicada se conserva. Ninguna tarjeta mezcla archivos de versiones diferentes.

La beta histórica `v1.3.0-beta.1` es la única excepción de compatibilidad: si todavía es la última publicación apta, solo se ofrece su instalador de Comunidad y las otras opciones aparecen sin enlace, como no disponibles. Esa beta no tiene Authenticode ni actualización automática. No se inventan enlaces para completar el catálogo.

Para regenerar las descargas localmente con `gh` autenticado:

```powershell
node build/scripts/generar-descargas-web.cjs
node --test build/tests/descargas-web.cjs
```

Para comprobar un catálogo ficticio sin red, usa `node build/scripts/generar-descargas-web.cjs --releases ruta/al/catalogo.json`. El archivo admite una lista de releases o una lista de páginas de la API. Las regiones generadas no deben editarse a mano; sus textos se mantienen en el generador.

El portable es un ZIP que se extrae completo para ejecutar `druse.exe`. Requiere Microsoft Edge WebView2 instalado. Guarda las conexiones y preferencias en el perfil de Windows, no junto al ejecutable; copiar la carpeta a otro equipo no traslada esos datos.

La [guía SQLite](primera-prueba-sqlite.md) tiene su versión ilustrada en `landing/primeros-pasos.html`, con el SQL ficticio en `landing/assets/primeros-pasos.sql`. El workflow incluye estos recursos porque publica toda la carpeta `landing/`.

## Contenido y mantenimiento

- `landing/index.html`: textos, motores, preguntas frecuentes y vista ilustrativa con datos ficticios. Esta vista no ejecuta SQL ni conecta a una base de datos.
- `landing/styles.css`: estilos responsive y adaptación para movimiento reducido.
- `landing/script.js`: menú móvil.
- `landing/effects.css` y `landing/effects.js`: iluminación, entradas al desplazarse, respuesta al cursor y consulta de demostración local. El botón de efectos permite pausarlos; también se respeta la preferencia de movimiento reducido del sistema. La demo utiliza únicamente los datos ficticios de la página.
- `landing/legal.html`: borrador de privacidad, tratamiento de datos, cookies y aviso legal. El correo confirmado para soporte y privacidad es `druse.contacto@gmail.com`; deben completarse la identidad del responsable, los demás datos legales y la jurisdicción antes de presentarlo como política final.
- `landing/privacy.css` y `landing/privacy.js`: preferencias opcionales, rechazables y revocables. La preferencia visual solo se guarda con una elección explícita, durante un máximo de 180 días. El botón de efectos por sí solo ya no escribe almacenamiento persistente.
- `landing/assets/`: icono original de Druse, fuentes locales y licencias.

La página no incluye analítica, formularios ni contenido incrustado de servicios externos. Los enlaces de contacto abren el cliente de correo del visitante. No se anuncia una licencia, precio o disponibilidad de instaladores que aún no se haya definido.

La ausencia de analítica no significa ausencia de tratamiento técnico: GitHub Pages registra IP por seguridad. Consulta [la revisión de privacidad y los pendientes](../privacidad/landing-privacidad.md) antes de publicar o incorporar servicios nuevos.
