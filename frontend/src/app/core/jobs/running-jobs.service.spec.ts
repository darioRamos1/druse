import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DesktopHost } from '../application-gateway/desktop-host';
import { BackupStore } from '../backup/backup.store';
import { RestoreStore } from '../backup/restore.store';
import { PendingWorkService } from '../files/pending-work.service';
import { TransferStore } from '../transfer/transfer.store';
import { RunningJobsService } from './running-jobs.service';

/** Un trabajo largo cualquiera: lo único que importa aquí es si está corriendo. */
class FakeJobStore {
  readonly _running: WritableSignal<boolean> = signal(false);
  readonly running = this._running.asReadonly();

  cancelled = 0;

  /** Lo que hace la API de verdad: acepta la cancelación y para más tarde. */
  stopsWhenCancelled = true;

  async cancel(): Promise<void> {
    this.cancelled++;

    if (this.stopsWhenCancelled) {
      this._running.set(false);
    }
  }
}

class FakePendingWork {
  jobs: (string | null)[] = [];

  setJob(label: string | null): void {
    this.jobs.push(label);
  }
}

class FakeDesktop {
  handler: (() => void) | null = null;
  closes = 0;

  listenForCancelAndClose(handler: () => void): Promise<() => void> {
    this.handler = handler;

    return Promise.resolve(() => undefined);
  }

  confirmClose(): Promise<void> {
    this.closes++;

    return Promise.resolve();
  }
}

describe('RunningJobsService', () => {
  let backups: FakeJobStore;
  let restores: FakeJobStore;
  let transfers: FakeJobStore;
  let pendingWork: FakePendingWork;
  let desktop: FakeDesktop;
  let service: RunningJobsService;

  beforeEach(() => {
    backups = new FakeJobStore();
    restores = new FakeJobStore();
    transfers = new FakeJobStore();
    pendingWork = new FakePendingWork();
    desktop = new FakeDesktop();

    TestBed.configureTestingModule({
      providers: [
        RunningJobsService,
        { provide: BackupStore, useValue: backups },
        { provide: RestoreStore, useValue: restores },
        { provide: TransferStore, useValue: transfers },
        { provide: PendingWorkService, useValue: pendingWork },
        { provide: DesktopHost, useValue: desktop },
      ],
    });

    service = TestBed.inject(RunningJobsService);
  });

  it('sin nada en marcha no hay nada que declarar', () => {
    TestBed.flushEffects();

    expect(service.label()).toBeNull();
    expect(pendingWork.jobs).toEqual([null]);
  });

  /**
   * El envoltorio escribe la etiqueta tal cual dentro de la frase del aviso, así
   * que se nombra como se va a leer: «Druse está haciendo un respaldo».
   */
  it('declara al envoltorio qué trabajo hay en marcha', () => {
    backups._running.set(true);
    TestBed.flushEffects();

    expect(service.label()).toBe('un respaldo');
    expect(pendingWork.jobs.at(-1)).toBe('un respaldo');

    backups._running.set(false);
    restores._running.set(true);
    TestBed.flushEffects();

    expect(pendingWork.jobs.at(-1)).toBe('una restauración');
  });

  /**
   * Los tres a la vez y no en cadena: son trabajos independientes, y esperar a
   * que uno confirme para pedir el siguiente sumaría las esperas justo cuando el
   * usuario intenta cerrar.
   */
  it('cancela lo que haya y cierra cuando la API lo confirma', async () => {
    backups._running.set(true);
    transfers._running.set(true);
    TestBed.flushEffects();

    await service.cancelAndClose();

    expect(backups.cancelled).toBe(1);
    expect(transfers.cancelled).toBe(1);
    // No se pide cancelar lo que no está corriendo.
    expect(restores.cancelled).toBe(0);
    expect(desktop.closes).toBe(1);
    expect(service.timedOut).toBe(false);
  });

  /**
   * Cerrar sin esperar la confirmación dejaría el trabajo corriendo dentro de un
   * proceso que se muere, que es justo lo que el aviso quería evitar.
   */
  it('si el trabajo no para, no se cierra', async () => {
    backups._running.set(true);
    backups.stopsWhenCancelled = false;
    TestBed.flushEffects();

    // El plazo real son treinta segundos; aquí se adelanta el reloj para no
    // esperarlos.
    vi.useFakeTimers();

    const cerrando = service.cancelAndClose();

    await vi.advanceTimersByTimeAsync(31_000);
    await cerrando;

    vi.useRealTimers();

    expect(backups.cancelled).toBe(1);
    expect(desktop.closes).toBe(0);
    expect(service.timedOut).toBe(true);
  });
});
