import { Injectable, signal } from '@angular/core';

import { releaseNoteFor } from './release-notes';

/** Cómo se guarda la última versión cuyas novedades se enseñaron. */
export const WHATS_NEW_PREFERENCE = 'whatsNew.lastSeen';

/**
 * Recuerda qué novedades se han visto ya.
 *
 * Como `UpdateService`, no guarda nada por su cuenta: lo leído llega con las
 * preferencias del arranque y quien escribe es el área de trabajo, que ya tiene
 * el gateway.
 */
@Injectable({ providedIn: 'root' })
export class WhatsNewService {
  /** `undefined` hasta leer las preferencias; `null` si nunca se enseñaron. */
  readonly lastSeen = signal<string | null | undefined>(undefined);

  adopt(preferences: Readonly<Record<string, string>>): void {
    this.lastSeen.set(preferences[WHATS_NEW_PREFERENCE] || null);
  }

  /**
   * Si hay que enseñar las novedades de la versión que está abierta.
   *
   * También la primera vez que se abre con esta función, sin nada guardado: a
   * quien viene de una versión anterior es justo cuando más le sirven, y a quien
   * acaba de instalar le cuenta lo último una sola vez.
   */
  shouldShow(version: string): boolean {
    const lastSeen = this.lastSeen();

    return lastSeen !== undefined && lastSeen !== version && releaseNoteFor(version) !== null;
  }
}
