use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;

use crate::pending_work::{self, Blocker, PendingWork};
use crate::ApiState;

const UPDATE_ENDPOINT: &str =
    "https://github.com/darioRamos1/druse/releases/latest/download/latest.json";
const VARIANT: &str = match option_env!("DRUSE_VARIANT") {
    Some(variant) => variant,
    None => "completo",
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    variant: &'static str,
    variant_label: &'static str,
    updates_enabled: bool,
    updates_disabled_reason: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
enum UpdateProgress {
    Started { total: Option<u64> },
    Progress { downloaded: u64 },
    Finished,
}

fn variant_label() -> &'static str {
    match VARIANT {
        "completo" => "Completa (incluye Informix)",
        "sin-informix" => "Sin Informix",
        "comunidad" => "Comunidad (sin Oracle ni Informix)",
        _ => "Desconocida",
    }
}

fn updater_target() -> Result<String, String> {
    if !matches!(VARIANT, "completo" | "sin-informix" | "comunidad") {
        return Err(format!("La variante de Druse no es válida: {VARIANT}."));
    }

    let target = tauri_plugin_updater::target()
        .ok_or_else(|| "Esta distribución no admite actualizaciones automáticas.".to_string())?;

    Ok(format!("{target}-{VARIANT}"))
}

fn disabled_reason() -> Option<&'static str> {
    if !matches!(VARIANT, "completo" | "sin-informix" | "comunidad") {
        return Some("La aplicación no identifica correctamente su variante.");
    }

    if tauri::utils::platform::bundle_type().is_none() {
        return Some("La distribución portable se actualiza descargando una nueva copia.");
    }

    if !cfg!(target_os = "windows") {
        return Some("Las actualizaciones automáticas están disponibles en Windows.");
    }

    if tauri_plugin_updater::target().is_none() {
        return Some("Esta plataforma no admite actualizaciones automáticas.");
    }

    None
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let reason = disabled_reason();

    AppInfo {
        version: app.package_info().version.to_string(),
        variant: VARIANT,
        variant_label: variant_label(),
        updates_enabled: reason.is_none(),
        updates_disabled_reason: reason,
    }
}

fn updater_builder(app: &AppHandle) -> Result<tauri_plugin_updater::UpdaterBuilder, String> {
    let endpoint = UPDATE_ENDPOINT
        .parse()
        .map_err(|error| format!("La dirección de actualizaciones no es válida: {error}"))?;

    let builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?;

    Ok(builder
        .target(updater_target()?)
        .timeout(std::time::Duration::from_secs(30)))
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<AvailableUpdate>, String> {
    if let Some(reason) = disabled_reason() {
        return Err(reason.to_string());
    }

    let update = updater_builder(&app)?
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    Ok(update.map(|update| AvailableUpdate {
        version: update.version,
        notes: update.body,
        date: update.date.map(|date| date.to_string()),
    }))
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    pending: State<'_, PendingWork>,
) -> Result<(), String> {
    // Actualizar cierra Druse para reemplazarlo, así que vale lo mismo que al
    // cerrar la ventana: un respaldo a medias se queda a medias, y una
    // transacción sin confirmar la deshace el servidor. La diferencia es que
    // aquí no se pregunta —se dice que no— porque instalar puede esperar.
    if let Some(blocker) = pending_work::blocker(&pending) {
        return Err(match blocker {
            Blocker::Job(job) => format!(
                "Druse está haciendo {job}. Espera a que termine o cancélalo antes de actualizar."
            ),
            Blocker::Transaction => {
                "Confirma o deshaz las transacciones abiertas antes de actualizar Druse."
                    .to_string()
            }
        });
    }

    let api_app = app.clone();
    let update = updater_builder(&app)?
        .on_before_exit(move || {
            if let Some(state) = api_app.try_state::<ApiState>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(process) = guard.as_mut() {
                        process.stop();
                    }
                }
            }

            api_app.cleanup_before_exit();
        })
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Ya tienes la versión más reciente de Druse.".to_string())?;

    let progress_app = app.clone();
    let mut downloaded = 0_u64;
    let mut started = false;

    let bytes = update
        .download(
            move |chunk_length, total| {
                if !started {
                    started = true;
                    let _ = progress_app
                        .emit("druse://update-progress", UpdateProgress::Started { total });
                }

                downloaded += chunk_length as u64;
                let _ = progress_app.emit(
                    "druse://update-progress",
                    UpdateProgress::Progress { downloaded },
                );
            },
            {
                let app = app.clone();
                move || {
                    let _ = app.emit("druse://update-progress", UpdateProgress::Finished);
                }
            },
        )
        .await
        .map_err(|error| error.to_string())?;

    // La descarga puede durar minutos. Se comprueba otra vez porque durante ese
    // tiempo el usuario ha podido abrir una transacción o lanzar un respaldo.
    if let Some(blocker) = pending_work::blocker(&pending) {
        return Err(match blocker {
            Blocker::Job(job) => format!(
                "La actualización se descargó, pero Druse está haciendo {job}. Espera a que \
                 termine y vuelve a intentarlo."
            ),
            Blocker::Transaction => {
                "La actualización se descargó, pero hay transacciones abiertas. Confírmalas o \
                 deshazlas y vuelve a intentarlo."
                    .to_string()
            }
        });
    }

    // `install` prepara primero el ejecutable temporal y solo después ejecuta el
    // hook que detiene la API. Esta comprobación evita llegar al hook con un
    // estado que no se pueda bloquear o sin proceso que cerrar.
    {
        let state = app
            .try_state::<ApiState>()
            .ok_or_else(|| "No se pudo acceder al proceso local de Druse.".to_string())?;
        let api = state
            .0
            .lock()
            .map_err(|_| "El estado de la API quedó inconsistente.".to_string())?;

        if api.is_none() {
            return Err("La API local de Druse no está disponible.".to_string());
        }
    }

    update.install(bytes).map_err(|error| error.to_string())?;

    #[cfg(not(target_os = "windows"))]
    app.restart();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_variante_compilada_es_conocida() {
        assert!(matches!(VARIANT, "completo" | "sin-informix" | "comunidad"));
        assert_ne!(variant_label(), "Desconocida");
    }

    #[test]
    fn el_endpoint_de_publicacion_es_https() {
        assert!(UPDATE_ENDPOINT.starts_with("https://"));
    }

    /// El canal de actualización lleva la edición dentro, y eso es lo que impide
    /// que una instalación sin Informix reciba la completa.
    ///
    /// Las dos comparten `latest.json`: lo único que las separa es la clave que
    /// cada una pide dentro de ese archivo. Si el sufijo se perdiera, ambas
    /// pedirían `windows-x86_64` y la que sale sobrando son 111 MB de
    /// controlador de IBM que alguien decidió no instalar.
    #[test]
    fn el_canal_de_actualizacion_lleva_la_edicion() {
        let Some(plataforma) = tauri_plugin_updater::target() else {
            // En una plataforma sin actualizador no hay canal que comprobar, y
            // `updater_target` ya contesta con un error explicando por qué.
            assert!(updater_target().is_err());
            return;
        };

        let objetivo = updater_target().expect("la variante compilada es válida");

        assert_eq!(objetivo, format!("{plataforma}-{VARIANT}"));
        assert!(objetivo.ends_with(&format!("-{VARIANT}")));

        // El nombre exacto es el contrato con `release.ps1`, que escribe estas
        // mismas claves en `latest.json`. Cambiarlo en un solo sitio deja a los
        // instalados sin actualizaciones, sin ningún error visible.
        if cfg!(target_os = "windows") {
            assert!(matches!(
                objetivo.as_str(),
                "windows-x86_64-completo"
                    | "windows-x86_64-sin-informix"
                    | "windows-x86_64-comunidad"
            ));
        }
    }

    #[test]
    fn la_clave_publica_no_es_un_marcador() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json debe ser JSON válido");
        let key = config["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("falta la clave pública del actualizador");

        assert!(key.len() > 100);
        assert!(!key.contains("REEMPLAZAR"));
    }
}
