import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';

/**
 * Qué paleta se está pintando.
 *
 * Solo dos, y ninguno significa «lo que diga el sistema»: la aplicación es de
 * escritorio y vive abierta horas, así que un tema que cambia solo al anochecer
 * es una interrupción, no una comodidad.
 */
export type ThemeName = 'dark' | 'light';

/** El del mockup. Lo que se ve si nadie ha elegido nunca. */
export const DEFAULT_THEME: ThemeName = 'dark';

/** Cómo se guarda en la base local. Es el contrato con las preferencias. */
export const THEME_PREFERENCE = 'ui.theme';

/**
 * Dónde se copia en el navegador.
 *
 * La preferencia de verdad vive en el servidor, pero llega por HTTP y eso es
 * tarde: para entonces ya se ha pintado la primera ventana. Esta copia es lo
 * único que hay disponible antes del primer fotograma.
 */
const THEME_CACHE_KEY = 'druse.theme';

/** Recompone un tema a partir de lo que se guardó; lo que no se reconozca, oscuro. */
export function parseTheme(value: string | null | undefined): ThemeName {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}

/**
 * Escribe el atributo del que cuelga toda la paleta.
 *
 * Va en `<html>` y no en el cuerpo de la aplicación porque el fondo de la
 * página y el color de las barras de desplazamiento se resuelven ahí arriba,
 * fuera de cualquier componente de Angular.
 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset['theme'] = theme;
}

/**
 * El tema recordado en esta máquina.
 *
 * Se consulta antes de arrancar Angular. `localStorage` puede fallar —un WebView
 * sin almacenamiento, un navegador con las cookies cerradas—, y quedarse sin
 * tema recordado no puede impedir que la aplicación abra.
 */
export function cachedTheme(): ThemeName {
  try {
    return parseTheme(localStorage.getItem(THEME_CACHE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function remember(theme: ThemeName): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // Sin copia local solo se pierde el arranque sin parpadeo, no el ajuste.
  }
}

/**
 * Qué tema se ve, y cómo se recuerda.
 *
 * La preferencia se guarda en el servidor como las demás, para que acompañe al
 * usuario y no al navegador. La copia en `localStorage` no es la fuente: solo
 * evita que la aplicación abra en oscuro y salte a claro medio segundo después,
 * que es lo que pasaría esperando a la respuesta de la API.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _gateway = inject(ApplicationGateway);

  private readonly _theme = signal<ThemeName>(cachedTheme());
  readonly theme = this._theme.asReadonly();

  constructor() {
    // Normalmente ya lo aplicó el arranque. Repetirlo aquí cubre el caso de que
    // el servicio se cree en otro contexto —una prueba, otro punto de entrada—
    // sin que el atributo llegue a escribirse nunca.
    applyTheme(this._theme());
  }

  /**
   * Adopta el tema que venía en las preferencias del servidor.
   *
   * Recibe el mapa entero en lugar de pedirlo él mismo para no repetir la
   * llamada que el área de trabajo ya hace al arrancar.
   */
  adopt(preferences: Readonly<Record<string, string>>): void {
    this.apply(parseTheme(preferences[THEME_PREFERENCE]));
  }

  async set(theme: ThemeName): Promise<void> {
    if (theme === this._theme()) {
      return;
    }

    this.apply(theme);

    try {
      await firstValueFrom(this._gateway.setPreference(THEME_PREFERENCE, theme));
    } catch {
      // El tema ya está puesto y recordado en esta máquina. No poder guardarlo
      // en el servidor no justifica sacar un aviso por un cambio de color.
    }
  }

  /** Alterna entre los dos, para el atajo y el conmutador de la barra. */
  toggle(): Promise<void> {
    return this.set(this._theme() === 'dark' ? 'light' : 'dark');
  }

  private apply(theme: ThemeName): void {
    this._theme.set(theme);
    applyTheme(theme);
    remember(theme);
  }
}
