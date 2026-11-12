import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { ReportDataset, ReportSnapshot, SavedReportTemplate } from '../../../shared/models/reports';
import { DEFAULT_APPEARANCE } from '../report-chart';
import { captureTemplate, exportTemplate } from '../report-template-model';
import { ReportTemplateGallery, TemplateApplication } from './report-template-gallery';

const pedidos: ReportDataset = {
  id: 'ds-pedidos',
  name: 'Pedidos',
  version: 1,
  sources: [
    {
      alias: 'Pedidos',
      connectionId: 'c1',
      database: 'p',
      mode: 'Sql',
      sql: 'x',
      expectedColumns: [],
    },
  ],
  join: null,
};

const sinDatos: ReportDataset = { ...pedidos, id: 'ds-vacio', name: 'Sin actualizar' };

const datosPedidos: ReportSnapshot = {
  datasetId: 'ds-pedidos',
  definitionVersion: 1,
  fromOlderDefinition: false,
  startedAtUtc: '2026-11-11T15:00:00Z',
  completedAtUtc: '2026-11-11T15:00:02Z',
  columns: [
    { name: 'region', dataType: 'text', clrType: 'String', ordinal: 0 },
    { name: 'monto_total', dataType: 'numeric', clrType: 'Decimal', ordinal: 1 },
    { name: 'fecha_pedido', dataType: 'date', clrType: 'DateOnly', ordinal: 2 },
  ],
  rows: [],
  unmatchedLeftRows: 0,
  unmatchedRightRows: 0,
  repeatedColumns: [],
};

/** Un reporte de barras de ventas por municipio, guardado como plantilla. */
const barras = captureTemplate('Report', 'Ventas por municipio', 'Barras verdes', {
  reports: [
    {
      id: 'r',
      datasetId: 'ventas',
      name: 'Por municipio',
      visual: 'Bar',
      settings: JSON.stringify({
        category: 'municipio',
        value: 'venta',
        aggregate: 'Sum',
        target: null,
        columns: [],
        sort: 'category',
        appearance: { ...DEFAULT_APPEARANCE, color: 'green' },
      }),
    },
  ],
  datasets: [],
  columnsOf: () => [
    { name: 'municipio', dataType: 'text', clrType: 'String', ordinal: 0 },
    { name: 'venta', dataType: 'numeric', clrType: 'Decimal', ordinal: 1 },
  ],
});

describe('ReportTemplateGallery', () => {
  let fixture: ComponentFixture<ReportTemplateGallery>;
  let guardadas: SavedReportTemplate[];
  let aplicadas: TemplateApplication[];
  let plantillas: SavedReportTemplate[];

  async function asentar(): Promise<void> {
    for (let intento = 0; intento < 30; intento++) {
      await Promise.resolve();
    }

    fixture.detectChanges();
  }

  function todos(selector: string): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
  }

  function texto(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
  }

  function botón(etiqueta: string): HTMLButtonElement {
    return todos('button').find((button) =>
      (button.textContent ?? '').trim().startsWith(etiqueta),
    ) as HTMLButtonElement;
  }

  async function crear(
    scopes: SavedReportTemplate['scope'][],
    fixed: string | null = null,
  ): Promise<void> {
    fixture = TestBed.createComponent(ReportTemplateGallery);
    fixture.componentRef.setInput('scopes', scopes);
    fixture.componentRef.setInput('datasets', [pedidos, sinDatos]);
    fixture.componentRef.setInput('fixedDataset', fixed);
    fixture.componentInstance.applied.subscribe((application) => aplicadas.push(application));
    fixture.detectChanges();
    await asentar();
  }

  async function importar(contenido: string): Promise<void> {
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const archivo = new File([contenido], 'plantilla.json', { type: 'application/json' });

    Object.defineProperty(input, 'files', { value: [archivo], configurable: true });
    input.dispatchEvent(new Event('change'));
    await asentar();
  }

  beforeEach(async () => {
    guardadas = [];
    aplicadas = [];
    plantillas = [
      {
        id: 't-barras',
        name: 'Ventas por municipio',
        description: 'Barras verdes',
        scope: 'Report',
        model: JSON.stringify(barras),
      },
    ];

    const gateway = {
      getReportTemplates: () => of(plantillas),
      saveReportTemplate: (template: SavedReportTemplate): Observable<SavedReportTemplate> => {
        guardadas.push(template);
        return of({ ...template, createdAtUtc: '2026-11-11T16:00:00Z' });
      },
      deleteReportTemplate: () => of(undefined),
      getReportSnapshot: (id: string) => of(id === 'ds-pedidos' ? datosPedidos : null),
    };

    await TestBed.configureTestingModule({
      imports: [ReportTemplateGallery],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();
  });

  it('enseña el diseño inicial solo donde se crean tableros', async () => {
    await crear(['Dashboard']);
    expect(texto()).toContain('Seguimiento de una cifra');
    expect(texto()).toContain('Diseño inicial');
    expect(texto()).not.toContain('Ventas por municipio');

    await crear(['Report', 'Panel']);
    expect(texto()).not.toContain('Seguimiento de una cifra');
    expect(texto()).toContain('Ventas por municipio');
  });

  it('vincula los campos con otros nombres y devuelve la asignación', async () => {
    await crear(['Report', 'Panel'], 'ds-pedidos');

    botón('Usar').click();
    await asentar();

    expect(texto()).toContain('Usar «Ventas por municipio»');
    expect(texto()).toContain('Pedidos');

    const [municipio, venta] = todos('.fields__row select') as HTMLSelectElement[];

    // Por tipo: el texto va al texto y el número al número.
    expect(municipio.value).toBe('region');
    expect(venta.value).toBe('monto_total');
    // Una fecha no se ofrece para un campo de número.
    expect([...venta.options].map((option) => option.value)).toEqual(['', 'monto_total']);

    venta.value = '';
    venta.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(botón('Crear copia').disabled).toBe(true);
    expect(texto()).toContain('Falta elegir columna para: venta.');

    venta.value = 'monto_total';
    venta.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    botón('Crear copia').click();

    expect(aplicadas).toEqual([
      {
        document: expect.objectContaining({ name: 'Ventas por municipio' }),
        datasets: ['ds-pedidos'],
        assignment: { municipio: 'region', venta: 'monto_total' },
      },
    ]);
  });

  it('pide actualizar un conjunto que no tiene datos guardados', async () => {
    await crear(['Report']);

    botón('Usar').click();
    await asentar();

    const conjunto = fixture.nativeElement.querySelector('.slot select') as HTMLSelectElement;

    conjunto.value = 'ds-vacio';
    conjunto.dispatchEvent(new Event('change'));
    await asentar();

    expect(texto()).toContain('Este conjunto aún no tiene datos guardados');
    expect(botón('Crear copia').disabled).toBe(true);
  });

  it('importa un archivo válido tras enseñar su vista previa', async () => {
    await crear(['Report']);
    await importar(exportTemplate({ ...barras, name: 'Copia importada' }));

    expect(texto()).toContain('Importar plantilla');
    expect(texto()).toContain('Copia importada');
    expect(texto()).toContain('municipio · texto');

    botón('Guardar en mis plantillas').click();
    await asentar();

    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]).toEqual(
      expect.objectContaining({ name: 'Copia importada', scope: 'Report' }),
    );
    expect(JSON.parse(guardadas[0].model).fields).toHaveLength(2);
    expect(texto()).toContain('Plantilla «Copia importada» importada.');
  });

  it('Escape retrocede y después cierra aunque el foco se haya perdido', async () => {
    let cerrada = 0;

    await crear(['Report']);
    fixture.componentInstance.closed.subscribe(() => cerrada++);
    botón('Usar').click();
    await asentar();

    // El botón pulsado ya no existe: el foco está en el documento, no en la hoja.
    (document.activeElement as HTMLElement | null)?.blur();
    const delConstructor = vi.fn();

    document.addEventListener('keydown', delConstructor);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(texto()).toContain('Plantillas');
    expect(texto()).not.toContain('Usar «');
    expect(cerrada).toBe(0);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cerrada).toBe(1);
    // El constructor de detrás no se entera: no se cierra con la galería encima.
    expect(delConstructor).not.toHaveBeenCalled();
    document.removeEventListener('keydown', delConstructor);
  });

  it('no importa un archivo con SQL y explica por qué', async () => {
    await crear(['Report']);
    await importar(JSON.stringify({ ...barras, extra: { sql: 'DROP TABLE ventas' } }));

    expect(texto()).toContain('La plantilla trae SQL, conexiones o filas');
    expect(guardadas).toEqual([]);
  });
});
