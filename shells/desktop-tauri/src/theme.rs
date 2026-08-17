use tauri::{AppHandle, Manager, Theme};

/// Pone el marco de la ventana en el mismo tema que la interfaz.
///
/// El contenido lo pinta la página con sus propias variables, pero **la barra de
/// título y los bordes los dibuja el sistema**, y esos no leen CSS. Sin esto, el
/// tema claro deja la ventana con la cabecera negra: la parte que no es de nadie
/// sería la única que se queda sin cambiar.
///
/// Lo pide la interfaz en cada cambio, y no lo decide el envoltorio, porque la
/// preferencia vive donde vive el resto de ajustes del usuario y el envoltorio no
/// habla con la base local.
#[tauri::command]
pub fn set_window_theme(app: AppHandle, theme: String) -> Result<(), String> {
    // Cualquier cosa que no sea claro es oscuro: es el tema de partida, y un
    // valor desconocido no puede dejar la ventana a medio camino.
    let requested = if theme == "light" {
        Theme::Light
    } else {
        Theme::Dark
    };

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "No se encontró la ventana principal.".to_string())?;

    window.set_theme(Some(requested)).map_err(|error| error.to_string())
}
