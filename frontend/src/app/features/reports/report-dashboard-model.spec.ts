import { ReportColumn, ReportSnapshot, ReportValue } from '../../shared/models/reports';
import {
  DashboardFilter,
  FilterValue,
  addPanel,
  applyFilters,
  categoryOptions,
  emptyDashboard,
  movePanel,
  parseDashboard,
  proposeBinding,
  resizePanel,
} from './report-dashboard-model';

function columna(name: string, clrType: string, ordinal: number): ReportColumn {
  return { name, clrType, dataType: clrType, ordinal };
}

function resultado(columns: ReportColumn[], rows: (readonly ReportValue[])[]): ReportSnapshot {
  return {
    datasetId: 'x',
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

/** Ventas de enero y febrero, cruzadas con metas: el segundo mes del plan. */
const ventas = resultado(
  [columna('izquierda.mes', 'DateOnly', 0), columna('izquierda.municipio', 'String', 1), columna('izquierda.venta', 'Decimal', 2)],
  [
    ['2026-01-01', '05001', 80],
    ['2026-01-01', '08001', 100],
    ['2026-02-01', '05001', 90],
    ['2026-02-01', null, 5],
  ],
);

/** Otro conjunto, con la fecha y el municipio con otros nombres. */
const visitas = resultado(
  [columna('fecha', 'DateTime', 0), columna('codigo_municipio', 'String', 1), columna('visitas', 'Int32', 2)],
  [
    ['2026-01-15T10:00:00', '05001', 3],
    ['2026-02-03T09:30:00', '08001', 4],
  ],
);

const mes: DashboardFilter = {
  id: 'f-mes',
  kind: 'date',
  label: 'Mes',
  bindings: { ventas: 'izquierda.mes', visitas: 'fecha' },
};

const municipio: DashboardFilter = {
  id: 'f-mun',
  kind: 'category',
  label: 'Municipio',
  bindings: { ventas: 'izquierda.municipio' },
};

function valores(entries: [string, FilterValue][]): ReadonlyMap<string, FilterValue> {
  return new Map(entries);
}

describe('report-dashboard-model', () => {
  it('el filtro de mes se aplica a cada conjunto por su propia columna', () => {
    const febrero = valores([['f-mes', { kind: 'date', from: '2026-02-01', to: '2026-02-28' }]]);

    expect(applyFilters(ventas, 'ventas', [mes], febrero).snapshot.rows).toEqual([
      ['2026-02-01', '05001', 90],
      ['2026-02-01', null, 5],
    ]);
    // Una fecha con hora cuenta por su día.
    expect(applyFilters(visitas, 'visitas', [mes], febrero).snapshot.rows).toEqual([['2026-02-03T09:30:00', '08001', 4]]);
  });

  it('un conjunto sin columna vinculada no se filtra y lo dice', () => {
    const elegido = valores([['f-mun', { kind: 'category', values: ['05001'] }]]);
    const filtrado = applyFilters(visitas, 'visitas', [municipio], elegido);

    expect(filtrado.snapshot.rows).toHaveLength(2);
    expect(filtrado.unbound).toEqual(['Municipio']);
  });

  it('combina filtros, distingue el vacío y no filtra si no hay nada elegido', () => {
    const ambos = valores([
      ['f-mes', { kind: 'date', from: '2026-02-01', to: null }],
      ['f-mun', { kind: 'category', values: [null] }],
    ]);

    expect(applyFilters(ventas, 'ventas', [mes, municipio], ambos).snapshot.rows).toEqual([['2026-02-01', null, 5]]);
    expect(applyFilters(ventas, 'ventas', [mes, municipio], valores([])).snapshot).toBe(ventas);
  });

  it('ofrece los valores de todas las columnas vinculadas, con el vacío al final', () => {
    const opciones = categoryOptions(
      { ...municipio, bindings: { ventas: 'izquierda.municipio', visitas: 'codigo_municipio' } },
      new Map([
        ['ventas', ventas],
        ['visitas', visitas],
      ]),
    );

    expect(opciones).toEqual(['05001', '08001', null]);
  });

  it('propone la columna que se llama como las ya vinculadas, y si no la primera del tipo', () => {
    const metas = [columna('derecha.region', 'String', 0), columna('derecha.municipio', 'String', 1)];

    expect(proposeBinding(municipio, metas)).toBe('derecha.municipio');
    expect(proposeBinding({ ...municipio, bindings: {} }, metas)).toBe('derecha.region');
    expect(proposeBinding(mes, metas)).toBeNull();
  });

  it('ordena y redimensiona paneles dentro de los límites de la cuadrícula', () => {
    let modelo = emptyDashboard('Página 1');
    const pagina = modelo.pages[0].id;

    modelo = addPanel(addPanel(modelo, pagina, 'r1'), pagina, 'r2');
    const [primero, segundo] = modelo.pages[0].panels;

    modelo = movePanel(modelo, pagina, segundo.id, -1);
    expect(modelo.pages[0].panels.map((panel) => panel.reportId)).toEqual(['r2', 'r1']);
    expect(movePanel(modelo, pagina, segundo.id, -1)).toEqual(modelo);

    modelo = resizePanel(modelo, pagina, primero.id, 20, -20);
    expect(modelo.pages[0].panels[1]).toMatchObject({ width: 12, height: 2 });
  });

  it('lee un modelo roto o a medias sin fallar', () => {
    expect(parseDashboard('{roto', 'Página 1').pages).toHaveLength(1);

    const leido = parseDashboard(
      JSON.stringify({
        pages: [{ id: 'p', name: 'Ventas', panels: [{ reportId: 'r1', width: 40, height: 'alto' }, { width: 3 }] }],
        filters: [{ id: 'f', kind: 'region', label: 'X' }, { id: 'g', kind: 'date', label: 'Mes', bindings: { a: 'mes', b: 3 } }],
      }),
      'Página 1',
    );

    expect(leido.pages[0].panels).toEqual([expect.objectContaining({ reportId: 'r1', width: 12, height: 4, title: null })]);
    expect(leido.filters).toEqual([{ id: 'g', kind: 'date', label: 'Mes', bindings: { a: 'mes' } }]);
  });
});
