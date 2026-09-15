// La app y la web muestran el mismo aviso, sin cargar documentos externos al abrir Druse.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const notice = fs.readFileSync(path.join(root, 'frontend/src/app/shared/privacy/privacy-notice.html'), 'utf8').replace(/\r\n/g, '\n').trim();
const destination = path.join(root, 'landing/privacidad-aplicacion.html');
const page = `<!doctype html>
<!-- Generado por build/scripts/generar-privacidad-web.cjs. Editar privacy-notice.html. -->
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta name="referrer" content="no-referrer" />
    <title>Privacidad de la aplicación — Druse</title>
    <link rel="icon" href="./assets/druse.png" />
    <link rel="stylesheet" href="./styles.css" />
    <link rel="stylesheet" href="./privacy.css" />
    <link rel="stylesheet" href="./application-privacy.css" />
  </head>
  <body class="legal-page">
    <a class="skip-link" href="#contenido">Saltar al contenido</a>
    <header class="container legal-footer"><a href="./">← Volver a Druse</a></header>
    <main class="container legal-layout" id="contenido">
      <nav class="legal-sidebar" aria-label="Información legal">
        <a href="./legal.html#privacidad">Privacidad de la web</a>
        <a href="./legal.html#cookies">Cookies de la web</a>
        <a href="./legal.html#contacto">Contacto</a>
      </nav>
      <div class="legal-content">
        <h1>Privacidad de la aplicación</h1>
        ${notice}
        <section aria-labelledby="proveedores">
          <h2 id="proveedores">Políticas de los servicios</h2>
          <ul>
            <li><a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noreferrer">GitHub — descargas y actualizaciones</a></li>
            <li><a href="https://policies.google.com/privacy?hl=es" rel="noreferrer">Google — correo de contacto</a></li>
            <li><a href="https://privacy.microsoft.com/es-es/privacystatement" rel="noreferrer">Microsoft — WebView2</a></li>
          </ul>
          <p>Para bases de datos, SSH e IA, consulta la política del proveedor que hayas configurado.</p>
        </section>
      </div>
    </main>
    <footer class="container legal-footer"><a href="./">Volver a Druse</a></footer>
  </body>
</html>
`;
if (process.argv.includes('--check')) {
  const existing = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n') : '';
  if (existing !== page) {
    console.error('Aviso web desactualizado. Ejecuta: node build/scripts/generar-privacidad-web.cjs');
    process.exitCode = 1;
  } else console.log('OK: app y web comparten el aviso de privacidad.');
} else fs.writeFileSync(destination, page);
