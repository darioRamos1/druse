import { HttpErrorResponse } from '@angular/common/http';

import { I18nService } from '../i18n/i18n.service';

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
export function describeError(error: unknown, i18n: I18nService): string {
  if (!(error instanceof HttpErrorResponse)) {
    return i18n.t('error.unexpected');
  }

  const body = error.error;

  // Un fallo de validación sabe exactamente qué campo está mal, así que se
  // cuenta campo por campo en lugar de resumirlo en un código.
  const validation = validationMessages(body?.errors, i18n);

  if (validation.length > 0) {
    return i18n.t('error.validation', { details: validation.join(' ') });
  }

  // Cuando el servidor explica el motivo, se enseña tal cual: sus mensajes ya
  // están escritos para leerse, y son más concretos que cualquier traducción
  // que se pudiera hacer aquí a partir del código.
  const message = body?.message ?? body?.detail;

  if (typeof message === 'string' && message.trim().length > 0) {
    return message;
  }

  return i18n.t('error.withStatus', {
    message: explainStatus(error.status, i18n),
    status: error.status,
  });
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
function explainStatus(status: number, i18n: I18nService): string {
  switch (status) {
    // Angular usa el 0 cuando la petición ni siquiera llegó a salir.
    case 0:
      return 'Druse no obtuvo respuesta de su propio motor. Comprueba que la aplicación siga abierta y vuelve a intentarlo.';

    case 400:
      return i18n.t('error.status.400');

    case 401:
    case 403:
      return i18n.t('error.status.401');

    case 404:
      return i18n.t('error.status.404');

    case 408:
      return i18n.t('error.status.408');

    case 409:
      return i18n.t('error.status.409');

    case 413:
      return i18n.t('error.status.413');

    case 428:
      return i18n.t('error.status.428');

    case 500:
      return i18n.t('error.status.500');

    // 502, 503 y 504 significan lo mismo desde aquí: el proceso que hace el
    // trabajo no está atendiendo. Es lo que se ve si se cerró o si aún arranca.
    case 502:
    case 503:
    case 504:
      return i18n.t('error.status.502');

    default:
      return i18n.t(status >= 500 ? 'error.status.server' : 'error.status.other');
  }
}

function validationMessages(errors: unknown, i18n: I18nService): string[] {
  if (!errors || typeof errors !== 'object') {
    return [];
  }

  const messages = Object.entries(errors as Record<string, unknown>).flatMap(([field, value]) => {
    const known = validationFieldMessage(field, i18n);

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
          return i18n.t('error.field.required');
        }
        if (/could not be converted|invalid/i.test(message)) {
          return i18n.t('error.field.format');
        }

        return message;
      });
  });

  return [...new Set(messages)];
}

function validationFieldMessage(field: string, i18n: I18nService): string | null {
  const normalized = field.toLowerCase();

  if (normalized.endsWith('.name')) {
    return i18n.t('error.field.name');
  }
  if (normalized.endsWith('.host')) {
    return i18n.t('error.field.host');
  }
  if (normalized.endsWith('.port')) {
    return i18n.t('error.field.port');
  }
  if (normalized.endsWith('.database')) {
    return i18n.t('error.field.database');
  }
  if (normalized.endsWith('.username')) {
    return i18n.t('error.field.username');
  }

  return null;
}
