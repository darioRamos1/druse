import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Puertos propios, distintos de los de `build/scripts/dev.ps1`.
 *
 * Quien desarrolla suele tener Druse levantado en 4200 y 5177; si las pruebas
 * usaran esos, o bien matarían su sesión o bien se ejecutarían contra ella —con
 * sus conexiones y sus pestañas— y dejarían de probar lo que dicen probar.
 */
const API_PORT = 5188;
const APP_PORT = 4300;

/**
 * Dónde escribe Druse mientras corren las pruebas.
 *
 * **Esto no es un detalle de comodidad.** La API guarda ahí las conexiones, el
 * historial y las pestañas; sin aislarlo, la primera ejecución dejaría una
 * conexión de pruebas metida entre las de verdad y ejecutaría consultas contra
 * la base del usuario.
 *
 * Se hace con `DRUSE_DATA_DIR` y no cambiando `APPDATA`, que sería lo obvio:
 * **en Windows .NET no mira esa variable**. `GetFolderPath` pregunta a la API
 * del sistema, así que el backend seguiría escribiendo en el perfil de verdad
 * mientras el proxy de Node —que sí la respeta— buscaría el token en la carpeta
 * vacía. Se descubrió aquí: el proxy se iba al puerto por omisión y ninguna
 * petición llegaba.
 */
const DATA_DIR = join(tmpdir(), 'druse-e2e-datos');

/**
 * La carpeta persiste entre ejecuciones a propósito.
 *
 * Vaciarla aquí rompería `reuseExistingServer`: en local el backend sigue vivo
 * de la ejecución anterior y se le estaría borrando la base bajo los pies. Las
 * pruebas se escriben para no depender de lo que encuentren; para empezar de
 * cero, se borra a mano y se vuelven a levantar los servidores.
 */
mkdirSync(DATA_DIR, { recursive: true });

/** Lo que llevan los dos procesos: la misma carpeta, mirada por la misma variable. */
const isolated = {
  ...process.env,
  DRUSE_DATA_DIR: DATA_DIR,
};

export default defineConfig({
  testDir: './tests',

  // Cuatro minutos: la primera prueba se come el arranque del editor, que carga
  // Monaco aparte, y la conexión real contra el contenedor.
  timeout: 4 * 60 * 1000,
  expect: { timeout: 15_000 },

  /**
   * Una sola a la vez, y siempre.
   *
   * Todas comparten un backend, una base de datos y un almacén de conexiones.
   * En paralelo, una prueba vería a medias lo que otra está creando, y el fallo
   * saldría en la que no tiene la culpa.
   */
  workers: 1,
  fullyParallel: false,

  // En CI no se reintenta: un E2E que solo pasa a la segunda esconde justo lo
  // que hay que arreglar.
  retries: 0,
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'es-ES',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /**
   * La aplicación entera: la API primero y el servidor de desarrollo después.
   *
   * El orden importa poco —el proxy relee el punto de conexión en cada
   * petición— pero los dos tienen que compartir la carpeta de datos, porque es
   * donde la API escribe el token y donde el proxy va a buscarlo.
   */
  webServer: [
    {
      command: `dotnet run --project ../backend/src/Druse.Host.LocalApi --no-launch-profile`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 4 * 60 * 1000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...isolated,
        LocalApi__Port: String(API_PORT),
        ASPNETCORE_ENVIRONMENT: 'Development',
      },
    },
    {
      command: `npm start -- --port ${APP_PORT}`,
      cwd: '../frontend',
      url: `http://localhost:${APP_PORT}`,
      timeout: 5 * 60 * 1000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...isolated,
        // El proxy fija su destino al arrancar, y arranca a la vez que la API:
        // esperar a que exista el punto de conexión sería una carrera, así que
        // se le dice el puerto directamente.
        DRUSE_API_PORT: String(API_PORT),
      },
    },
  ],
});

export { API_PORT, APP_PORT, DATA_DIR };
