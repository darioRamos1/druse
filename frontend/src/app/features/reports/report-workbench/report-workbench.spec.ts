import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import {
  ReportDataset,
  ReportRefresh,
  ReportRun,
  ReportSchedule,
  ReportSnapshot,
  SavedReport,
} from '../../../shared/models/reports';
import { ReportWorkbench } from './report-workbench';

const dataset: ReportDataset = {
  id: 'ds-1',
  name: 'Ventas y metas',
  version: 2,
  sources: [],
  join: null,
};

/** El escenario del plan: enero con tres municipios, uno sin meta. */
const enero: ReportSnapshot = {
  datasetId: 'ds-1',
  definitionVersion: 2,
  fromOlderDefinition: false,
  startedAtUtc: '2026-11-11T15:00:00Z',
  completedAtUtc: '2026-11-11T15:00:02Z',
  columns: [
    { name: 'izquierda.municipio', dataType: 'varchar', clrType: 'String', ordinal: 0 },
    { name: 'izquierda.venta', dataType: 'decimal', clrType: 'Decimal', ordinal: 1 },
    { name: 'derecha.meta', dataType: 'numeric', clrType: 'Decimal', ordinal: 2 },
  ],
  rows: [
    ['05001', 80, 100],
    ['08001', 100, 200],
    ['11001', 40, null],
  ],
  unmatchedLeftRows: 1,
  unmatchedRightRows: 0,
  repeatedColumns: [],
};

function intento(status: ReportRun['status'], patch: Partial<ReportRun> = {}): ReportRun {
  return {
    id: crypto.randomUUID(),
    definitionVersion: 2,
    origin: 'Manual',
    status,
    startedAtUtc: '2026-11-12T09:00:00Z',
    completedAtUtc: '2026-11-12T09:00:01Z',
    message: null,
    duplicateKeys: [],
    rowCount: 3,
    sources: [],
    ...patch,
  };
}

describe('ReportWorkbench', () => {
  let fixture: ComponentFixture<ReportWorkbench>;
  let guardado: ReportSnapshot | null;
  let respuesta: ReportRefresh;
  let reportes: SavedReport[];
  let escritos: SavedReport[];
  let lecturas: number;
  let intentos: ReportRun[];
  let programada: ReportSchedule | null;
  let programaciones: ReportSchedule[];
  let borrados: number;

  async function asentar(): Promise<void> {
    for (let intento = 0; intento < 20; intento++) {
      await Promise.resolve();
    }

    fixture.detectChanges();
  }

  function el<T extends Element = HTMLElement>(selector: string): T {
    return fixture.nativeElement.querySelector(selector) as T;
  }

  function botón(texto: string): HTMLButtonElement {
    return [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) =>
      (button.textContent ?? '').trim().startsWith(texto),
    ) as HTMLButtonElement;
  }

  async function crear(): Promise<void> {
    fixture = TestBed.createComponent(ReportWorkbench);
    fixture.componentRef.setInput('dataset', dataset);
    fixture.componentRef.setInput('columnLabel', (name: string) =>
      name.replace('izquierda.', 'Ventas.').replace('derecha.', 'Metas.'),
    );
    fixture.detectChanges();
    await asentar();
  }

  beforeEach(async () => {
    guardado = enero;
    respuesta = { outcome: 'Refreshed', run: intento('Succeeded') };
    reportes = [];
    escritos = [];
    lecturas = 0;
    intentos = [];
    programada = null;
    programaciones = [];
    borrados = 0;

    const gateway = {
      getReportSnapshot: () => {
        lecturas++;
        return of(guardado);
      },
      getReportRuns: () => of(intentos),
      getSavedReports: () => of(reportes),
      getReportSchedule: () => of(programada),
      saveReportSchedule: (_id: string, schedule: ReportSchedule): Observable<ReportSchedule> => {
        programaciones.push(schedule);
        programada = {
          ...schedule,
          nextRunUtc: schedule.paused ? null : '2026-11-13T12:00:00Z',
          retryAtUtc: null,
          running: false,
        };
        return of(programada);
      },
      getReportStorage: () =>
        of({
          fileBytes: 3 * 1024 * 1024,
          snapshotBytes: guardado ? 2048 : 0,
          quotaBytes: 512 * 1024 * 1024,
          datasets: [
            {
              datasetId: 'ds-1',
              name: 'Ventas y metas',
              snapshotBytes: guardado ? 2048 : 0,
              runCount: intentos.length,
              capturedAtUtc: null,
            },
          ],
        }),
      deleteReportSnapshot: () => {
        borrados++;
        guardado = null;
        return of(undefined);
      },
      deleteReportSchedule: () => {
        programada = null;
        return of(undefined);
      },
      refreshReportDataset: (): Observable<ReportRefresh> => of(respuesta),
      saveReport: (report: SavedReport): Observable<SavedReport> => {
        escritos.push(report);
        return of(report);
      },
      deleteReport: () => of(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ReportWorkbench],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();
  });

  it('sin datos guardados lo dice, y al actualizar propone un gráfico de barras', async () => {
    guardado = null;
    await crear();

    expect(el('.freshness').textContent).toContain('Todavía no hay datos guardados');

    guardado = enero;
    botón('Actualizar ahora').click();
    await asentar();

    expect(el('.freshness').textContent).toContain('Datos del');
    expect(fixture.nativeElement.querySelectorAll('.chart__bar')).toHaveLength(3);
    expect(el('svg.chart').getAttribute('aria-label')).toContain('Suma · Ventas.venta');
  });

  it('si el intento falla, conserva los datos y dice por qué', async () => {
    await crear();
    const antes = lecturas;

    respuesta = {
      outcome: 'Failed',
      run: intento('Failed', {
        message: 'No se pudo leer alguna fuente. Se conserva el resultado anterior.',
        sources: [
          {
            alias: 'Metas',
            failureCode: 'connection-missing',
            message: null,
            rowCount: 0,
            truncated: false,
            startedAtUtc: '2026-11-12T09:00:00Z',
            completedAtUtc: '2026-11-12T09:00:01Z',
          },
        ],
      }),
    };
    botón('Actualizar ahora').click();
    await asentar();

    expect(lecturas).toBe(antes);
    expect(el('.banner--danger').textContent).toContain('se conservan los datos anteriores');
    expect(el('.banner--danger').textContent).toContain(
      'Metas: La conexión de esta fuente ya no existe',
    );
    expect(el('.freshness').textContent).toContain('Datos del');
  });

  it('programa la actualización semanal y enseña la próxima', async () => {
    await crear();

    botón('Programar').click();
    fixture.detectChanges();
    const form = el('form.schedule');
    expect(form).toBeTruthy();

    botón('Semanal').click();
    fixture.detectChanges();
    const viernes = [...form.querySelectorAll<HTMLLabelElement>('.day')].find((label) =>
      label.textContent?.includes('Viernes'),
    )!;
    viernes.querySelector('input')!.click();
    const hora = form.querySelector<HTMLInputElement>('input[type="time"]')!;
    hora.value = '06:30';
    hora.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    botón('Guardar programación').click();
    await asentar();

    expect(programaciones).toHaveLength(1);
    expect(programaciones[0]).toMatchObject({
      frequency: 'Weekly',
      time: '06:30',
      days: ['Monday', 'Friday'],
      paused: false,
    });
    expect(programaciones[0].timeZone).toBeTruthy();
    expect(el('form.schedule')).toBeNull();
    expect(el('.freshness__schedule').textContent).toContain('Próxima actualización');
    expect(botón('Programación')).toBeTruthy();
  });

  it('no deja guardar una semanal sin días, y la pausa se dice en la barra', async () => {
    programada = {
      frequency: 'Daily',
      time: '07:00',
      days: [],
      timeZone: 'UTC',
      paused: false,
      nextRunUtc: '2026-11-13T07:00:00Z',
    };
    await crear();
    expect(el('.freshness__schedule').textContent).toContain('Próxima actualización');

    botón('Programación').click();
    fixture.detectChanges();
    botón('Semanal').click();
    fixture.detectChanges();
    el<HTMLInputElement>('.day input').click();
    fixture.detectChanges();
    expect(el('.schedule .field__error').textContent).toContain('al menos un día');
    expect(botón('Guardar programación').disabled).toBe(true);

    botón('Diaria').click();
    el<HTMLInputElement>('form.schedule .check input').click();
    fixture.detectChanges();
    botón('Guardar programación').click();
    await asentar();

    expect(programaciones[0]).toMatchObject({ frequency: 'Daily', days: [], paused: true });
    expect(el('.freshness__schedule').textContent).toContain('en pausa');
  });

  it('una actualización programada que llega con el conjunto abierto aparece sola', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-13T06:59:00Z'));

    try {
      programada = {
        frequency: 'Daily',
        time: '07:00',
        days: [],
        timeZone: 'UTC',
        paused: false,
        nextRunUtc: '2026-11-13T07:00:00Z',
      };
      await crear();
      const antes = lecturas;

      // Pasa la hora: el servidor la despachó y el origen falló.
      intentos = [
        intento('Failed', {
          origin: 'Scheduled',
          startedAtUtc: '2026-11-13T07:00:05Z',
          message: 'No se pudo leer alguna fuente. Se conserva el resultado anterior.',
        }),
      ];
      programada = {
        ...programada,
        nextRunUtc: '2026-11-14T07:00:00Z',
        retryAtUtc: '2026-11-13T07:05:06Z',
      };
      await vi.advanceTimersByTimeAsync(63_000);
      await asentar();

      expect(el('.banner--danger').textContent).toContain('La actualización programada del');
      expect(el('.freshness__schedule').textContent).toContain('se reintenta');
      expect(lecturas).toBe(antes);

      // El reintento salió bien: el dato nuevo se lee sin reabrir nada.
      intentos = [
        intento('Succeeded', { origin: 'Scheduled', startedAtUtc: '2026-11-13T07:05:06Z' }),
        ...intentos,
      ];
      programada = { ...programada, retryAtUtc: null };
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      await asentar();

      expect(lecturas).toBe(antes + 1);
      expect(el('.banner--danger')).toBeNull();
      expect(el('.freshness__schedule').textContent).toContain('Próxima actualización');
    } finally {
      fixture.destroy();
      vi.useRealTimers();
    }
  });

  it('el historial cuenta cada intento con su origen y deja borrar los datos guardados', async () => {
    intentos = [
      intento('Failed', {
        origin: 'Scheduled',
        startedAtUtc: '2026-11-13T07:00:00Z',
        completedAtUtc: '2026-11-13T07:00:03Z',
        message: 'No se pudo leer alguna fuente.',
      }),
      intento('Succeeded', {
        startedAtUtc: '2026-11-12T09:00:00Z',
        completedAtUtc: '2026-11-12T09:01:30Z',
      }),
    ];
    await crear();

    botón('Historial').click();
    await asentar();

    const filas = [...fixture.nativeElement.querySelectorAll('.runs tbody tr')] as HTMLElement[];

    expect(filas).toHaveLength(2);
    expect(filas[0].textContent).toContain('Programada');
    expect(filas[0].textContent).toContain('Falló');
    expect(filas[0].textContent).toContain('No se pudo leer alguna fuente.');
    expect(filas[1].textContent).toContain('A mano');
    expect(filas[1].textContent).toContain('Correcta');
    expect(filas[1].textContent).toMatch(/1[,.]5\s*min/);
    expect(el('.space').textContent).toMatch(/2\s*kB/i);
    expect(el('.space').textContent).toMatch(/512\s*MB/);

    botón('Borrar datos guardados').click();
    fixture.detectChanges();
    expect(el('.space__confirm').textContent).toContain('sus reportes y su programación se quedan');
    botón('Borrar datos').click();
    await asentar();

    expect(borrados).toBe(1);
    expect(el('.freshness').textContent).toContain('Todavía no hay datos guardados');
    expect(el('.banner--success').textContent).toContain('Se borraron los datos guardados');
    expect(botón('Borrar datos guardados')).toBeUndefined();
  });

  it('el indicador con meta da 60 % y cuenta aparte el municipio sin meta', async () => {
    await crear();
    botón('Nuevo reporte').click();
    fixture.detectChanges();
    botón('Indicador').click();
    fixture.detectChanges();

    expect(el('.indicator__value').textContent?.replace(/\s/g, '')).toBe('60%');
    expect(el('.indicator').textContent).toContain('1 fila sin meta queda fuera');
  });

  it('las barras se pueden leer como tabla', async () => {
    await crear();
    botón('Nuevo reporte').click();
    fixture.detectChanges();
    botón('Ver como tabla').click();
    fixture.detectChanges();

    const filas = [...fixture.nativeElement.querySelectorAll('app-report-chart tbody tr')].map(
      (row: Element) =>
        [...row.querySelectorAll('td')].map((cell) => (cell.textContent ?? '').trim()).join(' '),
    );

    expect(filas).toEqual(['05001 80', '08001 100', '11001 40']);
  });

  it('las columnas se llevan a los campos, y la cifra solo acepta números', async () => {
    await crear();
    botón('Nuevo reporte').click();
    fixture.detectChanges();

    const chips = [...fixture.nativeElement.querySelectorAll('.field-chip')].map((chip: Element) =>
      chip.textContent?.trim(),
    );
    expect(chips).toEqual(['Ventas.municipio', 'Ventas.venta', 'Metas.meta']);
    expect(el('[data-field="category"]')).not.toBeNull();
    expect(el('[data-field="value"]')).not.toBeNull();

    const workbench = fixture.componentInstance as any;
    workbench.dropOn('value', 'derecha.meta');
    fixture.detectChanges();
    expect(
      el<HTMLSelectElement>('[data-field="value"] select').selectedOptions[0].textContent?.trim(),
    ).toBe('Metas.meta');

    workbench.dropOn('value', 'izquierda.municipio');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Ventas.municipio no es un número');
    expect(
      el<HTMLSelectElement>('[data-field="value"] select').selectedOptions[0].textContent?.trim(),
    ).toBe('Metas.meta');
  });

  it('guarda el reporte con sus ajustes y lo enseña en las pestañas', async () => {
    await crear();
    botón('Nuevo reporte').click();
    fixture.detectChanges();
    botón('Guardar reporte').click();
    await asentar();

    expect(escritos).toHaveLength(1);
    expect(escritos[0]).toMatchObject({ datasetId: 'ds-1', name: 'Reporte 1', visual: 'Bar' });
    expect(JSON.parse(escritos[0].settings)).toMatchObject({
      category: 'izquierda.municipio',
      value: 'izquierda.venta',
      aggregate: 'Sum',
    });
    expect(el('.reports__tab[aria-selected="true"]').textContent).toContain('Reporte 1');
    expect(botón('Guardar reporte').disabled).toBe(true);
  });

  it('avisa de que los datos son de una versión anterior de la definición', async () => {
    guardado = { ...enero, definitionVersion: 1, fromOlderDefinition: true };
    await crear();

    expect(el('.banner--warning').textContent).toContain('versión 1 de la definición');
  });
});
