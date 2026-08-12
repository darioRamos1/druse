// @ts-check
/**
 * Proxy del servidor de desarrollo hacia la API local.
 *
 * Además de redirigir `/api`, añade el token que la API exige. El navegador no
 * puede leer archivos del disco, así que el token lo inyecta aquí el propio
 * servidor de desarrollo, que sí corre en la máquina del usuario.
 *
 * En producción no hace falta: será el proceso que empaqueta la aplicación
 * (Tauri, Fase 7) quien lea el archivo y se lo pase al frontend.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOKEN_FILE = 'api-token';

/** Directorio de datos de Druse, según la convención de cada sistema. */
function dataDirectory() {
  const home = os.homedir();

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Druse');
  }

  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Druse');
  }

  const dataHome = process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME)
    ? process.env.XDG_DATA_HOME
    : path.join(home, '.local', 'share');

  return path.join(dataHome, 'druse');
}

const tokenPath = path.join(dataDirectory(), TOKEN_FILE);

/**
 * Lee el token en cada petición.
 *
 * No se guarda en memoria a propósito: la API genera uno nuevo en cada arranque,
 * y cachearlo obligaría a reiniciar el servidor de desarrollo cada vez que se
 * reinicia el backend.
 */
function readToken() {
  try {
    return fs.readFileSync(tokenPath, 'utf8').trim();
  } catch {
    return null;
  }
}

let warned = false;

/** Añade la cabecera del token a una petición saliente. */
function attachToken(proxyReq) {
  const token = readToken();

  if (token) {
    proxyReq.setHeader('X-Druse-Token', token);
    return;
  }

  // Un solo aviso: repetirlo en cada petición ahogaría la consola.
  if (!warned) {
    warned = true;
    console.warn(
      `\n[druse] No se encontró el token en ${tokenPath}.` +
        '\n[druse] Arranca la API local; sin token responderá 401.\n',
    );
  }
}

module.exports = {
  '/api': {
    target: 'http://127.0.0.1:5177',
    secure: false,
    changeOrigin: false,
    logLevel: 'warn',

    // El servidor de desarrollo de Angular usa Vite, que expone el proxy
    // subyacente por `configure`. El estilo `on: { proxyReq }` pertenece a
    // http-proxy-middleware v3 y aquí se ignora en silencio, que es justo lo
    // que hacía que todas las peticiones llegaran sin token.
    configure: (proxy) => {
      proxy.on('proxyReq', attachToken);
    },
  },
};
