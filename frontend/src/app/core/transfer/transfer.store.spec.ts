import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import {
  ApplicationGateway,
  TransferProgress,
  TransferRequest,
} from '../application-gateway/application-gateway';
import { TransferStore } from './transfer.store';

const request: TransferRequest = {
  sourceSessionId: 'sesion-dev',
  source: { id: 't1', name: 'pedidos', schema: 'public', approximateRowCount: 1000 },
  targetSessionId: 'sesion-prod',
  target: { id: 't2', name: 'pedidos', schema: 'public' },
  mode: 'Insert',
  atomic: false,
  batchSize: 1000,
  keepIdentity: true,
  confirmed: true,
};

function running(partial: Partial<TransferProgress> = {}): TransferProgress {
  return {
    id: 'tr1',
    step: 'CopyingRows',
    outcome: 'Running',
    currentObject: 'public.pedidos',
    rowsCopied: 0,
    rowsEstimated: 1000,
    rowsSkipped: 0,
    tablesDone: 0,
    tablesTotal: 1,
    batchesDone: 0,
    elapsedMilliseconds: 1000,
    warnings: [],
    ...partial,
    // Con una sola tabla, lo copiado de la tabla en curso y el total de la pasada
    // son el mismo número, y así es como llega del proceso local.
    tableRowsCopied: partial.tableRowsCopied ?? partial.rowsCopied ?? 0,
  };
}

/** Gateway que responde con la cola de estados que se le deje preparada. */
class FakeGateway implements Partial<ApplicationGateway> {
  statuses: TransferProgress[] = [];
  cancelled: string[] = [];
  statusCalls = 0;
  runShouldFail = false;

  runTransfer(): Observable<string> {
    return this.runShouldFail
      ? throwError(() => ({ error: { message: 'La sesión de destino no está abierta.' } }))
      : of('tr1');
  }

  getTransferStatus(): Observable<TransferProgress> {
    this.statusCalls++;

    // El último estado se repite: sondear de más no debe romper la prueba.
    return of(this.statuses.length > 1 ? this.statuses.shift()! : this.statuses[0]);
  }

  cancelTransfer(transferId: string): Observable<void> {
    this.cancelled.push(transferId);

    return of(undefined);
  }
}

async function sondear(veces = 1): Promise<void> {
  for (let vuelta = 0; vuelta < veces; vuelta++) {
    await vi.advanceTimersByTimeAsync(500);
  }
}

describe('TransferStore', () => {
  let store: TransferStore;
  let gateway: FakeGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    gateway = new FakeGateway();

    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    });

    store = TestBed.inject(TransferStore);
  });

  afterEach(() => vi.useRealTimers());

  it('al lanzar deja el traslado en marcha antes del primer sondeo', async () => {
    gateway.statuses = [running()];

    await store.start(request);

    expect(store.running()).toBe(true);
    expect(store.progress()?.currentObject).toBe('pedidos');
    expect(store.progress()?.rowsEstimated).toBe(1000);
  });

  it('un fallo al lanzar no deja un traslado fantasma', async () => {
    gateway.runShouldFail = true;

    await store.start(request);

    expect(store.progress()).toBeNull();
    expect(store.running()).toBe(false);
    expect(store.error()).toBe('La sesión de destino no está abierta.');
  });

  it('sigue preguntando hasta que termina, y entonces para', async () => {
    gateway.statuses = [
      running({ rowsCopied: 200 }),
      running({ rowsCopied: 700 }),
      running({ rowsCopied: 1000, outcome: 'Completed', step: 'Done' }),
    ];

    await store.start(request);
    await sondear(3);

    const preguntas = gateway.statusCalls;

    expect(store.finished()).toBe(true);
    expect(store.progress()?.rowsCopied).toBe(1000);

    await sondear(2);

    expect(gateway.statusCalls).toBe(preguntas);
  });

  /**
   * Sin estimación no hay barra: se enseña el contador.
   *
   * Una barra que llega al 90 % y se queda ahí es peor que no tener barra, y con
   * una condición `WHERE` el catálogo no sabe cuántas filas van a salir.
   */
  it('sin estimación no inventa un porcentaje', async () => {
    gateway.statuses = [running({ rowsEstimated: undefined, rowsCopied: 340 })];

    await store.start({ ...request, source: { ...request.source, approximateRowCount: undefined } });
    await sondear();

    expect(store.overall()).toBeNull();
    expect(store.progress()?.rowsCopied).toBe(340);
  });

  it('el avance sale de las filas copiadas contra la estimación', async () => {
    gateway.statuses = [running({ rowsCopied: 250, rowsEstimated: 1000 })];

    await store.start(request);
    await sondear();

    expect(store.overall()).toBeCloseTo(0.25);
  });

  /**
   * El resumen de un traslado fallido dice **cuántas filas quedaron allí**.
   *
   * Es la única pregunta que importa cuando algo falla a mitad: sin ese número,
   * repetir la copia es la salida evidente y duplicaría lo ya copiado.
   */
  it('el registro de un fallo dice cuántas filas quedaron en el destino', async () => {
    gateway.statuses = [
      running({
        outcome: 'Failed',
        step: 'Done',
        rowsCopied: 4000,
        failure: { message: 'La conexión se cayó.', rowsCommitted: 4000 },
      }),
    ];

    await store.start(request);
    await sondear();

    expect(store.report()).toContain('Filas que quedaron en el destino: 4000');
    expect(store.report()).toContain('La conexión se cayó.');
  });

  it('cancelar solo se pide mientras está en marcha', async () => {
    gateway.statuses = [running({ outcome: 'Completed', step: 'Done' })];

    await store.start(request);
    await sondear();
    await store.cancel();

    expect(gateway.cancelled).toEqual([]);
  });

  it('el resumen no se desvanece solo: lo cierra quien lo lee', async () => {
    gateway.statuses = [running({ outcome: 'Completed', step: 'Done', rowsCopied: 12 })];

    await store.start(request);
    await sondear(3);

    expect(store.finished()).toBe(true);

    store.dismiss();

    expect(store.progress()).toBeNull();
  });
});
