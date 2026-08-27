// Sin consola en Windows cuando se compila para publicar: una aplicación de
// escritorio no debe abrir una ventana negra detrás.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Envoltorio de escritorio de Druse.
//!
//! Solo administra ventana, ciclo de vida y el proceso auxiliar de la API. **No
//! contiene lógica de base de datos** (ADR 0001): todo lo que hace es lanzar la
//! API, decirle al frontend dónde encontrarla y cerrarla al salir.

mod api_process;
mod backups;
mod editor_background;
mod exports;
mod sql_files;
mod theme;
mod transactions;
mod updates;

use std::sync::Mutex;

use api_process::{ApiProcess, Endpoint};
use sql_files::SqlFileState;
use tauri::{Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use transactions::PendingTransactions;

/// Estado compartido: el proceso de la API mientras la aplicación vive.
pub(crate) struct ApiState(pub Mutex<Option<ApiProcess>>);

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

/// Encoge la ventana hasta que quepa en el área de trabajo del monitor.
///
/// El tamaño de `tauri.conf.json` está en puntos, no en píxeles: 1440×900 son
/// 1800×1125 píxeles con el escalado al 125 % que Windows trae de fábrica en
/// muchos portátiles. En una pantalla de 1080 px el borde inferior —donde vive
/// la barra de estado— quedaba fuera de la pantalla, tapado por la barra de
/// tareas, y el usuario no tenía forma de recuperarlo salvo maximizando.
///
/// Se usa el área de trabajo y no la resolución porque aquella ya descuenta la
/// barra de tareas. Si el monitor no se puede consultar se deja la ventana como
/// está: es preferible una ventana grande a ninguna.
fn fit_to_work_area(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };

    let area = *monitor.work_area();
    let outer = window.outer_size()?;

    if outer.width <= area.size.width && outer.height <= area.size.height {
        return Ok(());
    }

    // `set_size` habla del área de cliente, así que hay que descontar el marco
    // y el título, que es justo lo que sobresalía de la pantalla.
    let inner = window.inner_size()?;
    let frame_width = outer.width.saturating_sub(inner.width);
    let frame_height = outer.height.saturating_sub(inner.height);

    let width = outer.width.min(area.size.width);
    let height = outer.height.min(area.size.height);

    window.set_size(PhysicalSize::new(
        width.saturating_sub(frame_width),
        height.saturating_sub(frame_height),
    ))?;

    // Centrar con `center()` usaría la resolución completa y volvería a meter el
    // borde inferior debajo de la barra de tareas; se centra dentro del área útil.
    window.set_position(PhysicalPosition::new(
        area.position.x + ((area.size.width - width) / 2) as i32,
        area.position.y + ((area.size.height - height) / 2) as i32,
    ))?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(ApiState(Mutex::new(None)))
        .manage(SqlFileState::default())
        .manage(PendingTransactions::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Que el ajuste falle no debe impedir que la aplicación arranque.
                if let Err(error) = fit_to_work_area(&window) {
                    eprintln!("Druse: no se pudo ajustar la ventana a la pantalla: {error}");
                }
            }

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
        .invoke_handler(tauri::generate_handler![
            api_connection,
            sql_files::open_sql_file,
            sql_files::save_sql_file,
            sql_files::save_sql_file_as,
            exports::save_export,
            backups::choose_backup_file,
            backups::choose_backup_folder,
            backups::choose_restore_source,
            transactions::set_transaction_pending,
            theme::set_window_theme,
            editor_background::choose_editor_background,
            editor_background::read_editor_background,
            editor_background::clear_editor_background,
            updates::app_info,
            updates::check_for_update,
            updates::download_and_install_update
        ])
        .on_window_event(|window, event| {
            // Cerrar con una transacción abierta tira lo que no esté confirmado:
            // al soltar la sesión, el proceso local la deshace. Puede ser el
            // trabajo de un buen rato, así que se pregunta antes.
            //
            // El aviso vive aquí y no en la página porque `beforeunload` no es
            // fiable dentro del WebView: la ventana la cierra el sistema, no el
            // navegador.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let pending = window
                    .try_state::<PendingTransactions>()
                    .map(|state| transactions::has_pending(&state))
                    .unwrap_or(false);

                if pending {
                    api.prevent_close();

                    let window = window.clone();

                    // Con respuesta diferida y no con un diálogo que bloquee:
                    // esto corre en el bucle de eventos, y esperar aquí colgaría
                    // la ventana que se intenta cerrar.
                    window.dialog()
                        .message(
                            "Hay una transacción abierta con cambios sin confirmar. \
                             Si cierras Druse ahora, se perderán.",
                        )
                        .title("Cambios sin confirmar")
                        .kind(MessageDialogKind::Warning)
                        .buttons(MessageDialogButtons::OkCancelCustom(
                            "Cerrar y perderlos".to_string(),
                            "Volver".to_string(),
                        ))
                        .show(move |confirmado| {
                            if confirmado {
                                let _ = window.destroy();
                            }
                        });
                }
            }

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

/// Comprobaciones sobre la configuración con la que se construye la ventana.
///
/// No prueban código: leen `tauri.conf.json` y sujetan dos decisiones que **solo
/// se notan en el ejecutable**, donde nadie mira hasta que algo se ve mal.
#[cfg(test)]
mod configuracion {
    const CONFIGURACION: &str = include_str!("../tauri.conf.json");

    fn seguridad() -> serde_json::Value {
        let raiz: serde_json::Value =
            serde_json::from_str(CONFIGURACION).expect("tauri.conf.json no es JSON válido");

        raiz["app"]["security"].clone()
    }

    /// Angular pinta los estilos de cada componente en una etiqueta `<style>`.
    ///
    /// Tauri añade un nonce a `style-src` al procesar la CSP, y la especificación
    /// dice que con un nonce presente **`'unsafe-inline'` se ignora**. Resultado:
    /// el navegador bloquea las quince etiquetas que inyecta Angular y la
    /// aplicación aparece sin una sola regla de disposición, con todo apilado en
    /// una columna. La hoja externa sigue cargando, así que desde fuera parece
    /// que el CSS «está», y por eso costó tanto verlo.
    ///
    /// Pedirle a Tauri que no toque esa directiva es lo que devuelve el efecto de
    /// `'unsafe-inline'`.
    #[test]
    fn tauri_no_toca_style_src() {
        let seguridad = seguridad();
        let excluidas = seguridad["dangerousDisableAssetCspModification"]
            .as_array()
            .expect("hace falta la lista de directivas que Tauri no debe modificar");

        assert!(
            excluidas.iter().any(|d| d == "style-src"),
            "sin `style-src` aquí, el nonce de Tauri anula 'unsafe-inline' y la \
             ventana se abre sin estilos"
        );
    }

    /// El puente con el proceso Rust viaja por `ipc.localhost`.
    ///
    /// Sin él en `connect-src`, la CSP bloquea cada `invoke` y se cae en silencio
    /// todo lo que depende del envoltorio: elegir dónde guardar una exportación,
    /// el selector de carpeta de los respaldos, abrir un `.sql`.
    #[test]
    fn el_puente_con_el_proceso_no_esta_bloqueado() {
        let seguridad = seguridad();
        let connect = seguridad["csp"]["connect-src"]
            .as_str()
            .expect("falta connect-src en la CSP");

        assert!(
            connect.contains("ipc:") && connect.contains("ipc.localhost"),
            "connect-src debe dejar pasar el IPC de Tauri; ahora es: {connect}"
        );
    }
}
