// Sin consola en Windows cuando se compila para publicar: una aplicación de
// escritorio no debe abrir una ventana negra detrás.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Envoltorio de escritorio de Druse.
//!
//! Solo administra ventana, ciclo de vida y el proceso auxiliar de la API. **No
//! contiene lógica de base de datos** (ADR 0001): todo lo que hace es lanzar la
//! API, decirle al frontend dónde encontrarla y cerrarla al salir.

mod api_process;

use std::sync::Mutex;

use api_process::{ApiProcess, Endpoint};
use tauri::{Manager, State};

/// Estado compartido: el proceso de la API mientras la aplicación vive.
struct ApiState(Mutex<Option<ApiProcess>>);

/// Lo que el frontend necesita para hablar con la API.
#[derive(serde::Serialize)]
struct ApiConnection {
    base_url: String,
    token: String,
}

/// Devuelve al frontend el puerto y el token de la API.
///
/// Es la razón de ser de este envoltorio: el navegador no puede leer archivos
/// del disco, así que alguien con acceso al sistema tiene que pasarle estos
/// datos. En desarrollo lo hace el proxy del servidor de Angular; aquí, Tauri.
#[tauri::command]
fn api_connection(state: State<'_, ApiState>) -> Result<ApiConnection, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "El estado de la API quedó inconsistente.".to_string())?;

    let process = guard
        .as_ref()
        .ok_or_else(|| "La API local no está disponible.".to_string())?;

    Ok(from_endpoint(&process.endpoint))
}

fn from_endpoint(endpoint: &Endpoint) -> ApiConnection {
    ApiConnection {
        base_url: format!("http://127.0.0.1:{}", endpoint.port),
        token: endpoint.token.clone(),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ApiState(Mutex::new(None)))
        .setup(|app| {
            let data_dir = api_process::data_directory()?;
            std::fs::create_dir_all(&data_dir)?;

            let resource_dir = app.path().resource_dir()?;

            // En desarrollo la API la arranca `dev.ps1`; al estar empaquetado,
            // viaja junto a la aplicación y la lanzamos nosotros.
            let process = match api_process::locate_api(&resource_dir) {
                Some(executable) => ApiProcess::start(&executable, &data_dir)?,
                None => ApiProcess::attach(&data_dir)?,
            };

            println!(
                "Druse: API local en el puerto {} (proceso {})",
                process.endpoint.port,
                process.api_pid()
            );

            app.state::<ApiState>()
                .0
                .lock()
                .map_err(|_| "El estado de la API quedó inconsistente.")?
                .replace(process);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api_connection])
        .on_window_event(|window, event| {
            // Al cerrar la ventana hay que parar la API: dejarla viva
            // mantendría abiertas las conexiones del usuario contra sus bases de
            // datos (plan §12).
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<ApiState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(process) = guard.as_mut() {
                            process.stop();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Druse");
}
