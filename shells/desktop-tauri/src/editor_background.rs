use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Tope de la imagen de fondo. Por encima, el arranque empieza a notarse: la
/// imagen se lee entera y viaja por el puente cada vez que se abre la ventana.
const MAX_BACKGROUND_SIZE: u64 = 8 * 1024 * 1024;

/// Formatos admitidos, con el tipo que hay que declarar al devolverlos.
///
/// La lista es cerrada a propósito. Lo que se construye aquí es una URL `data:`
/// que la ventana va a pintar, y el tipo sale de la extensión del archivo que
/// elija el usuario: sin una lista, bastaría con renombrar cualquier cosa a
/// `.png` para decidir qué tipo declara la aplicación sobre su propio contenido.
const FORMATS: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
];

/// Cómo se llama el archivo dentro de la carpeta de datos.
///
/// Siempre el mismo nombre, con la extensión del original. Guardar el nombre que
/// traía obligaría a recordarlo en algún sitio para poder encontrarlo después, y
/// aquí solo puede haber una imagen a la vez.
const STORED_STEM: &str = "editor-background";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChosenBackground {
    /// El nombre que traía, solo para poder enseñar cuál está puesta.
    name: String,
    /// La imagen ya lista para pintar, como `data:`.
    source: String,
}

/// Elige una imagen, la copia junto a los datos de la aplicación y la devuelve leída.
///
/// Se copia en lugar de recordar la ruta porque el original puede moverse o
/// borrarse, y un fondo que desaparece al reordenar una carpeta de fotos sería
/// un fallo imposible de entender desde la aplicación.
#[tauri::command]
pub async fn choose_editor_background(app: AppHandle) -> Result<Option<ChosenBackground>, String> {
    let extensions: Vec<&str> = FORMATS.iter().map(|(extension, _)| *extension).collect();

    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Imagen", &extensions)
        .set_title("Elegir el fondo del editor")
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    let path = selected
        .into_path()
        .map_err(|_| "La selección no es un archivo local.".to_string())?;

    let (extension, mime) = format_of(&path)?;
    let metadata =
        std::fs::metadata(&path).map_err(|error| format!("No se pudo leer la imagen: {error}"))?;

    if !metadata.is_file() {
        return Err("La selección no es un archivo regular.".to_string());
    }
    if metadata.len() > MAX_BACKGROUND_SIZE {
        return Err("La imagen supera el límite de 8 MB.".to_string());
    }

    let bytes =
        std::fs::read(&path).map_err(|error| format!("No se pudo leer la imagen: {error}"))?;

    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{STORED_STEM}.{extension}"));

    clear(&app)?;

    let stored = storage_path(&app, extension)?;
    if let Some(parent) = stored.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo preparar la carpeta de datos: {error}"))?;
    }
    std::fs::write(&stored, &bytes)
        .map_err(|error| format!("No se pudo guardar la imagen: {error}"))?;

    Ok(Some(ChosenBackground {
        name,
        source: data_url(mime, &bytes),
    }))
}

/// La imagen guardada, lista para pintar, o nada si no hay ninguna.
#[tauri::command]
pub async fn read_editor_background(app: AppHandle) -> Result<Option<String>, String> {
    for (extension, mime) in FORMATS {
        let path = storage_path(&app, extension)?;

        if path.is_file() {
            let bytes = std::fs::read(&path)
                .map_err(|error| format!("No se pudo leer la imagen guardada: {error}"))?;

            return Ok(Some(data_url(mime, &bytes)));
        }
    }

    Ok(None)
}

#[tauri::command]
pub async fn clear_editor_background(app: AppHandle) -> Result<(), String> {
    clear(&app)
}

/// Borra la imagen guardada, sea cual sea su formato.
///
/// Recorre todos los formatos y no solo el actual: cambiar de PNG a JPG dejaría
/// el anterior ahí para siempre, y la aplicación lo encontraría primero al
/// arrancar.
fn clear(app: &AppHandle) -> Result<(), String> {
    for (extension, _) in FORMATS {
        let path = storage_path(app, extension)?;

        if path.is_file() {
            std::fs::remove_file(&path)
                .map_err(|error| format!("No se pudo quitar la imagen anterior: {error}"))?;
        }
    }

    Ok(())
}

fn storage_path(app: &AppHandle, extension: &str) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se encontró la carpeta de datos: {error}"))?;

    Ok(directory.join(format!("{STORED_STEM}.{extension}")))
}

fn format_of(path: &Path) -> Result<(&'static str, &'static str), String> {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    FORMATS
        .iter()
        .find(|(candidate, _)| *candidate == extension)
        .map(|(candidate, mime)| (*candidate, *mime))
        .ok_or_else(|| "Ese formato de imagen no se admite como fondo.".to_string())
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_se_admiten_los_formatos_de_la_lista() {
        assert!(format_of(Path::new("fondo.PNG")).is_ok());
        assert!(format_of(Path::new("fondo.jpeg")).is_ok());
        assert!(format_of(Path::new("fondo.bmp")).is_err());
        assert!(format_of(Path::new("fondo")).is_err());
    }

    #[test]
    fn el_tipo_lo_decide_la_extension_y_no_el_contenido() {
        let (_, mime) = format_of(Path::new("foto.jpg")).unwrap();

        assert_eq!(mime, "image/jpeg");
        assert!(data_url(mime, b"abc").starts_with("data:image/jpeg;base64,"));
    }
}
