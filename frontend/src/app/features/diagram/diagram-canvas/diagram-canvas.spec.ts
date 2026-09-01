import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DatabaseObject, SchemaGraph, TableDetail } from '../../../shared/models/workspace';
import { DiagramCanvas } from './diagram-canvas';

function table(name: string): DatabaseObject {
  return {
    id: `ventas.${name}`,
    name,
    kind: 'table',
    database: 'druse_test',
    schema: 'ventas',
    hasChildren: true,
  };
}

function column(name: string, options: { pk?: boolean; nullable?: boolean } = {}) {
  return {
    name,
    dataType: 'int8',
    inputKind: 'integer' as const,
    isNullable: options.nullable ?? false,
    isPrimaryKey: options.pk ?? false,
    isGenerated: false,
    ordinal: 1,
  };
}

function detail(
  name: string,
  columns: ReturnType<typeof column>[],
  foreignKeys: { name: string; columns: string[]; referencedTable: string }[] = [],
  primaryKey?: string[],
): TableDetail {
  return {
    table: table(name),
    columns,
    structure: {
      primaryKey: primaryKey ? { name: `pk_${name}`, columns: primaryKey } : undefined,
      indexes: [],
      foreignKeys: foreignKeys.map((key) => ({
        name: key.name,
        columns: key.columns,
        referencedSchema: 'ventas',
        referencedTable: key.referencedTable,
        referencedColumns: ['id'],
        onDelete: 'noAction' as const,
        onUpdate: 'noAction' as const,
      })),
      uniqueConstraints: [],
      checkConstraints: [],
    },
  };
}

const grafo: SchemaGraph = {
  tables: [
    detail('cliente', [column('id', { pk: true }), column('nombre')], [], ['id']),
    detail(
      'factura',
      [column('id', { pk: true }), column('cliente_id'), column('total')],
      [{ name: 'fk_factura_cliente', columns: ['cliente_id'], referencedTable: 'cliente' }],
      ['id'],
    ),
    detail('bitacora', [column('id', { pk: true }), column('mensaje')], [], ['id']),
  ],
  missing: [],
};

describe('DiagramCanvas', () => {
  let fixture: ComponentFixture<DiagramCanvas>;

  const dom = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const nodos = (): HTMLElement[] => [...dom().querySelectorAll<HTMLElement>('.node')];

  const cabecera = (name: string): HTMLElement => {
    const nodo = nodos().find((node) => node.querySelector('.node__name')?.textContent?.trim() === name);

    if (!nodo) {
      throw new Error(`No se dibujó la tabla ${name}.`);
    }

    return nodo.querySelector<HTMLElement>('.node__head')!;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DiagramCanvas] }).compileComponents();

    fixture = TestBed.createComponent(DiagramCanvas);
    fixture.componentRef.setInput('graph', grafo);
    fixture.detectChanges();
  });

  it('dibuja una caja por tabla y una línea por clave foránea', () => {
    expect(nodos()).toHaveLength(3);
    expect(dom().querySelectorAll('.wire')).toHaveLength(1);
  });

  it('el nivel de detalle cambia las columnas que se ven', () => {
    expect(dom().querySelectorAll('.row').length).toBe(7);

    const claves = [...dom().querySelectorAll<HTMLButtonElement>('.segmented__item')][1];
    claves.click();
    fixture.detectChanges();

    // Solo las que sostienen una relación: cliente.id, factura.id, factura.cliente_id
    // y bitacora.id.
    expect(dom().querySelectorAll('.row').length).toBe(4);

    const plegado = [...dom().querySelectorAll<HTMLButtonElement>('.segmented__item')][2];
    plegado.click();
    fixture.detectChanges();

    expect(dom().querySelectorAll('.row').length).toBe(0);
  });

  /**
   * Lo que hace legible un diagrama grande: marcar una tabla apaga lo que no
   * tiene que ver con ella. Apagado, no escondido.
   */
  it('marcar una tabla resalta sus vecinas y apaga el resto', () => {
    cabecera('factura').click();
    fixture.detectChanges();

    const apagados = nodos().filter((node) => node.classList.contains('is-dim'));

    expect(apagados).toHaveLength(1);
    expect(apagados[0].querySelector('.node__name')?.textContent?.trim()).toBe('bitacora');
  });

  it('volver a marcar la misma tabla apaga el resaltado', () => {
    cabecera('factura').click();
    fixture.detectChanges();
    cabecera('factura').click();
    fixture.detectChanges();

    expect(nodos().filter((node) => node.classList.contains('is-dim'))).toHaveLength(0);
  });

  it('el doble clic sobre la cabecera pide abrir la tabla', () => {
    const abiertas: DatabaseObject[] = [];
    fixture.componentInstance.openTable.subscribe((table) => abiertas.push(table));

    cabecera('cliente').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(abiertas.map((entry) => entry.name)).toEqual(['cliente']);
  });

  it('el interruptor de sugeridas no esconde ninguna clave declarada', () => {
    const toggle = dom().querySelector<HTMLButtonElement>('.toggle')!;

    toggle.click();
    fixture.detectChanges();

    expect(dom().querySelectorAll('.wire')).toHaveLength(1);
    expect(dom().querySelectorAll('.wire.is-suggested')).toHaveLength(0);
  });

  /**
   * Una tabla que ya no está en el catálogo se dice; no se calla dibujando una
   * caja menos.
   */
  it('avisa de las tablas que ya no están', () => {
    fixture.componentRef.setInput('graph', {
      tables: grafo.tables,
      missing: [table('promocion')],
    } satisfies SchemaGraph);
    fixture.detectChanges();

    expect(dom().querySelector('.missing')?.textContent).toContain('1 tabla');
  });

  it('la leyenda está siempre a la vista', () => {
    expect(dom().querySelectorAll('.legend__item')).toHaveLength(3);
  });
});
