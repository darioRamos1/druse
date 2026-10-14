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
3. Sube `landing/` y `.github/workflows/pages.yml` a `main`. El workflow **Publicar landing en GitHub Pages** se ejecuta cuando cambian esos archivos; también se puede lanzar desde **Actions → Run workflow**.
4. La ejecución muestra la dirección publicada. Para este repositorio, la dirección predeterminada es `https://darioramos1.github.io/druse/`.

Si usas un repositorio público separado, copia allí `landing/` y `.github/workflows/pages.yml`, conserva `main` como rama predeterminada y configura Pages del mismo modo. La dirección cambiará según el nombre del repositorio. La web y sus recursos publicados serán visibles para sus visitantes.

Referencia: [workflows personalizados de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Activar la descarga

La landing enlaza la release pública `v1.3.0-beta.1` de Comunidad. El enlace está en el HTML y funciona sin JavaScript; la página de release conserva instalador, hashes y limitaciones juntos. Al cambiar de candidata, actualizar la descarga y sus textos en `index.html`, `primeros-pasos.html`, README y la guía SQLite, comprobando el acceso sin sesión. La beta no tiene Authenticode ni actualización automática.

La [guía SQLite](primera-prueba-sqlite.md) tiene su versión ilustrada en `landing/primeros-pasos.html`, con el SQL ficticio en `landing/assets/primeros-pasos.sql`. El workflow ya incluye estos recursos porque publica toda la carpeta `landing/`. Esta tarea no ejecuta el despliegue.

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
