use std::sync::Mutex;

use tauri::State;

/// Si el usuario tiene alguna transacción abierta sin confirmar.
///
/// Lo sabe la interfaz, que es quien habla con la API, pero **quien recibe la
/// petición de cerrar la ventana es el envoltorio**. Sin este estado compartido,
/// cerrar Druse con una hora de trabajo sin confirmar lo tiraría sin preguntar:
/// al soltar la sesión, el proceso local deshace lo que quede abierto.
///
/// No se guarda qué transacción ni de qué conexión: aquí solo hace falta saber si
/// hay algo que perder. El detalle lo enseña la interfaz, que sí lo tiene.
#[derive(Default)]
pub struct PendingTransactions(pub Mutex<bool>);

/// La interfaz declara si hay trabajo sin confirmar.
///
/// Se llama en cada cambio y no solo al cerrar: preguntárselo a la ventana web
/// en el momento del cierre obligaría a esperar una respuesta asíncrona dentro
/// del bucle de eventos, que es justo donde no se puede esperar.
#[tauri::command]
pub fn set_transaction_pending(state: State<'_, PendingTransactions>, pending: bool) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = pending;
    }
}

/// Hay trabajo sin confirmar que se perdería al cerrar.
pub fn has_pending(state: &PendingTransactions) -> bool {
    // Si el candado quedó envenenado, se responde que no hay nada pendiente: un
    // aviso que aparece siempre acabaría cerrándose sin leer, y el bloqueo de la
    // ventana sería peor que el riesgo que intenta evitar.
    state.0.lock().map(|guard| *guard).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_transacciones_no_se_pregunta_al_cerrar() {
        assert!(!has_pending(&PendingTransactions::default()));
    }

    #[test]
    fn con_una_transaccion_abierta_hay_algo_que_perder() {
        let state = PendingTransactions::default();
        *state.0.lock().unwrap() = true;

        assert!(has_pending(&state));
    }
}
