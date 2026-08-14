use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const MAX_SQL_FILE_SIZE: u64 = 10 * 1024 * 1024;

pub struct SqlFileState {
    paths: Mutex<HashMap<String, PathBuf>>,
    next_id: AtomicU64,
}

impl Default for SqlFileState {
    fn default() -> Self {
        Self {
            paths: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlDocument {
    document_id: String,
    file_name: String,
    contents: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSqlDocument {
    document_id: String,
    file_name: String,
}

#[tauri::command]
pub async fn open_sql_file(
    app: AppHandle,
    state: State<'_, SqlFileState>,
) -> Result<Option<SqlDocument>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Consulta SQL", &["sql"])
        .set_title("Abrir consulta SQL")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "La selección no es un archivo local.".to_string())?;

    validate_sql_path(&path)?;
    let metadata =
        std::fs::metadata(&path).map_err(|error| format!("No se pudo leer el archivo: {error}"))?;

    if !metadata.is_file() {
        return Err("La selección no es un archivo regular.".to_string());
    }
    if metadata.len() > MAX_SQL_FILE_SIZE {
        return Err("El archivo SQL supera el límite de 10 MB.".to_string());
    }

    let contents = std::fs::read_to_string(&path)
        .map_err(|_| "El archivo SQL no contiene texto UTF-8 válido.".to_string())?;
    let saved = state.register(path, None)?;

    Ok(Some(SqlDocument {
        document_id: saved.document_id,
        file_name: saved.file_name,
        contents: contents
            .strip_prefix('\u{feff}')
            .unwrap_or(&contents)
            .to_string(),
    }))
}

#[tauri::command]
pub async fn save_sql_file(
    document_id: String,
    contents: String,
    state: State<'_, SqlFileState>,
) -> Result<SavedSqlDocument, String> {
    let path = state.path_for(&document_id)?;
    write_sql(&path, &contents)?;

    Ok(SavedSqlDocument {
        document_id,
        file_name: file_name(&path)?,
    })
}

#[tauri::command]
pub async fn save_sql_file_as(
    app: AppHandle,
    document_id: Option<String>,
    suggested_name: String,
    contents: String,
    state: State<'_, SqlFileState>,
) -> Result<Option<SavedSqlDocument>, String> {
    let suggested_name = sql_file_name(&suggested_name);
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Consulta SQL", &["sql"])
        .set_title("Guardar consulta SQL")
        .set_file_name(suggested_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = selected
        .into_path()
        .map_err(|_| "La selección no es una ruta local.".to_string())?;

    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("sql"))
    {
        path.set_extension("sql");
    }
    write_sql(&path, &contents)?;

    state.register(path, document_id).map(Some)
}

impl SqlFileState {
    fn register(
        &self,
        path: PathBuf,
        document_id: Option<String>,
    ) -> Result<SavedSqlDocument, String> {
        let document_id = document_id
            .unwrap_or_else(|| format!("sql-{}", self.next_id.fetch_add(1, Ordering::Relaxed)));
        let file_name = file_name(&path)?;
        self.paths
            .lock()
            .map_err(|_| "El estado de los archivos SQL quedó inconsistente.".to_string())?
            .insert(document_id.clone(), path);

        Ok(SavedSqlDocument {
            document_id,
            file_name,
        })
    }

    fn path_for(&self, document_id: &str) -> Result<PathBuf, String> {
        self.paths
            .lock()
            .map_err(|_| "El estado de los archivos SQL quedó inconsistente.".to_string())?
            .get(document_id)
            .cloned()
            .ok_or_else(|| "El archivo SQL ya no está disponible; usa Guardar como.".to_string())
    }
}

fn validate_sql_path(path: &Path) -> Result<(), String> {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("sql") => Ok(()),
        _ => Err("Solo se pueden abrir archivos con extensión .sql.".to_string()),
    }
}

fn write_sql(path: &Path, contents: &str) -> Result<(), String> {
    if contents.len() as u64 > MAX_SQL_FILE_SIZE {
        return Err("La consulta supera el límite de 10 MB.".to_string());
    }

    std::fs::write(path, contents)
        .map_err(|error| format!("No se pudo guardar el archivo SQL: {error}"))
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or_else(|| "El archivo no tiene un nombre válido.".to_string())
}

fn sql_file_name(value: &str) -> String {
    let trimmed = Path::new(value.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let base = if trimmed.is_empty() {
        "consulta"
    } else {
        trimmed
    };

    if base.to_lowercase().ends_with(".sql") {
        base.to_string()
    } else {
        format!("{base}.sql")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_suggested_file_names() {
        assert_eq!(sql_file_name("Query 1"), "Query 1.sql");
        assert_eq!(sql_file_name("ventas.SQL"), "ventas.SQL");
        assert_eq!(sql_file_name("../ventas.sql"), "ventas.sql");
        assert_eq!(sql_file_name("  "), "consulta.sql");
    }

    #[test]
    fn accepts_only_sql_extensions() {
        assert!(validate_sql_path(Path::new("consulta.sql")).is_ok());
        assert!(validate_sql_path(Path::new("consulta.SQL")).is_ok());
        assert!(validate_sql_path(Path::new("consulta.txt")).is_err());
    }
}
