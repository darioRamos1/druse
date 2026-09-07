import { Injectable, computed, inject, signal } from '@angular/core';

import {
  AvailableUpdate,
  DesktopAppInfo,
  DesktopHost,
  UpdateProgress,
} from '../application-gateway/desktop-host';

export type UpdateState =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error';

@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly _host = inject(DesktopHost);
  private initialized = false;

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

      await this.check();
    } catch (error) {
      this.initialized = false;
      this.fail(error, 'No se pudo consultar la información de Druse.');
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
      this.fail(error, 'No se pudo buscar actualizaciones.');
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
      this.fail(error, 'No se pudo instalar la actualización.');
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
