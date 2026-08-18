import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import {
  ApplicationGateway,
  BackupProgress,
  BackupRequest,
  RestoreProgress,
  RestoreRequest,
} from '../../core/application-gateway/application-gateway';
import { BackupStore } from '../../core/backup/backup.store';
import { RestoreStore } from '../../core/backup/restore.store';
import { SessionStatus } from '../../shared/models/workspace';
import { StatusBar } from './status-bar';

const session: SessionStatus = {
  connected: true,
  engine: 'postgresql',
  engineVersion: '18.0',
  database: 'druse_test',
  user: 'postgres',
  lastDurationMs: null,
};

const request: BackupRequest = {
  sessionId: 'sesion-1',
  tables: [{ id: 't1', name: 'pedidos', schema: 'public' }],
  dataMode: 'StructureAndData',
  layout: 'SingleFile',
  dataFormat: 'Inserts',
  compress: false,
  destination: 'C:/respaldos/todo.sql',
};

const restoreRequest: RestoreRequest = {
  sessionId: 'sesion-1',
  path: 'C:/respaldos/todo.sql',
};

/** Gateway que deja el respaldo y la restauración clavados en lo que se le pida. */
class FakeGateway implements Partial<ApplicationGateway> {
  status: BackupProgress = {
    id: 'b1',
    step: 'WritingData',
    outcome: 'Running',
    currentObject: 'public.pedidos',
    objectsDone: 1,
    objectsTotal: 4,
    rowsDone: 10,
    totalRows: 10,
    elapsedMilliseconds: 2000,
    warnings: [],
  };

  runBackup(): Observable<string> {
    return of('b1');
  }

  getBackupStatus(): Observable<BackupProgress> {
    return of(this.status);
  }

  cancelBackup(): Observable<void> {
    return of(undefined);
  }

  restoreStatus: RestoreProgress = {
    id: 'r1',
    step: 'Applying',
    outcome: 'Running',
    currentObject: 'tienda.pedidos',
    statementsDone: 3,
    statementsTotal: 12,
    rowsWritten: 500,
    elapsedMilliseconds: 4000,
    applied: 3,
    warnings: [],
  };

  runRestore(): Observable<string> {
    return of('r1');
  }

  getRestoreStatus(): Observable<RestoreProgress> {
    return of(this.restoreStatus);
  }

  cancelRestore(): Observable<void> {
    return of(undefined);
  }
}

describe('StatusBar', () => {
  let fixture: ComponentFixture<StatusBar>;
  let element: HTMLElement;
  let store: BackupStore;
  let restoreStore: RestoreStore;
  let gateway: FakeGateway;

  beforeEach(async () => {
    vi.useFakeTimers();
    gateway = new FakeGateway();

    await TestBed.configureTestingModule({
      imports: [StatusBar],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();

    store = TestBed.inject(BackupStore);
    restoreStore = TestBed.inject(RestoreStore);
    fixture = TestBed.createComponent(StatusBar);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('session', session);
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  async function respaldar(): Promise<void> {
    await store.start(request);
    await vi.advanceTimersByTimeAsync(500);
    fixture.detectChanges();
  }

  async function restaurar(): Promise<void> {
    await restoreStore.start(restoreRequest);
    await vi.advanceTimersByTimeAsync(500);
    fixture.detectChanges();
  }

  it('sin respaldo en marcha la barra no enseña nada de respaldos', () => {
    expect(element.querySelector('.op--backup')).toBeNull();
    expect(element.textContent).toContain('druse_test');
  });

  /**
   * El criterio de salida de la fase: cerrar el asistente no puede dejar al
   * usuario a ciegas, así que el paso y el objeto viven también aquí.
   */
  it('mientras corre dice el paso, el objeto y el porcentaje', async () => {
    await respaldar();

    const indicador = element.querySelector('.op--backup');

    expect(indicador?.textContent).toContain('Escribiendo datos');
    expect(indicador?.textContent).toContain('public.pedidos');
    expect(indicador?.textContent).toContain('25');
  });

  it('sin objetos que contar la barra recorre en vez de fingir un porcentaje', async () => {
    gateway.status = { ...gateway.status, objectsTotal: 0, objectsDone: 0 };
    await respaldar();

    expect(element.querySelector('.op-bar--waiting')).not.toBeNull();
    expect(element.querySelector('.op--backup')?.textContent).not.toContain('%');
  });

  it('un nombre larguísimo se recorta para no romper la barra', async () => {
    gateway.status = { ...gateway.status, currentObject: `inventario.${'x'.repeat(60)}` };
    await respaldar();

    const nombre = element.querySelector('.op-subject')?.textContent ?? '';

    expect(nombre.length).toBeLessThanOrEqual(32);
    expect(nombre.endsWith('…')).toBe(true);
  });

  it('pulsarlo pide volver al detalle', async () => {
    const vueltas: number[] = [];
    fixture.componentInstance.showBackup.subscribe(() => vueltas.push(1));
    await respaldar();

    element.querySelector<HTMLButtonElement>('.op--backup')?.click();

    expect(vueltas).toHaveLength(1);
  });

  it('terminado el respaldo, el indicador desaparece', async () => {
    await respaldar();

    gateway.status = { ...gateway.status, outcome: 'Completed', step: 'Done', objectsDone: 4 };
    await vi.advanceTimersByTimeAsync(500);
    fixture.detectChanges();

    expect(element.querySelector('.op--backup')).toBeNull();
  });

  /**
   * Restaurar escribe en la base: que el indicador siga ahí con el asistente
   * cerrado es lo que evita que alguien cierre la aplicación a mitad.
   */
  it('mientras se restaura lo dice, con el objeto y el porcentaje', async () => {
    await restaurar();

    const indicador = element.querySelector('.op--restore');

    expect(indicador?.textContent).toContain('Restaurando');
    expect(indicador?.textContent).toContain('Aplicando');
    expect(indicador?.textContent).toContain('tienda.pedidos');
    expect(indicador?.textContent).toContain('25');
  });

  it('pulsar la restauración pide volver a su detalle', async () => {
    const vueltas: number[] = [];
    fixture.componentInstance.showRestore.subscribe(() => vueltas.push(1));
    await restaurar();

    element.querySelector<HTMLButtonElement>('.op--restore')?.click();

    expect(vueltas).toHaveLength(1);
  });

  /** Los dos trabajos son independientes, así que pueden verse a la vez. */
  it('respaldo y restauración a la vez se enseñan por separado', async () => {
    await respaldar();
    await restaurar();

    expect(element.querySelector('.op--backup')).not.toBeNull();
    expect(element.querySelector('.op--restore')).not.toBeNull();
  });

  it('terminada la restauración, su indicador desaparece', async () => {
    await restaurar();

    gateway.restoreStatus = {
      ...gateway.restoreStatus,
      outcome: 'Completed',
      step: 'Done',
      statementsDone: 12,
    };
    await vi.advanceTimersByTimeAsync(500);
    fixture.detectChanges();

    expect(element.querySelector('.op--restore')).toBeNull();
  });
});
