import { Injectable, inject } from '@angular/core';

import { DesktopHost } from '../application-gateway/desktop-host';

export interface ChosenBackground {
  readonly name: string;
  /** La imagen ya lista para pintar, como `data:`. */
  readonly source: string;
}

/** Tope de la imagen de fondo. Por encima, el arranque empieza a notarse. */
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

/** Dónde la guarda el navegador, que no tiene carpeta de datos donde dejarla. */
const BROWSER_KEY = 'druse.editorBackground';

/**
 * Dónde vive la imagen de fondo del editor.
 *
 * Existe por la misma razón que el servicio de archivos SQL: **las dos formas de
 * ejecutar Druse guardan de manera distinta** y el resto de la aplicación no
 * debería enterarse. Empaquetada, la imagen se copia a la carpeta de datos de la
 * aplicación y el envoltorio la devuelve leída; en el navegador no hay tal
 * carpeta, así que se queda en el almacenamiento local.
 *
 * En ninguno de los dos casos viaja a las preferencias. Son texto en una base
 * que se lee entera en cada arranque: meterle unos megabytes en base64 haría
 * lento algo que hoy es instantáneo.
 */
@Injectable({ providedIn: 'root' })
export class EditorBackgroundStore {
  private readonly _desktop = inject(DesktopHost);

  async choose(): Promise<ChosenBackground | null> {
    if (this._desktop.isDesktop) {
      return this._desktop.chooseEditorBackground();
    }

    const chosen = await this.chooseInBrowser();

    if (chosen) {
      try {
        localStorage.setItem(BROWSER_KEY, JSON.stringify(chosen));
      } catch {
        // No cabe en el almacenamiento del navegador. La imagen se ve en esta
        // sesión y se pierde al recargar; es preferible a rechazarla, porque
        // fuera del paquete esto es un entorno de desarrollo.
      }
    }

    return chosen;
  }

  /** La imagen guardada, ya lista para pintar. */
  async load(): Promise<string | null> {
    if (this._desktop.isDesktop) {
      return this._desktop.readEditorBackground();
    }

    try {
      const raw = localStorage.getItem(BROWSER_KEY);

      return raw ? ((JSON.parse(raw) as ChosenBackground).source ?? null) : null;
    } catch {
      return null;
    }
  }

  async forget(): Promise<void> {
    if (this._desktop.isDesktop) {
      await this._desktop.clearEditorBackground();
      return;
    }

    try {
      localStorage.removeItem(BROWSER_KEY);
    } catch {
      // Si no se puede borrar, tampoco se pudo guardar.
    }
  }

  private chooseInBrowser(): Promise<ChosenBackground | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/gif';
      input.hidden = true;
      document.body.append(input);

      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0];
          input.remove();

          if (!file) {
            resolve(null);
            return;
          }

          if (file.size > MAX_BACKGROUND_BYTES) {
            reject(new Error('La imagen supera el límite de 8 MB.'));
            return;
          }

          const reader = new FileReader();
          reader.addEventListener('load', () =>
            resolve({ name: file.name, source: String(reader.result) }),
          );
          reader.addEventListener('error', () => reject(new Error('No se pudo leer la imagen.')));
          reader.readAsDataURL(file);
        },
        { once: true },
      );

      input.click();
    });
  }
}
