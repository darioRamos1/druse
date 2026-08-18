import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import {
  ApplicationGateway,
  BackupProgress,
  BackupRequest,
} from '../application-gateway/application-gateway';
import { BackupStore } from './backup.store';

const request: BackupRequest = {
  sessionId: 'sesion-1',
  tables: [
    { id: 't1', name: 'clientes', schema: 'public' },
    { id: 't2', name: 'pedidos', schema: 'public' },
  ],
  dataMode: 'StructureOnly',
  layout: 'SingleFile',
  dataFormat: 'Inserts',
  compress: false,
  destination: 'C:/respaldos/todo.sql',
};

function running(partial: Partial<BackupProgress> = {}): BackupProgress {
  return {
    id: 'b1',
    step: 'WritingData',
    outcome: 'Running',
    objectsDone: 1,
    objectsTotal: 2,
    rowsDone: 0,
    totalRows: 0,
    elapsedMilliseconds: 1000,
    warnings: [],
    ...partial,
  };
}

/** Gateway que responde con la cola de estados que se le deje preparada. */
class FakeGateway implements Partial<ApplicationGateway> {
  statuses: BackupProgress[] = [];
  cancelled: string[] = [];
  statusCalls = 0;
  /** El siguiente sondeo se cae, como cuando el proceso local no contesta. */
  failNextStatus = false;
  runShouldFail = false;

  runBackup(): Observable<string> {
    return this.runShouldFail
      ? throwError(() => ({ error: { message: 'La ruta no existe.' } }))
      : of('b1');
  }

  getBackupStatus(): Observable<BackupProgress> {
    this.statusCalls++;

    if (this.failNextStatus) {
      this.failNextStatus = false;

      return throwError(() => new Error('sin respuesta'));
    }

    // El último estado se repite: sondear de más no debe romper la prueba.
    return of(this.statuses.length > 1 ? this.statuses.shift()! : this.statuses[0]);
  }

  cancelBackup(backupId: string): Observable<void> {
    this.cancelled.push(backupId);

    return of(undefined);
  }

  previewBackup(): Observable<never> {
    return throwError(() => new Error('no se usa aquí'));
  }
}

/**
 * Avanza el reloj y deja correr las promesas que el sondeo encadena.
 *
 * Adelantar el temporizador solo programa el trabajo: sin ceder el turno, la
 * respuesta del gateway todavía no ha llegado al estado.
 */
async function sondear(veces = 1): Promise<void> {
  for (let vuelta = 0; vuelta < veces; vuelta++) {
    await vi.advanceTimersByTimeAsync(500);
  }
}

describe('BackupStore', () => {
  let store: BackupStore;
  let gateway: FakeGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    gateway = new FakeGateway();

    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    });

    store = TestBed.inject(BackupStore);
  });

  afterEach(() => vi.useRealTimers());

  it('al lanzar deja el respaldo en marcha antes del primer sondeo', async () => {
    gateway.statuses = [running()];

    await store.start(request);

    expect(store.running()).toBe(true);
    expect(store.finished()).toBe(false);
    expect(store.progress()?.objectsTotal).toBe(2);
  });

  it('un fallo al lanzar no deja un respaldo fantasma', async () => {
    gateway.runShouldFail = true;

    await store.start(request);

    expect(store.progress()).toBeNull();
    expect(store.running()).toBe(false);
    expect(store.error()).toBe('La ruta no existe.');
  });

  it('sigue preguntando hasta que termina, y entonces para', async () => {
    gateway.statuses = [
      running({ objectsDone: 0 }),
      running({ objectsDone: 1 }),
      running({ objectsDone: 2, outcome: 'Completed', step: 'Done' }),
    ];

    await store.start(request);
    await sondear(3);

    const preguntas = gateway.statusCalls;

    expect(store.running()).toBe(false);
    expect(store.finished()).toBe(true);

    await sondear(4);

    // Terminado no se vuelve a preguntar: el sondeo se apagó con el último.
    expect(gateway.statusCalls).toBe(preguntas);
  });

  it('un sondeo perdido no da el respaldo por muerto', async () => {
    gateway.statuses = [running(), running({ outcome: 'Completed', step: 'Done' })];
    gateway.failNextStatus = true;

    await store.start(request);
    await sondear(3);

    expect(store.finished()).toBe(true);
    // El fallo del transporte no es un respaldo fallido, y no se enseña como tal.
    expect(store.error()).toBeNull();
  });

  it('el avance global nunca retrocede ni pasa de cien', async () => {
    gateway.statuses = [
      running({ objectsDone: 2, objectsTotal: 2 }),
      // El servidor manda más objetos hechos que totales: la barra se queda en 1.
      running({ objectsDone: 5, objectsTotal: 2 }),
    ];

    await store.start(request);
    await sondear();

    expect(store.overall()).toBe(1);

    await sondear();

    expect(store.overall()).toBe(1);
  });

  it('sin estimación de filas no se inventa un porcentaje', async () => {
    gateway.statuses = [running({ rowsDone: 4200 })];

    await store.start(request);
    await sondear();

    expect(store.current()).toBeNull();
  });

  it('con estimación el avance de la tabla se acota a uno', async () => {
    gateway.statuses = [running({ rowsDone: 90, rowsEstimated: 100 })];

    await store.start(request);
    await sondear();

    expect(store.current()).toBeCloseTo(0.9);

    // La estimación del catálogo se queda corta a menudo: aun así no pasa del tope.
    gateway.statuses = [running({ rowsDone: 300, rowsEstimated: 100 })];
    await sondear();

    expect(store.current()).toBe(1);
  });

  it('terminado, el avance global se da por completo aunque falten objetos', async () => {
    gateway.statuses = [running({ objectsDone: 1, objectsTotal: 2, outcome: 'Failed' })];

    await store.start(request);
    await sondear();

    expect(store.overall()).toBe(1);
    expect(store.finished()).toBe(true);
  });

  it('cancelar se lo pide al proceso local sin borrar lo que se sabe', async () => {
    gateway.statuses = [running()];

    await store.start(request);
    await store.cancel();

    expect(gateway.cancelled).toEqual(['b1']);
    expect(store.progress()).not.toBeNull();
  });

  it('el resumen no se cierra mientras el respaldo sigue', async () => {
    gateway.statuses = [running()];

    await store.start(request);
    store.dismiss();

    expect(store.progress()).not.toBeNull();
  });

  /**
   * Lo que justifica que el estado viva en `core` y no en el asistente: cerrar
   * el diálogo no puede matar un respaldo de media hora.
   */
  it('el sondeo sigue después de cerrar el asistente', async () => {
    gateway.statuses = [
      running({ objectsDone: 0 }),
      running({ objectsDone: 2, outcome: 'Completed', step: 'Done' }),
    ];

    await store.start(request);
    await sondear();

    // Cerrar el asistente no llama a `cancel`, solo deja de mirar.
    store.dismiss();
    await sondear(2);

    expect(gateway.cancelled).toEqual([]);
    expect(store.progress()?.outcome).toBe('Completed');
  });

  it('cerrado el resumen, el estado se limpia', async () => {
    gateway.statuses = [running({ outcome: 'Cancelled' })];

    await store.start(request);
    await sondear();
    store.dismiss();

    expect(store.progress()).toBeNull();
    expect(store.finished()).toBe(false);
  });

  it('el paso en curso se dice con palabras, empaquetar incluido', async () => {
    gateway.statuses = [running({ step: 'Packaging' })];

    await store.start(request);
    await sondear();

    expect(store.stepLabel()).toBe('Empaquetando');
  });

  it('el registro lleva el motivo del fallo y la instrucción que lo provocó', async () => {
    gateway.statuses = [
      running({
        outcome: 'Failed',
        step: 'Done',
        objectsDone: 1,
        failure: {
          subject: 'public.pedidos',
          message: 'permiso denegado',
          statement: 'SELECT * FROM public.pedidos',
        },
        warnings: [{ subject: 'public.clientes', message: 'sin instantánea' }],
      }),
    ];

    await store.start(request);
    await sondear();

    const registro = store.report();

    expect(registro).toContain('Estado: Fallido');
    expect(registro).toContain('Error en public.pedidos: permiso denegado');
    expect(registro).toContain('Instrucción: SELECT * FROM public.pedidos');
    expect(registro).toContain('Aviso en public.clientes: sin instantánea');
  });
});
