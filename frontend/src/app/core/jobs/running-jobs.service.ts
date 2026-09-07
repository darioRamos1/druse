import { Injectable, computed, effect, inject } from '@angular/core';

import { BackupStore } from '../backup/backup.store';
import { RestoreStore } from '../backup/restore.store';
import { DesktopHost } from '../application-gateway/desktop-host';
import { PendingWorkService } from '../files/pending-work.service';
import { TransferStore } from '../transfer/transfer.store';

/** Cada cuánto se mira si el trabajo cancelado ya paró. */
const POLL_MS = 200;

/**
 * Cuánto se espera a que la API confirme la cancelación antes de rendirse.
 *
 * Cancelar no es instantáneo: la petición se acepta y el trabajo para en cuanto
 * puede soltar lo que tenga entre manos —una tabla de tres millones de filas
 * termina su lote—. Pasado el plazo no se cierra: cerrar entonces sería
 * exactamente lo que el aviso quería evitar.
 */
const CANCEL_TIMEOUT_MS = 30_000;

/**
 * Lo que está en marcha y no se puede interrumpir sin consecuencias.
 *
 * Existe porque **quien recibe la petición de cerrar la ventana es el
 * envoltorio**, y allí no se sabe nada de respaldos: lo declara la interfaz, que
 * sí lo sabe, en cuanto cambia. Es lo mismo que ya se hacía con las
 * transacciones abiertas.
 *
 * La otra mitad es responder cuando el usuario decide cerrar de todos modos: se
 * cancela lo que haya, **se espera a que la API lo confirme** y solo entonces se
 * deja cerrar. Sin esa espera, el trabajo seguiría corriendo dentro de un
 * proceso que se está muriendo.
 */
@Injectable({ providedIn: 'root' })
export class RunningJobsService {
  private readonly _backups = inject(BackupStore);
  private readonly _restores = inject(RestoreStore);
  private readonly _transfers = inject(TransferStore);
  private readonly _pendingWork = inject(PendingWorkService);
  private readonly _desktop = inject(DesktopHost);

  /**
   * Cómo se llama en el aviso lo que está en marcha, o `null` si no hay nada.
   *
   * Se nombra en la forma en que va a leerse dentro de la frase —«Druse está
   * haciendo un respaldo»—, porque el envoltorio la escribe tal cual.
   */
  readonly label = computed(() => {
    if (this._backups.running()) {
      return 'un respaldo';
    }

    if (this._restores.running()) {
      return 'una restauración';
    }

    if (this._transfers.running()) {
      return 'un traslado de datos';
    }

    return null;
  });

  /** Si no se pudo parar a tiempo, para poder decirlo. */
  private _timedOut = false;

  get timedOut(): boolean {
    return this._timedOut;
  }

  constructor() {
    effect(() => this._pendingWork.setJob(this.label()));

    // Si el envoltorio no está —en el navegador— no hay nada que escuchar, y la
    // promesa se resuelve con un desuscriptor que no hace nada.
    void this._desktop.listenForCancelAndClose(() => {
      void this.cancelAndClose();
    });
  }

  /**
   * Para lo que haya en marcha y, cuando la API lo confirma, deja cerrar.
   *
   * Se cancelan los tres a la vez y no en cadena: son trabajos independientes, y
   * esperar a que uno confirme para pedir el siguiente sumaría las esperas justo
   * cuando el usuario está intentando cerrar.
   */
  async cancelAndClose(): Promise<void> {
    this._timedOut = false;

    await Promise.all([
      this._backups.running() ? this._backups.cancel() : Promise.resolve(),
      this._restores.running() ? this._restores.cancel() : Promise.resolve(),
      this._transfers.running() ? this._transfers.cancel() : Promise.resolve(),
    ]);

    const deadline = Date.now() + CANCEL_TIMEOUT_MS;

    while (this.label() !== null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }

    if (this.label() !== null) {
      // No se cierra. El trabajo sigue vivo y la barra de estado lo enseña; el
      // usuario puede volver a intentarlo.
      this._timedOut = true;

      return;
    }

    await this._desktop.confirmClose();
  }
}
