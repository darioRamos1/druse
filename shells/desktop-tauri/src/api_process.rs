//! Arranque y parada de la API local.
//!
//! Tauri administra el ciclo de vida del proceso auxiliar; no contiene ninguna
//! lógica de base de datos (ADR 0001). Todo lo que sabe es lanzar el ejecutable,
//! esperar a que publique su punto de conexión y matarlo al cerrar.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use serde::Deserialize;

/// Nombre del archivo que la API escribe con su puerto y su token.
const ENDPOINT_FILE: &str = "endpoint.json";

/// `CREATE_NO_WINDOW`.
///
/// La API es una aplicación de consola. Sin esta bandera, Windows le abre su
/// propia ventana negra con los registros de ASP.NET **delante de Druse**: el
/// usuario ve un terminal que no ha pedido y que tapa la aplicación.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Cuánto se espera a que la API arranque antes de darse por vencido.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

/// Datos de conexión que publica la API al arrancar.
#[derive(Debug, Clone, Deserialize)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
    #[serde(default)]
    pub pid: u32,
}

/// Proceso de la API con su punto de conexión.
pub struct ApiProcess {
    child: Option<Child>,
    endpoint_path: PathBuf,
    pub endpoint: Endpoint,
}

impl ApiProcess {
    /// Lanza la API y espera a que publique dónde escucha.
    ///
    /// Se le pasa el puerto 0 para que el sistema le asigne uno libre: un puerto
    /// fijo podría estar ocupado por otro programa o por otra instancia de
    /// Druse.
    pub fn start(executable: &Path, data_dir: &Path) -> Result<Self, String> {
        let endpoint_path = data_dir.join(ENDPOINT_FILE);

        // Se borra el archivo anterior antes de arrancar: si quedó de una
        // ejecución que terminó mal, leerlo daría un puerto y un token muertos.
        let _ = fs::remove_file(&endpoint_path);

        let mut command = Command::new(executable);
        command
            .env("LocalApi__Port", "0")
            .env("ASPNETCORE_ENVIRONMENT", "Production");

        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);

        let child = command
            .spawn()
            .map_err(|error| format!("No se pudo arrancar la API local: {error}"))?;

        let endpoint = wait_for_endpoint(&endpoint_path)?;

        Ok(Self {
            child: Some(child),
            endpoint_path,
            endpoint,
        })
    }

    /// Se conecta a una API que ya está corriendo, sin lanzar ninguna.
    ///
    /// Es lo que se usa en desarrollo, cuando la API la arranca `dev.ps1` y
    /// Tauri solo tiene que hablar con ella.
    pub fn attach(data_dir: &Path) -> Result<Self, String> {
        let endpoint_path = data_dir.join(ENDPOINT_FILE);
        let endpoint = wait_for_endpoint(&endpoint_path)?;

        Ok(Self {
            child: None,
            endpoint_path,
            endpoint,
        })
    }

    /// Identificador del proceso de la API, para diagnóstico.
    ///
    /// Cuando la API la arrancó otro —en desarrollo— este es el único modo de
    /// saber a qué proceso pertenece el punto de conexión que estamos usando.
    pub fn api_pid(&self) -> u32 {
        match self.child.as_ref() {
            Some(child) => child.id(),
            None => self.endpoint.pid,
        }
    }

    /// Detiene la API si la lanzamos nosotros.
    pub fn stop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();

            // `kill` no da tiempo a la API a ejecutar su manejador de apagado,
            // así que el archivo del punto de conexión lo borramos aquí. Dejarlo
            // no sería una brecha —ese token ya no lo acepta nadie— pero sí
            // ensuciaría el directorio del usuario.
            let _ = fs::remove_file(&self.endpoint_path);
        }
    }
}

impl Drop for ApiProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Espera a que aparezca el archivo con el punto de conexión.
///
/// Se sondea el archivo en lugar de leer la salida del proceso porque el
/// archivo es también el mecanismo que usa el servidor de desarrollo: un solo
/// camino que mantener.
fn wait_for_endpoint(path: &Path) -> Result<Endpoint, String> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;

    while Instant::now() < deadline {
        if let Ok(contents) = fs::read_to_string(path) {
            // El archivo puede leerse a medio escribir; en ese caso se reintenta.
            if let Ok(endpoint) = serde_json::from_str::<Endpoint>(&contents) {
                if endpoint.port > 0 && !endpoint.token.is_empty() {
                    return Ok(endpoint);
                }
            }
        }

        thread::sleep(Duration::from_millis(100));
    }

    Err(format!(
        "La API local no publicó su punto de conexión en {} segundos.",
        STARTUP_TIMEOUT.as_secs()
    ))
}

/// Directorio de datos del usuario, con la misma convención que `IAppPaths`.
pub fn data_directory() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let base = dirs::data_dir().map(|dir| dir.join("Druse"));

    #[cfg(target_os = "macos")]
    let base = dirs::data_dir().map(|dir| dir.join("Druse"));

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let base = dirs::data_dir().map(|dir| dir.join("druse"));

    base.ok_or_else(|| "No se pudo determinar el directorio de datos.".to_string())
}

/// Localiza el ejecutable de la API junto al de la aplicación.
///
/// Al empaquetar, la API viaja como recurso adjunto en el mismo directorio, de
/// modo que la aplicación funciona sin que el usuario instale .NET.
pub fn locate_api(resource_dir: &Path) -> Option<PathBuf> {
    let name = if cfg!(target_os = "windows") {
        "Druse.Host.LocalApi.exe"
    } else {
        "Druse.Host.LocalApi"
    };

    let candidates = [
        resource_dir.join(name),
        resource_dir.join("api").join(name),
    ];

    candidates.into_iter().find(|path| path.exists())
}
