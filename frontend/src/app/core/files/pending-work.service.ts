import { Injectable, inject } from '@angular/core';

import { DesktopHost } from '../application-gateway/desktop-host';

/**
 * Avisa antes de cerrar cuando hay trabajo que se perdería.
 *
 * Son dos cosas distintas. Una **transacción abierta**: al soltar la sesión, el
 * proceso local deshace lo que no esté confirmado, y eso puede ser el trabajo de
 * un buen rato. Y un **trabajo largo en marcha** —un respaldo, una restauración,
 * un traslado—: interrumpirlo deja un artefacto a medias o una base a medio
 * escribir.
 *
 * Existe por la misma razón que {@link FileSaveService}: **las dos formas de
 * ejecutar Druse cierran de manera distinta** y el resto de la aplicación no
 * debería enterarse. En el navegador el aviso lo da `beforeunload`; en la ventana
 * empaquetada eso no vale, porque quien cierra es el sistema y no el navegador,
 * así que se le dice al envoltorio y es él quien pregunta.
 */
@Injectable({ providedIn: 'root' })
export class PendingWorkService {
  private readonly _desktop = inject(DesktopHost);

  /** Escuchador vivo del navegador, o `null` si no hay nada que proteger. */
  private _guard: ((event: BeforeUnloadEvent) => void) | null = null;

  /** Si hay un trabajo largo en marcha, y por tanto algo que no interrumpir. */
  private _job: string | null = null;

  /** Declara si hay trabajo sin confirmar. */
  set(pending: boolean): void {
    this._transactions = pending;

    if (this._desktop.isDesktop) {
      // Si el envoltorio no responde no se puede hacer nada mejor: el aviso es
      // una cortesía, y romper por no poder darlo sería peor.
      void this._desktop.setTransactionPending(pending).catch(() => undefined);

      return;
    }

    this.guardBrowser();
  }

  /**
   * Declara qué trabajo largo hay en marcha, nombrado como se leerá en el aviso
   * —«un respaldo», «una restauración»—, o `null` si no hay ninguno.
   */
  setJob(label: string | null): void {
    this._job = label;

    if (this._desktop.isDesktop) {
      void this._desktop.setRunningJob(label).catch(() => undefined);

      return;
    }

    this.guardBrowser();
  }

  /** Si hay una transacción abierta con cambios sin confirmar. */
  private _transactions = false;

  /**
   * En el navegador solo se puede pedir que pregunte, y da igual por cuál de las
   * dos razones: el texto lo pone él.
   */
  private guardBrowser(): void {
    const pending = this._transactions || this._job !== null;

    if (pending === (this._guard !== null)) {
      return;
    }

    if (!pending) {
      window.removeEventListener('beforeunload', this._guard!);
      this._guard = null;

      return;
    }

    // El navegador enseña su propio texto: el de la página se ignora desde hace
    // años. Lo único que se puede pedir es que pregunte.
    this._guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener('beforeunload', this._guard);
  }
}
