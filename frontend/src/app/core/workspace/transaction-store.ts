import { Injectable, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import { ApplicationGateway, TransactionState } from '../application-gateway/application-gateway';
import { PendingWorkService } from '../files/pending-work.service';
import { NoticeStore } from './notice-store';

/**
 * Cada cuánto se vuelve a preguntar por una transacción abierta.
 *
 * Medio minuto: lo bastante seguido para que el indicador no mienta mucho rato
 * después de que el proceso local la deshaga por inactividad, y lo bastante
 * espaciado para que no sea una petición constante contra la API.
 */
const TRANSACTION_WATCH_MS = 30_000;

/**
 * Lo último que se supo de la transacción de una conexión, con la sesión por la
 * que se preguntó.
 *
 * La sesión se guarda aquí y no se busca en el registro de conexiones a propósito:
 * es lo único que el reloj necesita de fuera, y guardarla deja a esta pieza
 * capaz de refrescarse sola sin conocer nada del resto del área de trabajo.
 */
interface WatchedTransaction {
  readonly state: TransactionState;
  readonly sessionId: string;
}

/**
 * Las transacciones manuales abiertas, una por conexión.
 *
 * Vivía dentro de `WorkspaceStore` y salió de ahí por el plan de mejoras
 * (FE-001/FE-002): es un estado con su propio reloj, sus propias reglas y nada
 * que ver con pestañas, árbol ni resultados. Lo que sí conserva es **la regla
 * que le da sentido**: la transacción pertenece a la conexión, no a la pestaña.
 * Dos pestañas del mismo perfil comparten sesión, así que lo que se ejecute en
 * cualquiera de ellas entra en la misma transacción, y guardarla por pestaña
 * haría creer lo contrario.
 *
 * Quien llama decide qué decirle al usuario cuando algo sale bien o mal —esos
 * mensajes hablan de la conexión activa, que aquí no se conoce—; de este lado
 * salen solos los que nacen aquí: el de la transacción que se deshizo sola
 * mientras nadie miraba.
 */
@Injectable({ providedIn: 'root' })
export class TransactionStore {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _pendingWork = inject(PendingWorkService);
  private readonly _notices = inject(NoticeStore);

  private readonly _transactions = signal<ReadonlyMap<string, WatchedTransaction>>(new Map());

  private readonly _busy = signal(false);

  /** Hay una operación de transacción en marcha y no conviene lanzar otra. */
  readonly busy = this._busy.asReadonly();

  /**
   * Reloj que vuelve a preguntar por la transacción abierta.
   *
   * Existe por una sola razón: el proceso local la deshace solo si se queda
   * inactiva, y eso ocurre sin que nadie pulse nada. Sin este reloj, el
   * indicador seguiría diciendo que hay una transacción abierta mucho después de
   * que dejara de haberla.
   */
  private _watch: ReturnType<typeof setInterval> | null = null;

  /** Lo último que se sabe de la transacción de una conexión. */
  stateFor(connectionId: string): TransactionState | undefined {
    return this._transactions().get(connectionId)?.state;
  }

  /** Hay una transacción abierta en esa conexión. */
  hasOpen(connectionId: string): boolean {
    return this.stateFor(connectionId)?.isOpen === true;
  }

  /**
   * Ejecuta una operación de transacción sobre una sesión y guarda el estado que
   * devuelva.
   *
   * Lanza si la API falla: quien llama sabe si el fallo fue una sesión perdida
   * —que se cuenta de otra manera— y es quien tiene las palabras para el resto.
   */
  async run(
    connectionId: string,
    sessionId: string,
    operation: (sessionId: string) => Observable<TransactionState>,
  ): Promise<TransactionState> {
    this._busy.set(true);

    try {
      const state = await firstValueFrom(operation(sessionId));

      this.set(connectionId, sessionId, state);

      return state;
    } finally {
      this._busy.set(false);
    }
  }

  /**
   * Vuelve a preguntar por la transacción de una conexión.
   *
   * No molesta al usuario si la pregunta falla: si la API no responde, ya se lo
   * dirá la siguiente cosa que intente hacer.
   */
  async refresh(connectionId: string, sessionId: string): Promise<void> {
    try {
      const state = await firstValueFrom(this._gateway.getTransaction(sessionId));
      const previous = this.stateFor(connectionId);

      this.set(connectionId, sessionId, state);

      // Se cuenta una sola vez, comparando con lo último que se sabía: sin esa
      // comparación el aviso volvería a salir en cada vuelta del reloj.
      if (
        state.autoRolledBackAt &&
        state.autoRolledBackAt !== previous?.autoRolledBackAt &&
        !state.isOpen
      ) {
        const minutos = Math.max(1, Math.round(state.idleTimeoutSeconds / 60));

        this._notices.set(
          `La transacción de «${state.connectionName}» se deshizo sola tras ${minutos} min sin ` +
            'actividad, para no dejar filas bloqueadas. Los cambios sin confirmar se perdieron.',
        );
      }
    } catch {
      // Preguntar por el estado no puede molestar al usuario: si la API no
      // responde, ya se lo dirá la siguiente cosa que intente hacer.
    }
  }

  /** Anota lo que la API acaba de decir de una transacción. */
  set(connectionId: string, sessionId: string, state: TransactionState): void {
    this._transactions.update((current) => {
      const next = new Map(current);
      next.set(connectionId, { state, sessionId });

      return next;
    });

    this.watch();
  }

  /**
   * Olvida la transacción de una conexión.
   *
   * Se usa cuando la sesión ya no existe: el servidor la deshizo al soltar la
   * conexión, así que seguir enseñándola sería mentir.
   */
  forget(connectionId: string): void {
    this._transactions.update((current) => {
      const next = new Map(current);
      next.delete(connectionId);

      return next;
    });

    this.watch();
  }

  /** Mantiene el reloj vivo solo mientras haya alguna transacción abierta. */
  private watch(): void {
    const abiertas = [...this._transactions().values()].some((entry) => entry.state.isOpen);

    // Quien avisa al cerrar la ventana necesita saberlo aquí y no al final: en
    // el escritorio, el aviso lo da el envoltorio, y para entonces preguntarle a
    // la página ya sería tarde.
    this._pendingWork.set(abiertas);

    if (!abiertas) {
      if (this._watch !== null) {
        clearInterval(this._watch);
        this._watch = null;
      }

      return;
    }

    if (this._watch !== null) {
      return;
    }

    this._watch = setInterval(() => {
      for (const [connectionId, entry] of this._transactions()) {
        if (entry.state.isOpen) {
          void this.refresh(connectionId, entry.sessionId);
        }
      }
    }, TRANSACTION_WATCH_MS);
  }
}
