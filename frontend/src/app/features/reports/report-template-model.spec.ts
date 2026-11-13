import { ReportColumn, ReportDataset, SavedReport } from '../../shared/models/reports';
import { DEFAULT_APPEARANCE, ReportSettings } from './report-chart';
import { DashboardModel } from './report-dashboard-model';
import {
  TemplateDocument,
  captureTemplate,
  exportTemplate,
  goalStarter,
  instantiateTemplate,
  missingFields,
  panelLayout,
  parseTemplate,
  proposeAssignment,
  templateBytes,
  templateFileName,
  templateIdentity,
} from './report-template-model';

function columna(name: string, clrType: string, ordinal: number): ReportColumn {
  return { name, clrType, dataType: clrType, ordinal };
}

function conjunto(id: string, name: string): ReportDataset {
  return { id, name, version: 1, sources: [], join: null };
}

function ajustes(patch: Partial<ReportSettings>): string {
  return JSON.stringify({
    category: null,
    value: null,
    aggregate: 'Sum',
    target: null,
    columns: [],
    sort: 'category',
    appearance: DEFAULT_APPEARANCE,
    ...patch,
  });
}

/** El tablero del plan: ventas contra meta, con su color, dos páginas y filtros. */
const ventasColumnas = [
  columna('izquierda.mes', 'DateOnly', 0),
  columna('izquierda.municipio', 'String', 1),
  columna('izquierda.venta', 'Decimal', 2),
  columna('derecha.meta', 'Decimal', 3),
];

const reportes: SavedReport[] = [
  {
    id: 'cumplimiento',
    datasetId: 'ventas',
    name: 'Cumplimiento',
    visual: 'Indicator',
    settings: ajustes({
      value: 'izquierda.venta',
      target: 'derecha.meta',
      appearance: { ...DEFAULT_APPEARANCE, goodAt: 90, warnAt: 70, suffix: ' $' },
    }),
  },
  {
    id: 'por-municipio',
    datasetId: 'ventas',
    name: 'Por municipio',
    visual: 'Bar',
    settings: ajustes({
      category: 'izquierda.municipio',
      value: 'izquierda.venta',
      appearance: { ...DEFAULT_APPEARANCE, color: 'green' },
    }),
  },
  {
    id: 'detalle',
    datasetId: 'ventas',
    name: 'Detalle',
    visual: 'Table',
    settings: ajustes({ columns: ['izquierda.mes', 'izquierda.venta'] }),
  },
  { id: 'otro', datasetId: 'ventas', name: 'Sin usar', visual: 'Table', settings: ajustes({}) },
];

const tablero: DashboardModel = {
  version: 1,
  pages: [
    {
      id: 'p1',
      name: 'Resumen',
      panels: [
        {
          id: 'a',
          reportId: 'cumplimiento',
          width: 4,
          height: 3,
          title: 'Meta',
          description: 'Enero',
          hideHeader: false,
          color: 'orange',
        },
        {
          id: 'b',
          reportId: 'por-municipio',
          width: 8,
          height: 4,
          title: null,
          description: null,
          hideHeader: true,
          color: null,
        },
      ],
    },
    {
      id: 'p2',
      name: 'Detalle',
      panels: [
        {
          id: 'c',
          reportId: 'detalle',
          width: 12,
          height: 5,
          title: null,
          description: null,
          hideHeader: false,
          color: null,
        },
      ],
    },
  ],
  filters: [
    { id: 'f1', kind: 'date', label: 'Mes', bindings: { ventas: 'izquierda.mes' } },
    {
      id: 'f2',
      kind: 'category',
      label: 'Municipio',
      bindings: { ventas: 'izquierda.municipio', borrado: 'x' },
    },
  ],
  style: { color: 'violet', identityId: null },
};

function capturar(): TemplateDocument {
  return captureTemplate('Dashboard', ' Ventas contra meta ', 'Dos páginas', {
    reports: reportes,
    datasets: [conjunto('ventas', 'Ventas 2026')],
    columnsOf: () => ventasColumnas,
    layout: tablero,
  });
}

/** Otra fuente, con nombres distintos: el segundo usuario del criterio del plan. */
const pedidosColumnas = [
  columna('fecha_pedido', 'DateTime', 0),
  columna('region', 'String', 1),
  columna('monto_total', 'Decimal', 2),
  columna('objetivo', 'Decimal', 3),
];

let contador = 0;
const ids = () => `id${++contador}`;

describe('report-template-model', () => {
  beforeEach(() => (contador = 0));

  it('captura el diseño con campos lógicos y sin SQL, conexiones ni filas', () => {
    const plantilla = capturar();

    expect(plantilla.name).toBe('Ventas contra meta');
    expect(plantilla.slots).toEqual([{ label: 'Ventas 2026' }]);
    // El reporte que no está en ningún panel no entra.
    expect(plantilla.reports.map((report) => report.name)).toEqual([
      'Cumplimiento',
      'Por municipio',
      'Detalle',
    ]);
    expect(plantilla.fields.map((field) => [field.id, field.kind, field.required])).toEqual([
      ['venta', 'number', true],
      ['meta', 'number', false],
      ['municipio', 'text', true],
      ['mes', 'date', false],
    ]);
    expect(plantilla.reports[0].settings.value).toBe('venta');
    expect(plantilla.reports[0].settings.appearance.goodAt).toBe(90);
    expect(plantilla.layout?.filters[1].bindings).toEqual({ '0': 'municipio' });
    expect(plantilla.layout?.style.color).toBe('violet');

    const archivo = exportTemplate(plantilla);

    // La identidad de la empresa no viaja: las plantillas se comparten.
    const conIdentidad = captureTemplate('Dashboard', 'Con identidad', null, {
      reports: reportes,
      datasets: [conjunto('ventas', 'Ventas 2026')],
      columnsOf: () => ventasColumnas,
      layout: { ...tablero, style: { color: 'violet', identityId: 'andina' } },
    });
    expect(conIdentidad.layout?.style).toEqual({ color: 'violet', identityId: null });

    expect(archivo).not.toMatch(/izquierda\.|"sql"|connectionId|"rows"/);
    expect(parseTemplate(archivo)).toEqual({ ok: true, document: plantilla });
  });

  it('propone columnas por nombre y tipo, y después la primera libre del tipo', () => {
    const plantilla = capturar();

    expect(proposeAssignment(plantilla, 0, ventasColumnas)).toEqual({
      venta: 'izquierda.venta',
      meta: 'derecha.meta',
      municipio: 'izquierda.municipio',
      mes: 'izquierda.mes',
    });

    // Con otros nombres no hay coincidencias: se proponen por tipo, sin repetir.
    expect(proposeAssignment(plantilla, 0, pedidosColumnas)).toEqual({
      venta: 'monto_total',
      meta: 'objetivo',
      municipio: 'region',
      mes: 'fecha_pedido',
    });

    // Sin columnas de texto, el campo obligatorio queda pendiente.
    const asignacion = proposeAssignment(plantilla, 0, [columna('total', 'Int32', 0)]);

    expect(missingFields(plantilla, asignacion).map((field) => field.id)).toEqual(['municipio']);
  });

  it('aplica la plantilla a otra fuente como copia independiente con sus filtros', () => {
    const plantilla = capturar();
    const copia = instantiateTemplate(
      plantilla,
      ['pedidos'],
      proposeAssignment(plantilla, 0, pedidosColumnas),
      ids,
    );

    expect(copia.reports.map((report) => [report.datasetId, report.name])).toEqual([
      ['pedidos', 'Cumplimiento'],
      ['pedidos', 'Por municipio'],
      ['pedidos', 'Detalle'],
    ]);
    expect(JSON.parse(copia.reports[0].settings)).toEqual(
      expect.objectContaining({ value: 'monto_total', target: 'objetivo' }),
    );
    expect(JSON.parse(copia.reports[1].settings).appearance.color).toBe('green');
    expect(JSON.parse(copia.reports[2].settings).columns).toEqual(['fecha_pedido', 'monto_total']);

    const layout = copia.layout!;

    expect(layout.pages.map((page) => [page.name, page.panels.length])).toEqual([
      ['Resumen', 2],
      ['Detalle', 1],
    ]);
    expect(layout.pages[0].panels[0]).toEqual(
      expect.objectContaining({
        reportId: copia.reports[0].id,
        title: 'Meta',
        description: 'Enero',
        color: 'orange',
        width: 4,
      }),
    );
    expect(layout.pages[0].panels[1].hideHeader).toBe(true);
    expect(layout.filters.map((filter) => filter.bindings)).toEqual([
      { pedidos: 'fecha_pedido' },
      { pedidos: 'region' },
    ]);
    expect(layout.style.color).toBe('violet');
    // Ids nuevos: la copia no comparte nada con el original.
    expect(
      copia.reports.some((report) => reportes.some((original) => original.id === report.id)),
    ).toBe(false);
  });

  it('numera la copia si el conjunto ya tiene un reporte con ese nombre', () => {
    const plantilla = capturar();
    const copia = instantiateTemplate(
      plantilla,
      ['ventas'],
      proposeAssignment(plantilla, 0, ventasColumnas),
      ids,
      [
        ...reportes,
        { datasetId: 'ventas', name: 'Cumplimiento (2)' },
        { datasetId: 'otro', name: 'Detalle' },
      ],
    );

    expect(copia.reports.map((report) => report.name)).toEqual([
      'Cumplimiento (3)',
      'Por municipio (2)',
      'Detalle (2)',
    ]);
  });

  it('quita de la copia los campos opcionales sin vincular', () => {
    const plantilla = capturar();
    const copia = instantiateTemplate(
      plantilla,
      ['pedidos'],
      { venta: 'monto_total', meta: null, municipio: 'region', mes: null },
      ids,
    );

    expect(JSON.parse(copia.reports[0].settings).target).toBeNull();
    expect(JSON.parse(copia.reports[2].settings).columns).toEqual(['monto_total']);
    expect(copia.layout!.filters[0].bindings).toEqual({});
  });

  it('guarda un solo panel con su reporte y un reporte suelto', () => {
    const panel = captureTemplate('Panel', 'Barras', null, {
      reports: reportes,
      datasets: [conjunto('ventas', 'Ventas')],
      columnsOf: () => ventasColumnas,
      layout: panelLayout(tablero, 'b'),
    });

    expect(panel.reports.map((report) => report.name)).toEqual(['Por municipio']);
    expect(panel.layout?.pages[0].panels).toEqual([
      expect.objectContaining({ report: 'r1', hideHeader: true }),
    ]);
    expect(panel.layout?.filters).toEqual([]);
    expect(parseTemplate(exportTemplate(panel)).ok).toBe(true);

    const reporte = captureTemplate('Report', 'Indicador', null, {
      reports: [reportes[0]],
      datasets: [],
      columnsOf: () => ventasColumnas,
    });

    expect(reporte.layout).toBeNull();
    expect(parseTemplate(exportTemplate(reporte)).ok).toBe(true);
  });

  it('pone un hueco por conjunto cuando el tablero mezcla dos', () => {
    const gastos: SavedReport = {
      id: 'gastos',
      datasetId: 'gastos',
      name: 'Gastos',
      visual: 'Bar',
      settings: ajustes({ category: 'mes', value: 'importe' }),
    };
    const plantilla = captureTemplate('Dashboard', 'Mixto', null, {
      reports: [reportes[1], gastos],
      datasets: [conjunto('ventas', 'Ventas'), conjunto('gastos', 'Gastos')],
      columnsOf: (id) =>
        id === 'gastos'
          ? [columna('mes', 'DateOnly', 0), columna('importe', 'Decimal', 1)]
          : ventasColumnas,
      layout: {
        ...tablero,
        pages: [
          {
            id: 'p',
            name: 'Uno',
            panels: [
              tablero.pages[0].panels[1],
              { ...tablero.pages[0].panels[1], id: 'g', reportId: 'gastos' },
            ],
          },
        ],
        filters: [
          {
            id: 'f',
            kind: 'date',
            label: 'Mes',
            bindings: { ventas: 'izquierda.mes', gastos: 'mes' },
          },
        ],
      },
    });

    expect(plantilla.slots.map((slot) => slot.label)).toEqual(['Ventas', 'Gastos']);
    // «mes» lo toma primero el reporte de gastos; el del filtro de ventas pasa a «mes_2».
    expect(plantilla.layout?.filters[0].bindings).toEqual({ '0': 'mes_2', '1': 'mes' });

    const copia = instantiateTemplate(
      plantilla,
      ['a', 'b'],
      { venta: 'v', municipio: 'm', mes_2: 'f', mes: 'g', importe: 'i' },
      ids,
    );

    expect(copia.layout!.filters[0].bindings).toEqual({ a: 'f', b: 'g' });
    expect(copia.reports.map((report) => report.datasetId)).toEqual(['a', 'b']);
  });

  it('rechaza archivos que no son plantillas, con SQL o con referencias rotas', () => {
    const buena = JSON.parse(exportTemplate(capturar())) as Record<string, unknown>;
    const leer = (cambio: Record<string, unknown>) =>
      parseTemplate(JSON.stringify({ ...buena, ...cambio }));

    expect(parseTemplate('{roto')).toEqual({ ok: false, problem: 'notJson' });
    expect(parseTemplate(JSON.stringify({ name: 'x' }))).toEqual({ ok: false, problem: 'format' });
    expect(leer({ version: 2 })).toEqual({ ok: false, problem: 'version' });
    expect(leer({ scope: 'Informe' })).toEqual({ ok: false, problem: 'scope' });
    expect(leer({ name: '  ' })).toEqual({ ok: false, problem: 'name' });
    expect(leer({ slots: [{ label: 'x', connectionId: 'abc' }] })).toEqual({
      ok: false,
      problem: 'forbidden',
    });
    expect(leer({ extra: { SQL: 'DROP TABLE ventas' } })).toEqual({
      ok: false,
      problem: 'forbidden',
    });

    const reports = buena['reports'] as Record<string, unknown>[];
    const malVisual = reports.map((report, index) =>
      index === 0 ? { ...report, visual: 'Pie' } : report,
    );
    const malCampo = reports.map((report, index) =>
      index === 0
        ? { ...report, settings: { ...(report['settings'] as object), value: 'inventado' } }
        : report,
    );

    expect(leer({ reports: malVisual })).toEqual({ ok: false, problem: 'content' });
    expect(leer({ reports: malCampo })).toEqual({ ok: false, problem: 'references' });

    const layout = buena['layout'] as Record<string, unknown>;

    expect(
      leer({ layout: { ...layout, pages: [{ name: 'x', panels: [{ report: 'r99' }] }] } }),
    ).toEqual({
      ok: false,
      problem: 'references',
    });
    expect(
      parseTemplate(`{"format":"druse.report-template","pad":"${'a'.repeat(600 * 1024)}"}`),
    ).toEqual({
      ok: false,
      problem: 'tooBig',
    });
  });

  it('lleva la identidad solo si se incluyó, y solo en plantillas de tablero', () => {
    const identidad = templateIdentity(
      {
        id: '0B6C1F2E-5A4D-4C3B-9A8F-1E2D3C4B5A69',
        name: 'Comercial Andina',
        subtitle: 'Informe mensual',
        details: ['NIT 900'],
        footer: 'Confidencial',
        brandColor: '#0a6cbf',
        logoOnWhite: true,
        logoUpdatedAtUtc: '2026-11-12T10:00:00Z',
      },
      { contentType: 'image/png', data: 'iVBORw0KGgo=' },
    );
    const plantilla = { ...capturar(), identity: identidad };
    const leida = parseTemplate(exportTemplate(plantilla));

    expect(leida.ok && leida.document.identity).toEqual({
      ...identidad,
      // El id y el color se normalizan al leer.
      id: '0b6c1f2e-5a4d-4c3b-9a8f-1e2d3c4b5a69',
      brandColor: '#0A6CBF',
    });
    // El logo cuenta para el tamaño de la plantilla.
    expect(templateBytes(plantilla)).toBeGreaterThan(templateBytes(capturar()));

    // Sin incluirla, no hay clave: la plantilla es la de siempre.
    expect('identity' in capturar()).toBe(false);

    // En una plantilla de panel se ignora; con un logo que no es imagen, se rechaza.
    const panel = JSON.parse(exportTemplate(plantilla)) as Record<string, unknown>;
    const deTablero = (cambio: Record<string, unknown>) =>
      parseTemplate(JSON.stringify({ ...panel, ...cambio }));
    const unPanel = (panel['layout'] as { pages: { panels: unknown[] }[] }).pages[0].panels[0];
    const comoPanel = parseTemplate(
      JSON.stringify({
        ...panel,
        scope: 'Panel',
        layout: { ...(panel['layout'] as object), pages: [{ name: '', panels: [unPanel] }] },
      }),
    );

    expect(comoPanel.ok && comoPanel.document.identity).toBeUndefined();
    expect(
      deTablero({
        identity: { ...identidad, logo: { contentType: 'image/svg+xml', data: 'PHN2Zz4=' } },
      }),
    ).toEqual({ ok: false, problem: 'content' });
    expect(deTablero({ identity: { ...identidad, id: 'andina' } })).toEqual({
      ok: false,
      problem: 'content',
    });
    expect(deTablero({ identity: { ...identidad, details: ['a', 'b', 'c', 'd'] } })).toEqual({
      ok: false,
      problem: 'content',
    });
  });

  it('normaliza tamaños y colores de un archivo editado a mano', () => {
    const buena = JSON.parse(exportTemplate(capturar())) as {
      layout: { pages: { panels: Record<string, unknown>[] }[] };
    };

    buena.layout.pages[0].panels[0] = {
      ...buena.layout.pages[0].panels[0],
      width: 99,
      height: -3,
      color: 'fucsia',
    };

    const leida = parseTemplate(JSON.stringify(buena));

    expect(leida.ok && leida.document.layout?.pages[0].panels[0]).toEqual(
      expect.objectContaining({ width: 12, height: 2, color: null }),
    );
  });

  it('ofrece un diseño inicial válido que se vincula por tipo', () => {
    const inicial = goalStarter({
      name: 'Seguimiento',
      description: 'Una cifra contra su meta',
      page: 'Resumen',
      indicator: 'Cumplimiento',
      byCategory: 'Por categoría',
      overTime: 'En el tiempo',
      detail: 'Detalle',
      dateFilter: 'Fecha',
      categoryFilter: 'Categoría',
    });

    expect(parseTemplate(exportTemplate(inicial))).toEqual({ ok: true, document: inicial });

    const asignacion = proposeAssignment(inicial, 0, pedidosColumnas);

    expect(missingFields(inicial, asignacion)).toEqual([]);
    expect(asignacion).toEqual({
      cifra: 'monto_total',
      meta: 'objetivo',
      categoria: 'region',
      fecha: 'fecha_pedido',
    });
  });

  it('propone un nombre de archivo sin caracteres prohibidos', () => {
    expect(templateFileName('Ventas: 2026/Q1')).toBe('Ventas 2026 Q1.druse-plantilla.json');
    expect(templateFileName('   ')).toBe('plantilla.druse-plantilla.json');
  });
});
