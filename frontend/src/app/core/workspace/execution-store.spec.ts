import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import {
  ApplicationGateway,
  ExecuteQueryRequest,
} from '../application-gateway/application-gateway';
import { QueryResult } from '../../shared/models/workspace';
import { ExecutionStore } from './execution-store';

function resultado(): QueryResult {
  return {
    executionId: 'e1',
    state: 'succeeded',
    resultSets: [
      {
        columns: [{ name: 'id', dataType: 'integer', kind: 'number', width: null }],
        rows: [{ number: 1, values: ['1'] }],
        totalRows: 1,
        durationMs: 12,
        truncated: false,
      },
    ],
    messages: [],
    durationMs: 12,
  };
}

/** Gateway que deja ver qué se le pidió y cuándo contestar. */
class FakeGateway implements Partial<ApplicationGateway> {
  peticiones: ExecuteQueryRequest[] = [];
  canceladas: string[] = [];
  fallaEjecucion: unknown = null;
  fallaCancelacion = false;

  /** Se resuelve a mano para poder mirar el estado con la consulta en marcha. */
  private _terminar: ((result: QueryResult) => void) | null = null;

  executeQuery(request: ExecuteQueryRequest): Observable<QueryResult> {
    this.peticiones.push(request);

    if (this.fallaEjecucion) {
      return throwError(() => this.fallaEjecucion);
    }

    return new Observable<QueryResult>((subscriber) => {
      this._terminar = (result) => {
        subscriber.next(result);
        subscriber.complete();
      };
    });
  }

  cancelQuery(executionId: string): Observable<void> {
    this.canceladas.push(executionId);

    return this.fallaCancelacion ? throwError(() => new Error('ya terminó')) : of(undefined);
  }

  /** Contesta a la consulta que está esperando. */
  responder(result = resultado()): void {
    this._terminar?.(result);
    this._terminar = null;
  }
}

const peticion = { sessionId: 'sesion-1', sql: 'select 1' };

describe('ExecutionStore', () => {
  let execution: ExecutionStore;
  let gateway: FakeGateway;

  beforeEach(() => {
    gateway = new FakeGateway();

    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    });

    execution = TestBed.inject(ExecutionStore);
  });

  it('empieza sin nada en pantalla', () => {
    expect(execution.result()).toBeNull();
    expect(execution.resultSet()).toBeNull();
    expect(execution.running()).toBe(false);
  });

  it('mientras corre lo dice, y manda un identificador para poder cancelar', async () => {
    const enMarcha = execution.run(peticion);

    expect(execution.running()).toBe(true);
    expect(gateway.peticiones[0].executionId).toBeTruthy();

    gateway.responder();
    await enMarcha;

    expect(execution.running()).toBe(false);
  });

  it('cancelar usa el identificador de la consulta en curso', async () => {
    const enMarcha = execution.run(peticion);

    await execution.cancel();

    expect(execution.canceling()).toBe(true);
    expect(gateway.canceladas).toEqual([gateway.peticiones[0].executionId]);

    // Pedirlo dos veces no manda otra: ya se está esperando la confirmación.
    await execution.cancel();
    expect(gateway.canceladas.length).toBe(1);

    gateway.responder();
    await enMarcha;
  });

  it('sin nada corriendo no hay nada que cancelar', async () => {
    await execution.cancel();

    expect(gateway.canceladas).toEqual([]);
  });

  it('si la cancelación llega tarde, el botón vuelve a su sitio', async () => {
    const enMarcha = execution.run(peticion);
    gateway.fallaCancelacion = true;

    await execution.cancel();

    // La consulta había terminado ya: seguir diciendo «cancelando» dejaría la
    // barra mintiendo hasta la siguiente ejecución.
    expect(execution.canceling()).toBe(false);

    gateway.responder();
    await enMarcha;
  });

  it('un fallo sube a quien llamó y suelta el estado', async () => {
    gateway.fallaEjecucion = new Error('no se pudo');

    await expect(execution.run(peticion)).rejects.toThrow('no se pudo');

    expect(execution.running()).toBe(false);
    expect(execution.result()).toBeNull();
  });

  it('lo que se enseña recuerda de dónde salió', async () => {
    const enMarcha = execution.run(peticion);
    gateway.responder();
    const result = await enMarcha;

    execution.show(result, {
      tabId: 'q1',
      connectionId: 'c1',
      database: 'druse_test',
      sql: 'select 1',
      title: 'Query 1',
    });

    expect(execution.resultSet()?.rows.length).toBe(1);
    expect(execution.source()?.connectionId).toBe('c1');

    execution.clear();

    expect(execution.result()).toBeNull();
    expect(execution.source()).toBeNull();
  });

  it('el rechazo se guarda entero y una ejecución nueva lo retira', async () => {
    execution.noteRejection({
      value: {
        reason: 'unconfirmeddestructive',
        message: 'Esto borra filas.',
        risks: [],
      },
      operation: 'execute',
      tabId: 'q1',
      connectionId: 'c1',
      sql: 'delete from clientes',
    });

    expect(execution.rejection()?.reason).toBe('unconfirmeddestructive');
    expect(execution.pendingRejection()?.sql).toBe('delete from clientes');

    const enMarcha = execution.run(peticion);

    // Empezar otra cosa deja sin sentido la confirmación de la anterior.
    expect(execution.rejection()).toBeNull();

    gateway.responder();
    await enMarcha;
  });
});
