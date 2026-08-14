use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Guarda en disco un archivo exportado.
///
/// Existe porque **la ventana empaquetada no sabe descargar**. En el navegador,
/// exportar crea un `blob:` y lo abre con un enlace `download`; dentro de Tauri
/// eso no hace nada: la CSP solo admite `blob:` para imágenes y workers, y el
/// WebView no trae gestor de descargas. Lo peor es que no falla —`click()` no
/// lanza nada—, así que la aplicación decía «Exportado» sin haber escrito nada.
///
/// El contenido llega en bytes y no como texto porque un XLSX es binario: pasarlo
/// por una cadena lo corrompería.
///
/// La ruta la elige el usuario en el diálogo del sistema, igual que al guardar
/// un `.sql`. El WebView no puede pedir que se escriba en un sitio concreto, que
/// es lo que impide que esto sea una vía para escribir donde le apetezca.
#[tauri::command]
pub async fn save_export(
    app: AppHandle,
    suggested_name: String,
    contents: Vec<u8>,
) -> Result<Option<String>, String> {
    let suggested_name = safe_file_name(&suggested_name);
    let extension = extension_of(&suggested_name);

    let mut dialog = app
        .dialog()
        .file()
        .set_title("Guardar exportación")
        .set_file_name(&suggested_name);

    // El filtro se nombra por lo que el usuario reconoce, no por la extensión:
    // quien exporta a Excel busca «Excel», no «xlsx».
    dialog = match extension.as_str() {
        "csv" => dialog.add_filter("CSV", &["csv"]),
        "xlsx" => dialog.add_filter("Excel", &["xlsx"]),
        _ => dialog,
    };

    let Some(selected) = dialog.blocking_save_file() else {
        return Ok(None);
    };

    let mut path = selected
        .into_path()
        .map_err(|_| "La selección no es una ruta local.".to_string())?;

    // Si el usuario borró la extensión en el diálogo, se repone: un XLSX sin su
    // extensión no lo abre Excel, y descubrirlo obliga a renombrar a mano.
    if !extension.is_empty()
        && !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(&extension))
    {
        path.set_extension(&extension);
    }

    std::fs::write(&path, contents)
        .map_err(|error| format!("No se pudo guardar el archivo: {error}"))?;

    Ok(Some(path.to_string_lossy().to_string()))
}

/// Se queda solo con el nombre, descartando cualquier ruta que venga con él.
///
/// El nombre lo propone el frontend a partir del título de la pestaña, así que
/// puede traer separadores. Sin esto, un título como `../../algo` acabaría
/// proponiendo una ruta fuera de donde el usuario cree que está guardando.
fn safe_file_name(value: &str) -> String {
    let trimmed = Path::new(value.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");

    if trimmed.is_empty() {
        "druse".to_string()
    } else {
        trimmed.to_string()
    }
}

fn extension_of(file_name: &str) -> String {
    Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discards_paths_from_the_suggested_name() {
        assert_eq!(safe_file_name("ventas.csv"), "ventas.csv");
        assert_eq!(safe_file_name("../../ventas.csv"), "ventas.csv");
        assert_eq!(safe_file_name("  "), "druse");
        assert_eq!(safe_file_name("C:\\otro\\sitio\\ventas.xlsx"), "ventas.xlsx");
    }

    #[test]
    fn reads_the_extension_in_lowercase() {
        assert_eq!(extension_of("ventas.CSV"), "csv");
        assert_eq!(extension_of("ventas.xlsx"), "xlsx");
        assert_eq!(extension_of("ventas"), "");
    }
}
