//! Arranque y parada de la API local.
//!
//! Tauri administra el ciclo de vida del proceso auxiliar; no contiene ninguna
//! lógica de base de datos (ADR 0001). Todo lo que sabe es lanzar el ejecutable,
//! esperar a que publique su punto de conexión y matarlo al cerrar.

use std::env;
use std::ffi::OsString;
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

/// Variable que manda sobre la convención del sistema.
///
/// **La API ya la respeta** —`AppPaths.DataDirectoryVariable`— y el envoltorio
/// no lo hacía: la API publicaba su punto de conexión en el directorio pedido
/// mientras aquí se buscaba en el perfil del usuario. Nadie encontraba a nadie
/// y la ventana moría a los treinta segundos diciendo que la API no había
/// arrancado, cuando había arrancado perfectamente y estaba escuchando.
///
/// Peor todavía: si en el perfil quedaba el `endpoint.json` de otra instancia
/// de Druse, esta se conectaba a **la API de esa otra**, es decir, al espacio de
/// trabajo que se creía estar aislando. Es el mismo engaño que la API documenta
/// haber sufrido al montar las pruebas de punta a punta.
const DATA_DIRECTORY_VARIABLE: &str = "DRUSE_DATA_DIR";

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
            .env("ASPNETCORE_ENVIRONMENT", "Production")
            // Con esto la API sabe a quién acompaña y se apaga sola si esta
            // ventana desaparece sin poder terminarla —un cuelgue, un cierre de
            // sesión—. Sin ello quedaba viva, con el puerto tomado y sus
            // archivos bloqueados, impidiendo hasta desinstalar Druse.
            .env("LocalApi__ParentProcessId", std::process::id().to_string());

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

    resolve_data_directory(env::var_os(DATA_DIRECTORY_VARIABLE), base)
}

/// Decide el directorio de datos a partir de la variable y de la convención.
///
/// Está separada de `data_directory` para poder probarla sin tocar el entorno
/// del proceso, que es global y compartido con las demás pruebas.
fn resolve_data_directory(
    custom: Option<OsString>,
    base: Option<PathBuf>,
) -> Result<PathBuf, String> {
    if let Some(custom) = custom {
        let custom = PathBuf::from(custom);

        // Una ruta relativa se resolvería contra el directorio de trabajo, que
        // no es el que nadie espera: se exige absoluta o se ignora, igual que
        // hace la API. Que ambos lados apliquen la misma regla es justamente lo
        // que se está arreglando aquí.
        if custom.is_absolute() {
            return Ok(custom);
        }
    }

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

    let candidates = [resource_dir.join(name), resource_dir.join("api").join(name)];

    candidates.into_iter().find(|path| path.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_variable_wins_over_the_system_convention() {
        let pedido = if cfg!(windows) {
            PathBuf::from(r"C:\datos\druse")
        } else {
            PathBuf::from("/datos/druse")
        };

        let elegido = resolve_data_directory(
            Some(OsString::from(pedido.as_os_str())),
            Some(PathBuf::from("/perfil/druse")),
        );

        assert_eq!(elegido, Ok(pedido));
    }

    /// Es la misma regla que aplica la API: una ruta relativa dependería del
    /// directorio de trabajo, así que se ignora en lugar de escribir en un sitio
    /// sorpresa.
    #[test]
    fn a_relative_path_is_ignored() {
        let base = PathBuf::from("/perfil/druse");

        let elegido = resolve_data_directory(Some(OsString::from("datos")), Some(base.clone()));

        assert_eq!(elegido, Ok(base));
    }

    #[test]
    fn without_the_variable_the_convention_applies() {
        let base = PathBuf::from("/perfil/druse");

        assert_eq!(resolve_data_directory(None, Some(base.clone())), Ok(base));
    }

    #[test]
    fn without_variable_or_convention_it_explains_itself() {
        let error = resolve_data_directory(None, None).unwrap_err();

        assert!(error.contains("directorio de datos"), "{error}");
    }
}
