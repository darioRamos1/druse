import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { ReportDataset, ReportDatasetPreview } from '../../../shared/models/reports';
import { ConnectionSummary } from '../../../shared/models/workspace';
import { ReportBuilder } from './report-builder';

const conexion = {
  id: 'conn-1',
  name: 'Ventas',
  engine: 'sqlserver',
  saved: true,
} as ConnectionSummary;

function vista(overrides: Partial<ReportDatasetPreview> = {}): ReportDatasetPreview {
  return {
    sources: [
      {
        alias: 'Fuente 1',
        succeeded: true,
        failureCode: null,
        message: null,
        columns: [
          { name: 'municipio', dataType: 'varchar', clrType: 'String', ordinal: 0 },
          { name: 'venta', dataType: 'decimal', clrType: 'Decimal', ordinal: 1 },
        ],
        sampleRows: [
          ['05001', 80],
          ['11001', null],
        ],
        rowCount: 2,
        truncated: false,
        schemaChanges: [],
        startedAtUtc: '2026-11-11T15:00:00Z',
        completedAtUtc: '2026-11-11T15:00:01Z',
      },
    ],
    join: null,
    ...overrides,
  };
}

describe('ReportBuilder', () => {
  let fixture: ComponentFixture<ReportBuilder>;
  let respuesta: ReportDatasetPreview;
  let pedidos: ReportDataset[];
  let guardados: ReportDataset[];

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
    return [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => (button.textContent ?? '').trim() === texto,
    ) as HTMLButtonElement;
  }

  function escribir(selector: string, valor: string, evento: 'input' | 'change' = 'input'): void {
    const campo = el<HTMLInputElement | HTMLTextAreaElement>(selector);

    campo.value = valor;
    campo.dispatchEvent(new Event(evento));
    fixture.detectChanges();
  }

  /** Una fuente SQL lista para leer, en la base `ventas`. */
  async function prepararFuente(): Promise<void> {
    botón('Añadir fuente').click();
    await asentar();
    escribir('input[list^="reports-databases"]', 'ventas', 'change');
    escribir('textarea.sql', 'SELECT municipio, SUM(importe) AS venta FROM ventas GROUP BY municipio');
  }

  beforeEach(async () => {
    respuesta = vista();
    pedidos = [];
    guardados = [];

    const gateway = {
      getReportDatasets: () => of([]),
      getReportSourceDatabases: () => of({ databases: ['ventas', 'metas'], failureCode: null, message: null }),
      getCompositions: () => of([]),
      previewReportDataset: (dataset: ReportDataset): Observable<ReportDatasetPreview> => {
        pedidos.push(dataset);
        return of(respuesta);
      },
      saveReportDataset: (dataset: ReportDataset): Observable<ReportDataset> => {
        guardados.push(dataset);
        return of({ ...dataset, version: 1 });
      },
      deleteReportDataset: () => of(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ReportBuilder],
      providers: [
        { provide: ApplicationGateway, useValue: gateway },
        { provide: WorkspaceStore, useValue: { connections: signal([conexion]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportBuilder);
    fixture.detectChanges();
    await asentar();
  });

  it('empieza vacío y pide una fuente', () => {
    expect(el('.empty__title').textContent).toContain('Nuevo conjunto de datos');
    expect(botón('Vista previa').disabled).toBe(true);
  });

  it('lee la fuente y enseña la muestra con números a la derecha y NULL marcado', async () => {
    await prepararFuente();
    botón('Vista previa').click();
    await asentar();

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].sources[0]).toMatchObject({ connectionId: 'conn-1', database: 'ventas', mode: 'Sql' });
    expect(el('.stats').textContent).toContain('2 filas');
    expect(el('td.is-number').textContent?.trim()).toBe('80');
    expect(el('td.is-null').textContent?.trim()).toBe('NULL');
  });

  it('avisa cuando la definición cambió después de la vista previa', async () => {
    await prepararFuente();
    botón('Vista previa').click();
    await asentar();
    expect(el('.banner--warning')).toBeNull();

    escribir('textarea.sql', 'SELECT municipio FROM ventas');

    expect(el('.banner--warning').textContent).toContain('Vuelve a ejecutarla');
  });

  it('guarda con las columnas leídas como esperadas', async () => {
    await prepararFuente();
    botón('Vista previa').click();
    await asentar();
    botón('Guardar').click();
    await asentar();

    expect(guardados[0].sources[0].expectedColumns).toEqual([
      { name: 'municipio', clrType: 'String' },
      { name: 'venta', clrType: 'Decimal' },
    ]);
    expect(el('.banner--success').textContent).toContain('versión 1');
    expect(el('.datasets__name').textContent).toContain('Conjunto sin nombre');
  });

  it('traduce el motivo de una fuente que no se pudo leer', async () => {
    respuesta = vista({
      sources: [{ ...vista().sources[0], succeeded: false, failureCode: 'password-missing', columns: [] }],
    });
    await prepararFuente();
    botón('Vista previa').click();
    await asentar();

    expect(el('.diagnostic--danger').textContent).toContain('no tiene la contraseña guardada');
  });

  it('con dos fuentes muestra el cruce, las claves repetidas y las cifras que no se suman', async () => {
    await prepararFuente();
    botón('Añadir fuente').click();
    await asentar();
    escribir('input[list^="reports-databases"]', 'metas', 'change');
    escribir('textarea.sql', 'SELECT municipio, meta FROM metas');

    // La segunda fuente arranca en la misma conexión que la primera.
    expect(el<HTMLSelectElement>('.inspector select').value).toBe('conn-1');

    // Sin unión todavía se puede leer: es lo que da las columnas para elegirla.
    expect(botón('Vista previa').disabled).toBe(false);
    botón('Vista previa').click();
    await asentar();
    expect(pedidos.at(-1)?.join).toBeNull();
    expect(botón('Guardar').disabled).toBe(true);

    fixture.nativeElement.querySelectorAll('.steps__item')[1].click();
    fixture.detectChanges();
    escribir('.pair input:first-child', 'municipio', 'change');
    escribir('.pair input:nth-child(3)', 'municipio', 'change');

    respuesta = vista({
      join: {
        succeeded: false,
        message: 'La fuente derecha tiene claves de unión duplicadas.',
        duplicateKeys: ['05001'],
        columns: [],
        sampleRows: [],
        rowCount: 0,
        matchedRows: 0,
        unmatchedLeftRows: 0,
        unmatchedRightRows: 0,
        repeatedColumns: [],
        isSample: false,
      },
    });
    botón('Vista previa').click();
    await asentar();

    expect(pedidos.at(-1)?.join).toEqual({
      keys: [{ left: 'municipio', right: 'municipio' }],
      kind: 'Left',
      cardinality: 'OneToOne',
    });
    expect(el('.keys').textContent).toContain('05001');

    respuesta = vista({
      join: {
        succeeded: true,
        message: null,
        duplicateKeys: [],
        columns: [
          { name: 'izquierda.municipio', dataType: 'varchar', clrType: 'String', ordinal: 0 },
          { name: 'derecha.meta', dataType: 'numeric', clrType: 'Decimal', ordinal: 1 },
        ],
        sampleRows: [['05001', 100]],
        rowCount: 3,
        matchedRows: 2,
        unmatchedLeftRows: 1,
        unmatchedRightRows: 0,
        repeatedColumns: ['derecha.meta'],
        isSample: false,
      },
    });
    botón('Vista previa').click();
    await asentar();

    expect(el('.summary').textContent).toContain('3');
    // Las columnas se enseñan con el alias de su fuente, no como izquierda/derecha.
    expect(el('.diagnostic--warning').textContent).toContain('Fuente 2.meta');
    expect(el('th.is-repeated').textContent).toContain('Fuente 2.meta');
    expect(el('th').textContent).toContain('Fuente 1.municipio');
  });

  it('pregunta antes de cerrar con cambios sin guardar', async () => {
    const cerrado = vi.fn();

    fixture.componentInstance.closed.subscribe(cerrado);
    await prepararFuente();
    el<HTMLButtonElement>('.head button[aria-label="Cerrar"]').click();
    fixture.detectChanges();

    expect(cerrado).not.toHaveBeenCalled();
    expect(el('.confirm').textContent).toContain('cambios sin guardar');

    botón('Descartar cambios').click();

    expect(cerrado).toHaveBeenCalledOnce();
  });
});
