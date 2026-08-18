use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Elige dónde escribir un respaldo que sale como un solo archivo.
///
/// A diferencia de `save_export`, **aquí no viajan los bytes**: solo se devuelve
/// la ruta. Un respaldo puede ocupar gigabytes y lo escribe el proceso local
/// directamente sobre el disco; pasarlo por el puente obligaría a tenerlo entero
/// en memoria, y dos veces, para acabar escribiendo lo mismo.
///
/// La ruta la elige el usuario en el diálogo del sistema. El WebView no puede
/// pedir que se escriba en un sitio concreto, que es lo que impide que esto sea
/// una vía para escribir donde le apetezca.
#[tauri::command]
pub async fn choose_backup_file(
    app: AppHandle,
    suggested_name: String,
) -> Result<Option<String>, String> {
    let suggested_name = safe_file_name(&suggested_name);
    let comprimido = suggested_name.to_ascii_lowercase().ends_with(".zip");

    let mut dialog = app
        .dialog()
        .file()
        .set_title("Guardar respaldo")
        .set_file_name(&suggested_name);

    dialog = if comprimido {
        dialog.add_filter("Respaldo comprimido", &["zip"])
    } else {
        dialog.add_filter("Guion SQL", &["sql"])
    };

    let Some(selected) = dialog.blocking_save_file() else {
        return Ok(None);
    };

    let mut path = selected
        .into_path()
        .map_err(|_| "La selección no es una ruta local.".to_string())?;

    // Si el usuario borró la extensión en el diálogo, se repone: un respaldo sin
    // ella no se distingue de cualquier otro archivo al buscarlo meses después.
    let extension = if comprimido { "zip" } else { "sql" };

    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    {
        path.set_extension(extension);
    }

    Ok(Some(path.to_string_lossy().to_string()))
}

/// Elige la carpeta donde escribir un respaldo repartido por tipo de objeto.
#[tauri::command]
pub async fn choose_backup_folder(app: AppHandle) -> Result<Option<String>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Carpeta del respaldo")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };

    let path = selected
        .into_path()
        .map_err(|_| "La selección no es una ruta local.".to_string())?;

    Ok(Some(path.to_string_lossy().to_string()))
}

/// Elige el respaldo que se va a restaurar.
///
/// Un respaldo puede ser **un archivo o una carpeta**, así que se pregunta cuál
/// de los dos se busca en vez de adivinarlo: un diálogo de archivos no deja
/// elegir una carpeta y uno de carpetas no deja elegir un archivo, y equivocarse
/// deja al usuario sin poder seleccionar lo que tiene delante.
///
/// Tampoco aquí viajan los bytes: se devuelve la ruta y el proceso local lo lee.
#[tauri::command]
pub async fn choose_restore_source(
    app: AppHandle,
    folder: bool,
) -> Result<Option<String>, String> {
    let selected = if folder {
        app.dialog()
            .file()
            .set_title("Carpeta del respaldo a restaurar")
            .blocking_pick_folder()
    } else {
        app.dialog()
            .file()
            .set_title("Respaldo a restaurar")
            .add_filter("Respaldo", &["sql", "zip"])
            .blocking_pick_file()
    };

    let Some(selected) = selected else {
        return Ok(None);
    };

    let path = selected
        .into_path()
        .map_err(|_| "La selección no es una ruta local.".to_string())?;

    Ok(Some(path.to_string_lossy().to_string()))
}

/// Se queda con el nombre del archivo y descarta cualquier ruta que traiga.
///
/// Lo propone la página, así que podría venir con `..` o con separadores. El
/// diálogo solo debe recibir un nombre.
fn safe_file_name(suggested: &str) -> String {
    let name = suggested
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(suggested)
        .trim();

    if name.is_empty() || name == "." || name == ".." {
        "respaldo.sql".to_string()
    } else {
        name.to_string()
    }
}
