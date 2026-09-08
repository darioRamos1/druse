import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApplicationGateway, TransactionState } from '../application-gateway/application-gateway';
import { DesktopHost } from '../application-gateway/desktop-host';
import { NoticeStore } from './notice-store';
import { TransactionStore } from './transaction-store';

function estado(partial: Partial<TransactionState> = {}): TransactionState {
  return {
    sessionId: 'sesion-1',
    isOpen: true,
    connectionName: 'Pruebas',
    database: 'druse_test',
    engine: 'postgresql',
    ddlIsReversible: true,
    idleTimeoutSeconds: 600,
    ...partial,
  };
}

class FakeGateway implements Partial<ApplicationGateway> {
  /** Lo que contesta el sondeo, en orden; el último se repite. */
  estados: TransactionState[] = [estado()];
  consultas = 0;
  fallaConsulta = false;

  getTransaction(): Observable<TransactionState> {
    this.consultas++;

    if (this.fallaConsulta) {
      return throwError(() => new Error('sin respuesta'));
    }

    return of(this.estados.length > 1 ? this.estados.shift()! : this.estados[0]);
  }

  beginTransaction(): Observable<TransactionState> {
    return of(estado());
  }
}

describe('TransactionStore', () => {
  let transactions: TransactionStore;
  let notices: NoticeStore;
  let gateway: FakeGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    gateway = new FakeGateway();

    TestBed.configureTestingModule({
      providers: [
        { provide: ApplicationGateway, useValue: gateway },
        // El envoltorio no existe en las pruebas: el aviso al cerrar se queda en
        // el camino del navegador, que aquí no molesta.
        { provide: DesktopHost, useValue: { isDesktop: false } },
      ],
    });

    transactions = TestBed.inject(TransactionStore);
    notices = TestBed.inject(NoticeStore);
  });

  afterEach(() => vi.useRealTimers());

  it('sin nada abierto no sabe de ninguna conexión', () => {
    expect(transactions.hasOpen('c1')).toBe(false);
    expect(transactions.stateFor('c1')).toBeUndefined();
  });

  it('guarda lo que devuelve la operación y marca la conexión ocupada mientras corre', async () => {
    const promesa = transactions.run('c1', 'sesion-1', () => gateway.beginTransaction());

    expect(transactions.busy()).toBe(true);

    await promesa;

    expect(transactions.busy()).toBe(false);
    expect(transactions.hasOpen('c1')).toBe(true);
  });

  it('un fallo llega a quien llamó y suelta el ocupado', async () => {
    await expect(
      transactions.run('c1', 'sesion-1', () => throwError(() => new Error('no se pudo'))),
    ).rejects.toThrow('no se pudo');

    expect(transactions.busy()).toBe(false);
  });

  it('el reloj vuelve a preguntar mientras siga abierta', async () => {
    await transactions.run('c1', 'sesion-1', () => gateway.beginTransaction());
    gateway.consultas = 0;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(gateway.consultas).toBe(1);
  });

  it('cuenta una sola vez que la transacción se deshizo sola', async () => {
    await transactions.run('c1', 'sesion-1', () => gateway.beginTransaction());

    gateway.estados = [estado({ isOpen: false, autoRolledBackAt: '2026-09-08T10:00:00Z' })];

    await vi.advanceTimersByTimeAsync(30_000);

    expect(notices.notice()).toContain('se deshizo sola');
    expect(notices.notice()).toContain('10 min');

    notices.clear();

    // El reloj se para al cerrarse la última: sin transacciones abiertas no hay
    // nada que sondear, y el aviso no puede repetirse en cada vuelta.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(notices.notice()).toBeNull();
  });

  it('preguntar por el estado no molesta al usuario si la API no contesta', async () => {
    gateway.fallaConsulta = true;

    await transactions.refresh('c1', 'sesion-1');

    expect(notices.notice()).toBeNull();
  });

  it('olvidar una conexión retira su transacción', async () => {
    await transactions.run('c1', 'sesion-1', () => gateway.beginTransaction());

    transactions.forget('c1');

    expect(transactions.hasOpen('c1')).toBe(false);

    gateway.consultas = 0;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(gateway.consultas).toBe(0);
  });
});
