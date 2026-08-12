// @ts-check
/**
 * Proxy del servidor de desarrollo hacia la API local.
 *
 * Redirige `/api` y añade el token que la API exige. El navegador no puede leer
 * archivos del disco, así que el token lo inyecta aquí el propio servidor de
 * desarrollo, que sí corre en la máquina del usuario.
 *
 * En producción no hace falta: será Tauri quien lea el mismo archivo y le pase
 * al frontend el puerto y el token.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENDPOINT_FILE = 'endpoint.json';

/** Puerto al que ir si no hay archivo de punto de conexión. */
const FALLBACK_PORT = 5177;

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

  const dataHome =
    process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME)
      ? process.env.XDG_DATA_HOME
      : path.join(home, '.local', 'share');

  return path.join(dataHome, 'druse');
}

const endpointPath = path.join(dataDirectory(), ENDPOINT_FILE);

/**
 * Lee el punto de conexión en cada petición.
 *
 * No se guarda en memoria a propósito: la API genera un token nuevo en cada
 * arranque y, con puerto dinámico, también puede cambiar de puerto. Cachearlo
 * obligaría a reiniciar el servidor de desarrollo cada vez que se reinicia el
 * backend.
 */
function readEndpoint() {
  try {
    const raw = JSON.parse(fs.readFileSync(endpointPath, 'utf8'));

    return { port: raw.port || FALLBACK_PORT, token: raw.token || null };
  } catch {
    return { port: FALLBACK_PORT, token: null };
  }
}

let warned = false;

module.exports = {
  '/api': {
    // El destino real lo decide `router` en cada petición; este valor solo se
    // usa si el archivo no existe.
    target: `http://127.0.0.1:${FALLBACK_PORT}`,
    secure: false,
    changeOrigin: false,
    logLevel: 'warn',

    /** Sigue a la API si arrancó en otro puerto. */
    router: () => `http://127.0.0.1:${readEndpoint().port}`,

    // El servidor de desarrollo de Angular usa Vite, que expone el proxy
    // subyacente por `configure`. El estilo `on: { proxyReq }` pertenece a
    // http-proxy-middleware v3 y aquí se ignora en silencio, que es justo lo
    // que hacía que todas las peticiones llegaran sin token.
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        const { token } = readEndpoint();

        if (token) {
          proxyReq.setHeader('X-Druse-Token', token);
          return;
        }

        // Un solo aviso: repetirlo en cada petición ahogaría la consola.
        if (!warned) {
          warned = true;
          console.warn(
            `\n[druse] No se encontró el punto de conexión en ${endpointPath}.` +
              '\n[druse] Arranca la API local; sin token responderá 401.\n',
          );
        }
      });
    },
  },
};
