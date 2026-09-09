import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import {
  ApplicationGateway,
  JobSummary,
} from '../../../core/application-gateway/application-gateway';
import { RunningJobsService } from '../../../core/jobs/running-jobs.service';
import { ActivityDialog } from './activity-dialog';

const interrupted: JobSummary = {
  id: 'backup-1',
  kind: 'Backup',
  subject: 'C:/respaldos/prueba.sql',
  state: 'Interrupted',
  startedAtUtc: '2026-09-09T11:00:00Z',
};

describe('ActivityDialog', () => {
  let fixture: ComponentFixture<ActivityDialog>;
  let element: HTMLElement;
  let gateway: { getJobs: ReturnType<typeof vi.fn> };
  let jobs: {
    interrupted: ReturnType<typeof signal<readonly JobSummary[]>>;
    dismissInterrupted: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    gateway = { getJobs: vi.fn(() => of([interrupted])) };
    const alerts = signal<readonly JobSummary[]>([interrupted]);
    jobs = { interrupted: alerts, dismissInterrupted: vi.fn(() => alerts.set([])) };
    await TestBed.configureTestingModule({
      imports: [ActivityDialog],
      providers: [
        { provide: ApplicationGateway, useValue: gateway },
        { provide: RunningJobsService, useValue: jobs },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ActivityDialog);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  function button(text: string): HTMLButtonElement {
    return Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(text),
    )!;
  }

  it('consultar y cerrar conserva el aviso y explica qué se desconoce', () => {
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    expect(element.textContent).toContain(interrupted.subject);
    expect(element.textContent).toContain('Interrumpido');
    expect(element.textContent).toContain('antes de registrar cómo terminó');
    button('Cerrar').click();
    expect(closed).toHaveBeenCalledOnce();
    expect(jobs.dismissInterrupted).not.toHaveBeenCalled();
  });

  it('ocultar avisos no elimina los trabajos y actualizar no los reactiva', () => {
    button('Ocultar avisos').focus();
    button('Ocultar avisos').click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(button('Cerrar'));
    expect(jobs.dismissInterrupted).toHaveBeenCalledOnce();
    expect(element.querySelectorAll('.job')).toHaveLength(1);
    button('Actualizar').click();
    fixture.detectChanges();
    expect(jobs.interrupted()).toHaveLength(0);
    expect(element.textContent).toContain('Interrumpido');
    expect(element.textContent).not.toContain('Ocultar avisos');
  });

  it('un fallo de actualización conserva el detalle y permite reintentar', () => {
    const response = new Subject<readonly JobSummary[]>();
    gateway.getJobs.mockReturnValueOnce(response);
    button('Actualizar').click();
    fixture.detectChanges();
    expect(button('Actualizando').disabled).toBe(true);
    response.error(new Error('sin API'));
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(element.querySelectorAll('.job')).toHaveLength(1);
    gateway.getJobs.mockReturnValueOnce(of([]));
    button('Actualizar').click();
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.textContent).toContain('Aún no hay trabajos registrados');
  });

  it('distingue un éxito, un fallo, una cancelación y una finalización con avisos', () => {
    gateway.getJobs.mockReturnValueOnce(
      of(
        ['Completed', 'Failed', 'Cancelled', 'CompletedWithWarnings'].map((outcome, index) => ({
          ...interrupted,
          id: `${index}`,
          state: 'Finished',
          outcome,
        })),
      ),
    );
    button('Actualizar').click();
    fixture.detectChanges();
    expect(
      Array.from(element.querySelectorAll('.state')).map((state) => state.textContent?.trim()),
    ).toEqual(['Completado', 'Fallido', 'Cancelado', 'Completado con avisos']);
    expect(element.querySelectorAll('.job--attention')).toHaveLength(1);
  });
});
