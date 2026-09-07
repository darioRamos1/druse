//! Lo que se perdería al cerrar la ventana, y por eso se pregunta antes.
//!
//! Son dos cosas distintas y las dos las conoce **la interfaz**, que es quien
//! habla con la API; pero **quien recibe la petición de cerrar es el
//! envoltorio**, y para entonces preguntarle a la página ya sería tarde: el
//! aviso tendría que esperar una respuesta asíncrona dentro del bucle de
//! eventos, que es justo donde no se puede esperar. Así que la interfaz lo
//! declara en cuanto cambia y aquí solo se lee.
//!
//! No se guarda el detalle —qué transacción, de qué conexión, cuántas filas
//! lleva el respaldo—: aquí solo hace falta saber si hay algo que perder y cómo
//! llamarlo en el aviso.

use std::sync::Mutex;

use tauri::{Emitter, Manager, State, WebviewWindow, Window};

/// Evento con el que se le pide a la interfaz que pare lo que esté haciendo.
pub const CANCEL_AND_CLOSE_EVENT: &str = "druse://cancel-and-close";

/// Lo que hay abierto ahora mismo.
#[derive(Default, Clone)]
struct Estado {
    /// Hay una transacción abierta con cambios sin confirmar.
    transactions: bool,

    /// Trabajo largo en marcha, nombrado como se dirá en el aviso: «un
    /// respaldo», «una restauración», «un traslado de datos».
    job: Option<String>,
}

#[derive(Default)]
pub struct PendingWork(Mutex<Estado>);

/// Por qué no se puede cerrar sin preguntar.
#[derive(Debug, PartialEq, Eq)]
pub enum Blocker {
    /// Hay un trabajo largo escribiendo en algún sitio.
    Job(String),

    /// Hay cambios sin confirmar que el servidor deshará al soltar la sesión.
    Transaction,
}

/// La interfaz declara si hay trabajo sin confirmar.
#[tauri::command]
pub fn set_transaction_pending(state: State<'_, PendingWork>, pending: bool) {
    if let Ok(mut guard) = state.0.lock() {
        guard.transactions = pending;
    }
}

/// La interfaz declara qué trabajo largo hay en marcha, o ninguno.
///
/// Se llama con el nombre que va a leerse en el aviso, no con un identificador:
/// el envoltorio no sabe de respaldos ni de traslados, y no tiene por qué.
#[tauri::command]
pub fn set_running_job(state: State<'_, PendingWork>, label: Option<String>) {
    if let Ok(mut guard) = state.0.lock() {
        guard.job = label.filter(|texto| !texto.trim().is_empty());
    }
}

/// La interfaz confirma que ya se puede cerrar: paró lo que estaba haciendo.
///
/// Es la segunda mitad de [`CANCEL_AND_CLOSE_EVENT`]. Se limpia el estado antes
/// de destruir la ventana para que el aviso no vuelva a salir con lo que ya no
/// existe.
#[tauri::command]
pub fn confirm_close(window: WebviewWindow) {
    if let Some(state) = window.try_state::<PendingWork>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Estado::default();
        }
    }

    let _ = window.destroy();
}

/// Qué impide cerrar ahora mismo, si algo lo impide.
///
/// El trabajo largo manda sobre la transacción cuando están los dos: interrumpir
/// un respaldo a medias deja un archivo que no sirve, y encima es lo que el
/// usuario está mirando.
pub fn blocker(state: &PendingWork) -> Option<Blocker> {
    // Si el candado quedó envenenado, se responde que no hay nada pendiente: un
    // aviso que aparece siempre acabaría cerrándose sin leer, y una ventana que
    // no se puede cerrar sería peor que el riesgo que intenta evitar.
    let estado = state.0.lock().ok()?.clone();

    if let Some(job) = estado.job {
        return Some(Blocker::Job(job));
    }

    if estado.transactions {
        return Some(Blocker::Transaction);
    }

    None
}

/// El texto del aviso, según lo que haya en marcha.
///
/// Devuelve el título, el cuerpo y cómo se llama el botón que sigue adelante.
/// Están juntos a propósito: los tres tienen que hablar de lo mismo, y separados
/// es como se acaba con un botón «Cerrar y perderlos» debajo de un aviso que
/// hablaba de un respaldo.
pub fn warning(blocker: &Blocker) -> (String, String, String) {
    match blocker {
        Blocker::Job(job) => (
            "Hay trabajo en marcha".to_string(),
            format!(
                "Druse está haciendo {job}. Si cierras ahora se interrumpirá y lo que haya \
                 escrito quedará a medias."
            ),
            "Cancelarlo y cerrar".to_string(),
        ),
        Blocker::Transaction => (
            "Cambios sin confirmar".to_string(),
            "Hay una transacción abierta con cambios sin confirmar. Si cierras Druse ahora, \
             se perderán."
                .to_string(),
            "Cerrar y perderlos".to_string(),
        ),
    }
}

/// Le pide a la interfaz que pare lo que hay en marcha y avise cuando se pueda
/// cerrar.
///
/// No se destruye la ventana aquí: cancelar un respaldo es una petición a la API
/// que tarda en confirmarse, y cerrar sin esperarla dejaría el trabajo corriendo
/// en un proceso que se está muriendo. Quien avisa de que ya está es
/// [`confirm_close`].
pub fn ask_to_cancel(window: &Window) {
    let _ = window.emit(CANCEL_AND_CLOSE_EVENT, ());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn con(estado: Estado) -> PendingWork {
        PendingWork(Mutex::new(estado))
    }

    #[test]
    fn sin_nada_abierto_no_se_pregunta_al_cerrar() {
        assert_eq!(blocker(&PendingWork::default()), None);
    }

    #[test]
    fn con_una_transaccion_abierta_hay_algo_que_perder() {
        let estado = Estado {
            transactions: true,
            job: None,
        };

        assert_eq!(blocker(&con(estado)), Some(Blocker::Transaction));
    }

    #[test]
    fn con_un_respaldo_en_marcha_se_avisa_de_el() {
        let estado = Estado {
            transactions: false,
            job: Some("un respaldo".to_string()),
        };

        assert_eq!(
            blocker(&con(estado)),
            Some(Blocker::Job("un respaldo".to_string()))
        );
    }

    /// Interrumpir un respaldo deja un archivo que no sirve; una transacción sin
    /// confirmar se deshace y ya está. Con los dos, el aviso habla del respaldo.
    #[test]
    fn el_trabajo_en_marcha_manda_sobre_la_transaccion() {
        let estado = Estado {
            transactions: true,
            job: Some("una restauración".to_string()),
        };

        assert_eq!(
            blocker(&con(estado)),
            Some(Blocker::Job("una restauración".to_string()))
        );
    }

    /// Un nombre vacío es «no hay nada»: si llegara tal cual, el aviso diría
    /// «Druse está haciendo .» y no dejaría cerrar.
    #[test]
    fn un_nombre_en_blanco_no_cuenta_como_trabajo() {
        let estado = Estado {
            transactions: false,
            job: Some("   ".to_string()),
        };

        let state = con(estado);

        // Se pasa por el mismo filtro que el comando.
        if let Ok(mut guard) = state.0.lock() {
            guard.job = guard.job.clone().filter(|texto| !texto.trim().is_empty());
        }

        assert_eq!(blocker(&state), None);
    }

    #[test]
    fn el_aviso_de_un_trabajo_nombra_lo_que_se_interrumpe() {
        let (titulo, cuerpo, boton) = warning(&Blocker::Job("un respaldo".to_string()));

        assert_eq!(titulo, "Hay trabajo en marcha");
        assert!(cuerpo.contains("un respaldo"));
        assert_eq!(boton, "Cancelarlo y cerrar");
    }
}
