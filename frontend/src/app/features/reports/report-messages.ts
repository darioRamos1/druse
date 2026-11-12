import { I18nService } from '../../core/i18n/i18n.service';
import { ServerMessage } from '../../shared/models/workspace';

/**
 * Lo que dice el proceso local de Reportes, en el idioma de la ventana.
 *
 * Los motivos que escribe Druse —una unión con tipos distintos, un intento
 * interrumpido— llegan con su clave y se traducen aquí. Lo que escribe el
 * motor llega sin clave y se enseña tal cual, como en el editor. Un intento
 * guardado antes del hito 6 tampoco la trae: se enseña con su texto.
 */
export function serverText(
  i18n: I18nService,
  localized: ServerMessage | null | undefined,
  fallback: string | null,
): string | null {
  if (localized && i18n.has(localized.key)) {
    return i18n.t(localized.key, { ...(localized.args ?? {}) });
  }

  return localized?.text ?? fallback;
}

/**
 * Por qué no se pudo leer una fuente: por su código si Druse lo conoce, con
 * su clave si es un motivo de Druse, y con las palabras del motor si no.
 */
export function failureText(
  i18n: I18nService,
  code: string | null,
  message: string | null,
  localized?: ServerMessage | null,
): string {
  if (localized && i18n.has(localized.key)) {
    return serverText(i18n, localized, message) ?? '';
  }

  // i18n-keys: reports.failure.*
  const key = `reports.failure.${code ?? 'unknown'}`;
  const known = i18n.t(key);

  // El motor ya explica su error en su idioma; los demás códigos se traducen.
  return code === 'database-error' || code === 'invalid-query' || known === key ? (message ?? known) : known;
}
