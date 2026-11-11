import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import {
  ReportDataset,
  ReportRefresh,
  ReportRun,
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

    const gateway = {
      getReportSnapshot: () => {
        lecturas++;
        return of(guardado);
      },
      getReportRuns: () => of([]),
      getSavedReports: () => of(reportes),
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
    expect(el('.banner--danger').textContent).toContain('Metas: La conexión de esta fuente ya no existe');
    expect(el('.freshness').textContent).toContain('Datos del');
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

    const filas = [...fixture.nativeElement.querySelectorAll('app-report-chart tbody tr')].map((row: Element) =>
      [...row.querySelectorAll('td')].map((cell) => (cell.textContent ?? '').trim()).join(' '),
    );

    expect(filas).toEqual(['05001 80', '08001 100', '11001 40']);
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
