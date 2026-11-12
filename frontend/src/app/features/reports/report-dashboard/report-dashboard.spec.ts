import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import {
  ReportDataset,
  ReportRefresh,
  ReportSnapshot,
  SavedDashboard,
  SavedReport,
  SavedReportTemplate,
} from '../../../shared/models/reports';
import { TemplateApplication } from '../report-template-gallery/report-template-gallery';
import { ReportDashboard } from './report-dashboard';

const ventas: ReportDataset = {
  id: 'ds-ventas',
  name: 'Ventas y metas',
  version: 1,
  sources: [
    { alias: 'Ventas', connectionId: 'c1', database: 'v', mode: 'Sql', sql: 'x', expectedColumns: [] },
    { alias: 'Metas', connectionId: 'c2', database: 'm', mode: 'Sql', sql: 'y', expectedColumns: [] },
  ],
  join: { keys: [{ left: 'mes', right: 'mes' }], kind: 'Left', cardinality: 'OneToOne' },
};

const visitas: ReportDataset = {
  id: 'ds-visitas',
  name: 'Visitas',
  version: 1,
  sources: [{ alias: 'Visitas', connectionId: 'c3', database: 'w', mode: 'Sql', sql: 'z', expectedColumns: [] }],
  join: null,
};

function resultado(datasetId: string, columns: ReportSnapshot['columns'], rows: ReportSnapshot['rows']): ReportSnapshot {
  return {
    datasetId,
    definitionVersion: 1,
    fromOlderDefinition: false,
    startedAtUtc: '2026-11-11T15:00:00Z',
    completedAtUtc: '2026-11-11T15:00:02Z',
    columns,
    rows,
    unmatchedLeftRows: 0,
    unmatchedRightRows: 0,
    repeatedColumns: [],
  };
}

/** Enero y febrero: el segundo mes que pide el plan para probar los filtros. */
const datosVentas = resultado(
  'ds-ventas',
  [
    { name: 'izquierda.mes', dataType: 'date', clrType: 'DateOnly', ordinal: 0 },
    { name: 'izquierda.municipio', dataType: 'text', clrType: 'String', ordinal: 1 },
    { name: 'izquierda.venta', dataType: 'numeric', clrType: 'Decimal', ordinal: 2 },
    { name: 'derecha.meta', dataType: 'numeric', clrType: 'Decimal', ordinal: 3 },
  ],
  [
    ['2026-01-01', '05001', 80, 100],
    ['2026-01-01', '08001', 100, 200],
    ['2026-01-01', '11001', 40, null],
    ['2026-02-01', '05001', 90, 100],
  ],
);

const datosVisitas = resultado(
  'ds-visitas',
  [
    { name: 'fecha', dataType: 'date', clrType: 'DateOnly', ordinal: 0 },
    { name: 'visitas', dataType: 'int', clrType: 'Int32', ordinal: 1 },
  ],
  [
    ['2026-01-10', 3],
    ['2026-02-10', 4],
  ],
);

const reportes: SavedReport[] = [
  {
    id: 'r-barras',
    datasetId: 'ds-ventas',
    name: 'Ventas por municipio',
    visual: 'Bar',
    settings: JSON.stringify({ category: 'izquierda.municipio', value: 'izquierda.venta', aggregate: 'Sum' }),
  },
  {
    id: 'r-indicador',
    datasetId: 'ds-ventas',
    name: 'Cumplimiento',
    visual: 'Indicator',
    settings: JSON.stringify({ value: 'izquierda.venta', target: 'derecha.meta', aggregate: 'Sum' }),
  },
  {
    id: 'r-visitas',
    datasetId: 'ds-visitas',
    name: 'Visitas',
    visual: 'Indicator',
    settings: JSON.stringify({ value: 'visitas', aggregate: 'Sum' }),
  },
];

function tablero(model: object, guardado = true): SavedDashboard {
  return {
    id: 'tab-1',
    name: 'Comercial',
    model: JSON.stringify(model),
    ...(guardado ? { createdAtUtc: '2026-11-11T15:00:00Z' } : {}),
  };
}

const conTresPaneles = {
  version: 1,
  pages: [
    {
      id: 'p1',
      name: 'Página 1',
      panels: [
        { id: 'a', reportId: 'r-barras', width: 6, height: 4 },
        { id: 'b', reportId: 'r-indicador', width: 3, height: 3 },
        { id: 'c', reportId: 'r-visitas', width: 3, height: 3 },
      ],
    },
  ],
  filters: [
    { id: 'f-mes', kind: 'date', label: 'Mes', bindings: { 'ds-ventas': 'izquierda.mes', 'ds-visitas': 'fecha' } },
    { id: 'f-mun', kind: 'category', label: 'Municipio', bindings: { 'ds-ventas': 'izquierda.municipio' } },
  ],
};

describe('ReportDashboard', () => {
  let fixture: ComponentFixture<ReportDashboard>;
  let guardados: SavedDashboard[];
  let actualizados: string[];
  let borrados: string[];
  let plantillas: SavedReportTemplate[];
  let reportesNuevos: SavedReport[];

  async function asentar(): Promise<void> {
    for (let intento = 0; intento < 30; intento++) {
      await Promise.resolve();
    }

    fixture.detectChanges();
  }

  function el<T extends Element = HTMLElement>(selector: string): T {
    return fixture.nativeElement.querySelector(selector) as T;
  }

  function todos(selector: string): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
  }

  function botón(texto: string): HTMLButtonElement {
    return todos('button').find((button) => (button.textContent ?? '').trim().startsWith(texto)) as HTMLButtonElement;
  }

  /** El selector «Añadir reporte», por su etiqueta y no por su posición en el inspector. */
  function selectorDeReportes(): HTMLSelectElement {
    return todos('.inspector label.field')
      .find((label) => label.textContent?.includes('Añadir reporte'))!
      .querySelector('select')!;
  }

  function cifra(panel: number): string {
    return (todos('.panel')[panel].querySelector('.indicator__value')?.textContent ?? '').replace(/\s/g, '');
  }

  async function crear(dashboard: SavedDashboard): Promise<void> {
    fixture = TestBed.createComponent(ReportDashboard);
    fixture.componentRef.setInput('dashboard', dashboard);
    fixture.componentRef.setInput('datasets', [ventas, visitas]);
    fixture.componentInstance.saved.subscribe((saved) => guardados.push(saved));
    fixture.detectChanges();
    await asentar();
  }

  beforeEach(async () => {
    guardados = [];
    actualizados = [];
    borrados = [];
    plantillas = [];
    reportesNuevos = [];

    const resultados = new Map([
      ['ds-ventas', datosVentas],
      ['ds-visitas', datosVisitas],
    ]);
    const gateway = {
      getAllReports: () => of(reportes),
      getReportSnapshot: (id: string) => of(resultados.get(id) ?? null),
      refreshReportDataset: (id: string): Observable<ReportRefresh> => {
        actualizados.push(id);
        return of({ outcome: id === 'ds-visitas' ? 'Failed' : 'Refreshed', run: null });
      },
      saveDashboard: (dashboard: SavedDashboard): Observable<SavedDashboard> =>
        of({ ...dashboard, createdAtUtc: '2026-11-11T16:00:00Z' }),
      deleteDashboard: (id: string) => {
        borrados.push(id);
        return of(undefined);
      },
      saveReportTemplate: (template: SavedReportTemplate): Observable<SavedReportTemplate> => {
        plantillas.push(template);
        return of(template);
      },
      saveReport: (report: SavedReport): Observable<SavedReport> => {
        reportesNuevos.push(report);
        return of(report);
      },
    };

    await TestBed.configureTestingModule({
      imports: [ReportDashboard],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();
  });

  it('pinta cada panel con el resultado guardado de su conjunto', async () => {
    await crear(tablero(conTresPaneles));

    const paneles = todos('.panel');

    expect(paneles).toHaveLength(3);
    expect(paneles[0].style.gridColumn).toBe('span 6');
    expect(paneles[0].querySelectorAll('.chart__bar')).toHaveLength(3);
    // Sin filtros: (80 + 100 + 90) / (100 + 200 + 100).
    expect(cifra(1)).toBe('67,5%');
    expect(cifra(2)).toBe('7');
    expect(paneles[0].querySelector('.panel__meta')?.textContent).toContain('Ventas y metas');
  });

  it('el filtro de mes se aplica a los dos conjuntos por su propia columna', async () => {
    await crear(tablero(conTresPaneles));

    const [desde, hasta] = todos('.filter input[type="date"]') as HTMLInputElement[];

    desde.value = '2026-01-01';
    desde.dispatchEvent(new Event('change'));
    hasta.value = '2026-01-31';
    hasta.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // Enero: el 60 % del plan, y 3 visitas.
    expect(cifra(1)).toBe('60%');
    expect(cifra(2)).toBe('3');
    expect(botón('Quitar filtros')).toBeTruthy();
  });

  it('el filtro de categoría dice qué panel no puede aplicarlo', async () => {
    await crear(tablero(conTresPaneles));

    const municipio = el<HTMLSelectElement>('.filter select');
    const opciones = [...municipio.options].map((option) => option.textContent?.trim());

    expect(opciones).toEqual(['Todos', '05001', '08001', '11001']);

    municipio.value = 'v05001';
    municipio.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(todos('.panel')[0].querySelectorAll('.chart__bar')).toHaveLength(1);
    expect(todos('.panel')[2].querySelector('.panel__badge')?.textContent).toContain('Sin filtrar por: Municipio');
    expect(todos('.panel')[0].querySelector('.panel__badge')).toBeNull();
  });

  it('en edición se ordena y redimensiona con botones y con el teclado', async () => {
    await crear(tablero(conTresPaneles));
    botón('Editar diseño').click();
    fixture.detectChanges();

    const primero = todos('.panel')[0];

    primero.querySelector<HTMLButtonElement>('button[aria-label="Más ancho"]')!.click();
    fixture.detectChanges();
    expect(todos('.panel')[0].style.gridColumn).toBe('span 7');

    todos('.panel')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true }));
    fixture.detectChanges();
    expect(todos('.panel').map((panel) => panel.getAttribute('aria-label'))).toEqual([
      'Cumplimiento',
      'Ventas por municipio',
      'Visitas',
    ]);

    todos('.panel')[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
    fixture.detectChanges();
    expect(todos('.panel')[1].style.gridRow).toBe('span 5');
  });

  it('un tablero nuevo se abre en edición, añade un reporte y propone la columna del filtro', async () => {
    await crear(tablero({ version: 1, pages: [{ id: 'p1', name: 'Página 1', panels: [] }], filters: [] }, false));

    expect(el('.board__name')).toBeTruthy();

    botón('Filtro de fecha').click();
    fixture.detectChanges();

    const añadir = selectorDeReportes();

    añadir.value = 'r-visitas';
    añadir.dispatchEvent(new Event('change'));
    await asentar();

    const vinculo = el<HTMLSelectElement>('.filter-edit select');

    expect(vinculo.value).toBe('fecha');

    botón('Guardar tablero').click();
    await asentar();

    expect(guardados).toHaveLength(1);
    const modelo = JSON.parse(guardados[0].model);

    expect(modelo.pages[0].panels[0]).toMatchObject({ reportId: 'r-visitas', width: 6, height: 4 });
    expect(modelo.filters[0]).toMatchObject({ kind: 'date', label: 'Fecha', bindings: { 'ds-visitas': 'fecha' } });
  });

  it('pulsar una barra filtra todo el tablero por su categoría, y pulsarla otra vez lo quita', async () => {
    await crear(tablero(conTresPaneles));

    const barras = todos('.panel')[0].querySelectorAll<SVGPathElement>('.chart__bar');

    expect(barras[0].getAttribute('role')).toBe('button');
    // 05001 es la primera barra: el indicador pasa a medir solo ese municipio.
    barras[0].dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    expect(el<HTMLSelectElement>('.filter select').value).toBe('v05001');
    expect(cifra(1)).toBe('85%');
    const despues = todos('.panel')[0].querySelectorAll('.chart__bar');

    expect(despues).toHaveLength(1);
    expect(despues[0].getAttribute('aria-pressed')).toBe('true');

    despues[0].dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    expect(el<HTMLSelectElement>('.filter select').value).toBe('');
    expect(todos('.panel')[0].querySelectorAll('.chart__bar')).toHaveLength(3);
  });

  it('la descripción se escribe en el panel seleccionado, también al cambiar de selección', async () => {
    await crear(tablero(conTresPaneles));
    botón('Editar diseño').click();
    fixture.detectChanges();

    // Primero uno, después el color del tablero y después otro panel: lo que
    // hizo el barrido cuando la descripción acabó en el panel equivocado.
    todos('.panel')[0].click();
    fixture.detectChanges();
    const color = el<HTMLSelectElement>('#board-color');

    color.value = 'aqua';
    color.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // Sin repintar entre el clic y la escritura: el inspector todavía enseña el
    // panel anterior, y aun así lo escrito va al que se acaba de seleccionar.
    const descripcion = todos('.inspector label.field')
      .find((label) => label.textContent?.trim().startsWith('Descripción'))!
      .querySelector('input')!;

    todos('.panel')[1].click();
    descripcion.value = 'Ventas sobre metas';
    descripcion.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(todos('.panel')[1].querySelector('.panel__description')?.textContent).toContain('Ventas sobre metas');
    expect(todos('.panel')[0].querySelector('.panel__description')).toBeNull();
  });

  it('el panel dice de dónde hereda su color y deja volver a lo heredado', async () => {
    await crear(
      tablero({
        ...conTresPaneles,
        style: { color: 'aqua' },
        pages: [{ ...conTresPaneles.pages[0], panels: [{ ...conTresPaneles.pages[0].panels[0], color: 'red' }] }],
      }),
    );
    botón('Editar diseño').click();
    fixture.detectChanges();
    todos('.panel')[0].click();
    fixture.detectChanges();

    expect(el('.inspector').textContent).toContain('Elegido para este panel: Rojo.');
    expect(todos('.panel')[0].querySelector('.chart__bar')?.getAttribute('style')).toContain('--rc-red');

    botón('Volver al color heredado').click();
    fixture.detectChanges();

    expect(el('.inspector').textContent).toContain('Heredado del tablero: Turquesa.');
    expect(todos('.panel')[0].querySelector('.chart__bar')?.getAttribute('style')).toContain('--rc-aqua');
  });

  it('un tablero recién guardado se borra también en el servidor', async () => {
    await crear(tablero({ version: 1, pages: [{ id: 'p1', name: 'Página 1', panels: [] }], filters: [] }, false));
    const añadir = selectorDeReportes();

    añadir.value = 'r-visitas';
    añadir.dispatchEvent(new Event('change'));
    await asentar();
    botón('Guardar tablero').click();
    await asentar();

    botón('Editar diseño').click();
    fixture.detectChanges();
    botón('Borrar este tablero').click();
    fixture.detectChanges();
    todos('.inspector button').find((button) => button.textContent?.trim() === 'Borrar')!.click();
    await asentar();

    expect(borrados).toEqual(['tab-1']);
  });

  it('actualizar todo actualiza cada conjunto y dice cuáles fallaron', async () => {
    await crear(tablero(conTresPaneles));
    botón('Actualizar todo').click();
    await asentar();

    expect(actualizados).toEqual(['ds-ventas', 'ds-visitas']);
    expect(el('.banner--success').textContent).toContain('No se pudieron actualizar: Visitas');
  });

  it('guarda el tablero como plantilla con sus campos y sin SQL', async () => {
    await crear(tablero(conTresPaneles));
    botón('Guardar como plantilla').click();
    fixture.detectChanges();

    const nombre = el<HTMLInputElement>('.template-form input');

    expect(nombre.value).toBe('Comercial');
    nombre.value = 'Comercial base';
    nombre.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    botón('Guardar plantilla').click();
    await asentar();

    expect(plantillas).toHaveLength(1);
    expect(plantillas[0]).toEqual(expect.objectContaining({ name: 'Comercial base', scope: 'Dashboard' }));

    const modelo = JSON.parse(plantillas[0].model);

    // Dos conjuntos, dos huecos; los campos sin el prefijo del cruce.
    expect(modelo.slots.map((slot: { label: string }) => slot.label)).toEqual(['Ventas y metas', 'Visitas']);
    expect(modelo.fields.map((field: { name: string }) => field.name)).toEqual(
      expect.arrayContaining(['municipio', 'venta', 'meta', 'visitas', 'mes', 'fecha']),
    );
    expect(plantillas[0].model).not.toMatch(/"sql"|connectionId|ds-ventas|izquierda\./);
    expect(el('.banner--success').textContent).toContain('Plantilla «Comercial base» guardada.');
  });

  it('añade los paneles de una plantilla a la página y crea sus reportes', async () => {
    await crear(tablero(conTresPaneles));
    botón('Editar diseño').click();
    fixture.detectChanges();

    const panel = {
      format: 'druse.report-template',
      version: 1,
      scope: 'Panel',
      name: 'Barras',
      description: null,
      slots: [{ label: '' }],
      fields: [{ id: 'cat', slot: 0, name: 'cat', kind: 'text', required: true }, { id: 'num', slot: 0, name: 'num', kind: 'number', required: true }],
      reports: [{ key: 'r1', slot: 0, name: 'Visitas por municipio', visual: 'Bar', settings: { category: 'cat', value: 'num', aggregate: 'Sum', target: null, columns: [], sort: 'category', appearance: {} } }],
      layout: {
        pages: [{ name: '', panels: [{ report: 'r1', width: 12, height: 3, title: 'Desde plantilla', description: null, hideHeader: false, color: 'aqua' }] }],
        filters: [],
        style: { color: null },
      },
    };
    const aplicar = (fixture.componentInstance as unknown as { applyTemplate(a: TemplateApplication): Promise<void> }).applyTemplate.bind(
      fixture.componentInstance,
    );

    await aplicar({ document: panel as never, datasets: ['ds-ventas'], assignment: { cat: 'izquierda.municipio', num: 'izquierda.venta' } });
    await asentar();

    expect(reportesNuevos).toHaveLength(1);
    expect(reportesNuevos[0]).toEqual(expect.objectContaining({ datasetId: 'ds-ventas', name: 'Visitas por municipio' }));
    expect(JSON.parse(reportesNuevos[0].settings)).toEqual(
      expect.objectContaining({ category: 'izquierda.municipio', value: 'izquierda.venta' }),
    );

    const paneles = todos('.panel');

    expect(paneles).toHaveLength(4);
    expect(paneles[3].style.gridColumn).toBe('span 12');
    expect(paneles[3].querySelector('.panel__title')?.textContent).toContain('Desde plantilla');
    expect(paneles[3].querySelectorAll('.chart__bar')).toHaveLength(3);
    expect(el('.board__dirty')).toBeTruthy();
  });
});
