import { HttpErrorResponse } from '@angular/common/http';

/**
 * Cómo se le cuenta al usuario lo que falló.
 *
 * Vivía dentro de `workspace-store.ts`, y salió de ahí al partir el almacén:
 * las piezas nuevas —sesiones, transacciones— necesitan las mismas palabras, y
 * duplicarlas era garantizar que un día dijeran cosas distintas del mismo error.
 */

/**
 * Qué decirle al usuario cuando algo falla.
 *
 * Nunca se muestra el objeto de error completo: puede traer cabeceras, cuerpos y
 * rutas internas que no aportan al usuario (plan §12).
 *
 * Y el número de un código HTTP tampoco significa nada para quien está
 * consultando una base de datos: «502» no dice qué pasó ni qué hacer. Cada caso
 * se cuenta con palabras y, cuando se puede, con el siguiente paso. El código se
 * conserva al final entre paréntesis, pequeño y sin protagonismo: no le sirve al
 * usuario, pero es lo primero que hace falta el día que tenga que contarle el
 * problema a alguien.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Druse encontró un problema inesperado. Si vuelve a ocurrir, reinicia la aplicación.';
  }

  const body = error.error;

  // Un fallo de validación sabe exactamente qué campo está mal, así que se
  // cuenta campo por campo en lugar de resumirlo en un código.
  const validation = validationMessages(body?.errors);

  if (validation.length > 0) {
    return `Revisa los datos enviados: ${validation.join(' ')}`;
  }

  // Cuando el servidor explica el motivo, se enseña tal cual: sus mensajes ya
  // están escritos para leerse, y son más concretos que cualquier traducción
  // que se pudiera hacer aquí a partir del código.
  const message = body?.message ?? body?.detail;

  if (typeof message === 'string' && message.trim().length > 0) {
    return message;
  }

  return `${explainStatus(error.status)} (${error.status})`;
}

/**
 * La consulta que el proceso local mandó con el rechazo, si mandó alguna.
 *
 * Hay negativas que no se arreglan leyéndolas: «hay filas que no cumplen la
 * condición» es verdad y no dice cuáles, y encontrarlas es escribir una consulta
 * a mano. Quien rechazó el cambio es el único que sabe qué miró, así que la
 * escribe él y la manda; aquí solo se recoge.
 *
 * Nunca se ejecuta sola: se le ofrece al usuario, que decide.
 */
export function diagnosticQuery(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }

  const query = error.error?.diagnostic;

  return typeof query === 'string' && query.trim().length > 0 ? query : null;
}

/**
 * El fallo es que la sesión ya no existe en el proceso local.
 *
 * Pasa más de lo que parece: el servidor cierra por inactividad, se cae la red,
 * el proceso de la API se reinicia. Distinguirlo de cualquier otro 404 es lo que
 * permite ofrecer «Reconectar» en vez de soltar un mensaje que no dice qué hacer.
 */
export function isSessionLost(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 404) {
    return false;
  }

  const message = error.error?.message;

  return typeof message === 'string' && message.includes('no está abierta');
}

/** Lo que significa cada código, dicho como se lo contarías a alguien. */
function explainStatus(status: number): string {
  switch (status) {
    // Angular usa el 0 cuando la petición ni siquiera llegó a salir.
    case 0:
      return 'Druse no obtuvo respuesta de su propio motor. Comprueba que la aplicación siga abierta y vuelve a intentarlo.';

    case 400:
      return 'La solicitud contiene datos incompletos o con un formato incorrecto.';

    case 401:
    case 403:
      return 'Esta ventana perdió el permiso para hablar con el motor de Druse. Cierra la aplicación y vuelve a abrirla.';

    case 404:
      return 'Eso ya no existe. Es probable que la conexión se haya cerrado; vuelve a abrirla y repite la operación.';

    case 408:
      return 'La operación tardó demasiado y se cortó. Prueba otra vez, o con menos datos.';

    case 409:
      return 'La operación no se aplicó porque algo había cambiado mientras tanto. Actualiza y vuelve a intentarlo.';

    case 413:
      return 'El archivo es demasiado grande para procesarlo de una vez.';

    case 428:
      return 'Falta una contraseña para abrir esta conexión.';

    case 500:
      return 'Algo falló dentro de Druse mientras atendía la petición. No se aplicó ningún cambio.';

    // 502, 503 y 504 significan lo mismo desde aquí: el proceso que hace el
    // trabajo no está atendiendo. Es lo que se ve si se cerró o si aún arranca.
    case 502:
    case 503:
    case 504:
      return 'El motor de Druse no está respondiendo: puede que se haya cerrado o que todavía esté arrancando. Espera unos segundos y, si sigue igual, reinicia la aplicación.';

    default:
      return status >= 500
        ? 'El motor de Druse falló al atender la petición.'
        : 'Druse no pudo completar la operación.';
  }
}

function validationMessages(errors: unknown): string[] {
  if (!errors || typeof errors !== 'object') {
    return [];
  }

  const messages = Object.entries(errors as Record<string, unknown>).flatMap(([field, value]) => {
    const known = validationFieldMessage(field);

    if (known) {
      return [known];
    }

    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((message): message is string => typeof message === 'string')
      .map((message) => {
        if (/required/i.test(message)) {
          return 'Falta un dato obligatorio.';
        }
        if (/could not be converted|invalid/i.test(message)) {
          return 'Uno de los valores tiene un formato incorrecto.';
        }

        return message;
      });
  });

  return [...new Set(messages)];
}

function validationFieldMessage(field: string): string | null {
  const normalized = field.toLowerCase();

  if (normalized.endsWith('.name')) {
    return 'El nombre de la conexión es obligatorio.';
  }
  if (normalized.endsWith('.host')) {
    return 'El servidor es obligatorio.';
  }
  if (normalized.endsWith('.port')) {
    return 'El puerto debe ser un número entre 1 y 65535.';
  }
  if (normalized.endsWith('.database')) {
    return 'La base de datos es obligatoria.';
  }
  if (normalized.endsWith('.username')) {
    return 'El usuario es obligatorio.';
  }

  return null;
}
