import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import {
  ApplicationGateway,
  BackupProgress,
  BackupRequest,
} from '../../core/application-gateway/application-gateway';
import { BackupStore } from '../../core/backup/backup.store';
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

/** Gateway que deja el respaldo clavado en el estado que se le pida. */
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
}

describe('StatusBar', () => {
  let fixture: ComponentFixture<StatusBar>;
  let element: HTMLElement;
  let store: BackupStore;
  let gateway: FakeGateway;

  beforeEach(async () => {
    vi.useFakeTimers();
    gateway = new FakeGateway();

    await TestBed.configureTestingModule({
      imports: [StatusBar],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();

    store = TestBed.inject(BackupStore);
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

  it('sin respaldo en marcha la barra no enseña nada de respaldos', () => {
    expect(element.querySelector('.backup')).toBeNull();
    expect(element.textContent).toContain('druse_test');
  });

  /**
   * El criterio de salida de la fase: cerrar el asistente no puede dejar al
   * usuario a ciegas, así que el paso y el objeto viven también aquí.
   */
  it('mientras corre dice el paso, el objeto y el porcentaje', async () => {
    await respaldar();

    const indicador = element.querySelector('.backup');

    expect(indicador?.textContent).toContain('Escribiendo datos');
    expect(indicador?.textContent).toContain('public.pedidos');
    expect(indicador?.textContent).toContain('25');
  });

  it('sin objetos que contar la barra recorre en vez de fingir un porcentaje', async () => {
    gateway.status = { ...gateway.status, objectsTotal: 0, objectsDone: 0 };
    await respaldar();

    expect(element.querySelector('.backup-bar--waiting')).not.toBeNull();
    expect(element.querySelector('.backup')?.textContent).not.toContain('%');
  });

  it('un nombre larguísimo se recorta para no romper la barra', async () => {
    gateway.status = { ...gateway.status, currentObject: `inventario.${'x'.repeat(60)}` };
    await respaldar();

    const nombre = element.querySelector('.backup-subject')?.textContent ?? '';

    expect(nombre.length).toBeLessThanOrEqual(32);
    expect(nombre.endsWith('…')).toBe(true);
  });

  it('pulsarlo pide volver al detalle', async () => {
    const vueltas: number[] = [];
    fixture.componentInstance.showBackup.subscribe(() => vueltas.push(1));
    await respaldar();

    element.querySelector<HTMLButtonElement>('.backup')?.click();

    expect(vueltas).toHaveLength(1);
  });

  it('terminado el respaldo, el indicador desaparece', async () => {
    await respaldar();

    gateway.status = { ...gateway.status, outcome: 'Completed', step: 'Done', objectsDone: 4 };
    await vi.advanceTimersByTimeAsync(500);
    fixture.detectChanges();

    expect(element.querySelector('.backup')).toBeNull();
  });
});
