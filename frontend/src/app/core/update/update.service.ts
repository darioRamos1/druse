import { Injectable, computed, inject, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';

import {
  AvailableUpdate,
  DesktopAppInfo,
  DesktopHost,
  UpdateProgress,
} from '../application-gateway/desktop-host';

export type UpdateState =
  | 'idle'
  | 'disabled'
  /** Nadie ha dicho todavía si Druse puede salir a buscarlas. */
  | 'undecided'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error';

/** Cómo se guarda la elección en la base local. Es el contrato con las preferencias. */
export const AUTO_CHECK_PREFERENCE = 'updates.autoCheck';

@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly _host = inject(DesktopHost);
  private readonly _i18n = inject(I18nService);
  private initialized = false;

  /**
   * Si Druse puede consultar GitHub al abrirse.
   *
   * `null` significa que nadie lo ha elegido todavía, y **no es lo mismo que
   * «no»**: mientras esté sin decidir no se consulta nada y la interfaz lo
   * pregunta. Buscar actualizaciones es la única conexión que Druse abriría sin
   * que el usuario la pidiera, así que se pide antes, no después.
   */
  readonly autoCheck = signal<boolean | null>(null);

  readonly info = signal<DesktopAppInfo | null>(null);
  readonly available = signal<AvailableUpdate | null>(null);
  readonly state = signal<UpdateState>('idle');
  readonly error = signal<string | null>(null);
  readonly downloaded = signal(0);
  readonly total = signal<number | null>(null);

  readonly percent = computed(() => {
    const total = this.total();
    return total && total > 0 ? Math.min(100, Math.round((this.downloaded() / total) * 100)) : null;
  });

  /** Impide iniciar trabajo nuevo mientras el actualizador prepara el cierre. */
  readonly blocksDatabaseOperations = computed(() =>
    ['downloading', 'installing'].includes(this.state()),
  );

  /**
   * Recoge la elección guardada.
   *
   * La leen las preferencias del área de trabajo y se pasa aquí, como el tema:
   * son una sola lectura en el arranque, y pedirlas otra vez desde este servicio
   * sería preguntar dos veces lo mismo.
   *
   * Cualquier valor que no sea `true` o `false` se trata como sin decidir. Una
   * base local sobrevive a las versiones, y un valor que dejó de existir no
   * puede acabar autorizando una conexión por su cuenta.
   */
  adopt(preferences: Readonly<Record<string, string>>): void {
    const stored = preferences[AUTO_CHECK_PREFERENCE];

    this.autoCheck.set(stored === 'true' ? true : stored === 'false' ? false : null);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    try {
      const info = await this._host.appInfo();
      this.info.set(info);

      if (!info.updatesEnabled) {
        this.state.set('disabled');
        return;
      }

      if (this.autoCheck() !== true) {
        // Sin permiso explícito no se sale a la red. Quien lo tenga desactivado
        // conserva el botón de buscar a mano: lo que se desactiva es que Druse
        // lo haga solo, no que se pueda actualizar.
        this.state.set(this.autoCheck() === null ? 'undecided' : 'idle');
        return;
      }

      await this.check();
    } catch (error) {
      this.initialized = false;
      this.fail(error, this._i18n.t('update.infoFailed'));
    }
  }

  /**
   * Aplica la decisión de buscar actualizaciones al abrirse.
   *
   * Activarlo comprueba ya: quien acaba de decir que sí espera saber si hay algo
   * nuevo, no esperar al siguiente arranque.
   *
   * **Aquí no se guarda nada, y no es un olvido.** A este servicio lo inyecta la
   * interceptora de HTTP para frenar las peticiones mientras se instala una
   * actualización; si además dependiera del gateway —que necesita `HttpClient`—
   * se montaría un círculo entre el cliente y su propia interceptora. Quien
   * recuerda la elección es el área de trabajo, que ya guarda las demás
   * preferencias.
   */
  async setAutoCheck(enabled: boolean): Promise<void> {
    this.autoCheck.set(enabled);

    if (enabled) {
      await this.check();
      return;
    }

    if (this.state() !== 'disabled') {
      this.state.set('idle');
      this.available.set(null);
    }
  }

  async check(): Promise<void> {
    if (!this.info()?.updatesEnabled) {
      return;
    }

    this.state.set('checking');
    this.error.set(null);
    this.available.set(null);

    try {
      const update = await this._host.checkForUpdate();
      this.available.set(update);
      this.state.set(update ? 'available' : 'current');
    } catch (error) {
      this.fail(error, this._i18n.t('update.checkFailed'));
    }
  }

  async apply(): Promise<void> {
    if (!this.available()) {
      return;
    }

    this.state.set('downloading');
    this.error.set(null);
    this.downloaded.set(0);
    this.total.set(null);

    // Anotado: sin el tipo, se infiere `() => undefined` y no admite lo que
    // devuelve el envoltorio, que es `() => void`.
    let unlisten: () => void = () => undefined;

    try {
      unlisten = await this._host.listenForUpdateProgress((progress) => this.onProgress(progress));
      await this._host.downloadAndInstallUpdate();
      this.state.set('installing');
    } catch (error) {
      this.fail(error, this._i18n.t('update.installFailed'));
    } finally {
      unlisten();
    }
  }

  private onProgress(progress: UpdateProgress): void {
    switch (progress.event) {
      case 'started':
        this.total.set(progress.total);
        break;
      case 'progress':
        this.downloaded.set(progress.downloaded);
        break;
      case 'finished':
        this.state.set('installing');
        break;
    }
  }

  private fail(error: unknown, fallback: string): void {
    this.error.set(
      error instanceof Error ? error.message : typeof error === 'string' ? error : fallback,
    );
    this.state.set('error');
  }
}
