import { signal } from '@angular/core';

/**
 * Números, fechas y orden alfabético en el idioma elegido.
 *
 * Son funciones y no un servicio porque se usan también desde funciones puras
 * —el trazado del diagrama, las insignias del explorador— donde no hay a quién
 * inyectarle nada. Leen una señal, así que un `computed` que formatea se
 * rehace solo al cambiar de idioma.
 *
 * **Nadie más escribe el idioma a mano.** Había `'es'` fijo en nueve sitios, y
 * cada uno habría seguido en español con la interfaz en otro idioma. Una prueba
 * de arquitectura falla si vuelve a aparecer.
 */
const current = signal('es');

/** Lo pone `I18nService` al arrancar y al cambiar de idioma. */
export function setFormatLocale(locale: string): void {
  current.set(locale);
}

/** El idioma de formato en uso. */
export function formatLocale(): string {
  return current();
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(current(), options).format(value);
}

export function formatDate(
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(current(), options).format(
    typeof value === 'string' ? new Date(value) : value,
  );
}

/** «hace 3 minutos», «en 2 días». */
export function formatRelative(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(current(), { numeric: 'auto' }).format(value, unit);
}

const collators = new Map<string, Intl.Collator>();

/** Compara dos textos como los ordenaría una persona que habla el idioma. */
export function compareText(a: string, b: string): number {
  const locale = current();
  let collator = collators.get(locale);

  if (!collator) {
    collator = new Intl.Collator(locale);
    collators.set(locale, collator);
  }

  return collator.compare(a, b);
}
