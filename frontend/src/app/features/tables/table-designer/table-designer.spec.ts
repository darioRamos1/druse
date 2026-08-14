import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import {
  DatabaseObject,
  IndexCapabilities,
  TableStructure,
} from '../../../shared/models/workspace';
import { TableDesigner } from './table-designer';

const schema: DatabaseObject = {
  id: 's1',
  name: 'ventas',
  kind: 'schema',
  database: 'app',
  hasChildren: true,
};

const table: DatabaseObject = {
  id: 't1',
  name: 'pedidos',
  kind: 'table',
  database: 'app',
  schema: 'ventas',
  hasChildren: true,
};

describe('TableDesigner', () => {
  let fixture: ComponentFixture<TableDesigner>;

  const store = {
    notice: signal<string | null>(null),
    tableDataTypes: vi.fn(),
    tableColumns: vi.fn(),
    tableCapabilities: vi.fn(),
    tableStructure: vi.fn(),
    previewTable: vi.fn(),
    createTable: vi.fn(),
    alterTable: vi.fn(),
  };

  /** Un motor con todo activado, para que el formulario dibuje cada campo. */
  const capaces: IndexCapabilities = {
    supportsIncludedColumns: true,
    supportsFilter: true,
    supportsSortDirection: true,
    supportsCheckConstraints: true,
    methods: ['btree', 'gin'],
    foreignKeyActions: ['noAction', 'cascade', 'setNull', 'setDefault'],
  };

  const estructura: TableStructure = {
    primaryKey: { name: 'pk_pedidos', columns: ['id'] },
    indexes: [
      {
        name: 'pk_pedidos',
        columns: [{ name: 'id', direction: 'asc' }],
        isUnique: true,
        isConstraintIndex: true,
        isPrimaryKey: true,
        includedColumns: [],
      },
      {
        name: 'ix_pedidos_total',
        columns: [{ name: 'total', direction: 'desc' }],
        isUnique: false,
        isConstraintIndex: false,
        isPrimaryKey: false,
        includedColumns: [],
      },
    ],
    foreignKeys: [
      {
        name: 'fk_pedidos_cliente',
        columns: ['cliente_id'],
        referencedTable: 'clientes',
        referencedColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'noAction',
      },
    ],
    uniqueConstraints: [{ name: 'uq_pedidos_codigo', columns: ['codigo'] }],
    checkConstraints: [
      { name: 'ck_pedidos_total', columns: [], expression: 'total > 0' },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    store.tableCapabilities.mockResolvedValue(capaces);
    store.tableStructure.mockResolvedValue(estructura);
    store.tableDataTypes.mockResolvedValue(['INT', 'NVARCHAR(255)']);
    store.tableColumns.mockResolvedValue([
      {
        name: 'id',
        dataType: 'INT',
        isNullable: false,
        isPrimaryKey: true,
        isGenerated: true,
        ordinal: 1,
      },
      {
        name: 'total',
        dataType: 'DECIMAL(12,2)',
        isNullable: false,
        isPrimaryKey: false,
        ordinal: 2,
      },
      {
        name: 'nota',
        dataType: 'NVARCHAR(255)',
        isNullable: true,
        isPrimaryKey: false,
        ordinal: 3,
      },
    ]);
    store.previewTable.mockResolvedValue(['ALTER TABLE ...']);
    store.createTable.mockResolvedValue(['CREATE TABLE ...']);
    store.alterTable.mockResolvedValue(['ALTER TABLE ...']);

    await TestBed.configureTestingModule({
      imports: [TableDesigner],
      providers: [{ provide: WorkspaceStore, useValue: store }],
    }).compileComponents();

    fixture = TestBed.createComponent(TableDesigner);
  });

  async function open(target: DatabaseObject): Promise<void> {
    fixture.componentRef.setInput('target', target);
    fixture.componentRef.setInput('connectionId', 'c1');
    fixture.detectChanges();

    // La carga encadena cuatro peticiones —tipos, capacidades, columnas y
    // estructura— y cada una solo se resuelve después de que la anterior haya
    // asentado. Van en cadena y no en paralelo a propósito: la conexión no
    // ejecuta dos cosas a la vez.
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  it('sobre un esquema empieza con una columna de identidad', async () => {
    await open(schema);

    const inputs = fixture.nativeElement.querySelectorAll('.field__input');

    expect(fixture.nativeElement.querySelector('.head__title').textContent).toContain(
      'Crear tabla',
    );
    // Nombre de la tabla, y después el nombre y el tipo de la primera columna.
    expect((inputs[1] as HTMLInputElement).value).toBe('id');
    expect(store.tableColumns).not.toHaveBeenCalled();
  });

  it('sobre una tabla carga sus columnas actuales', async () => {
    await open(table);

    expect(fixture.nativeElement.querySelector('.head__title').textContent).toContain(
      'Modificar pedidos',
    );
    expect(fixture.nativeElement.querySelectorAll('.columns__row').length).toBe(3);
  });

  it('solo envía las columnas que de verdad cambiaron', async () => {
    await open(table);

    // Cada fila tiene tres campos de texto —nombre, tipo y valor por defecto—,
    // así que el tipo de la segunda columna es el quinto de la lista.
    const inputs = [...fixture.nativeElement.querySelectorAll('.columns__row .field__input')];
    const tipoDeTotal = inputs[4] as HTMLInputElement;

    tipoDeTotal.value = 'DECIMAL(14,2)';
    tipoDeTotal.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button('Ver SQL').click();
    await fixture.whenStable();

    const enviado = store.previewTable.mock.calls[0][1];

    expect(enviado.alteredColumns.length).toBe(1);
    expect(enviado.alteredColumns[0].currentName).toBe('total');
    expect(enviado.alteredColumns[0].column.dataType).toBe('DECIMAL(14,2)');
    // Las otras dos no se tocaron: mandarlas las reescribiría sin motivo.
    expect(enviado.addedColumns).toEqual([]);
    expect(enviado.droppedColumns).toEqual([]);
  });

  it('marcar una columna existente para borrar avisa y no la quita de la lista', async () => {
    await open(table);

    const remove = fixture.nativeElement.querySelectorAll('.columns__remove');
    (remove[2] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.columns__row').length).toBe(3);
    expect(fixture.nativeElement.querySelector('.warning')).not.toBeNull();

    button('Ver SQL').click();
    await fixture.whenStable();

    expect(store.previewTable.mock.calls[0][1].droppedColumns).toEqual(['nota']);
  });

  it('no deja aplicar hasta haber visto el SQL', async () => {
    await open(table);

    expect(button('Aplicar cambios').disabled).toBe(true);

    button('Ver SQL').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(button('Aplicar cambios').disabled).toBe(false);
  });

  it('renombrar la tabla viaja como tal', async () => {
    await open(table);

    const nombre = fixture.nativeElement.querySelector('.field__input') as HTMLInputElement;
    nombre.value = 'pedidos_2026';
    nombre.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button('Ver SQL').click();
    await fixture.whenStable();

    expect(store.previewTable.mock.calls[0][1].newName).toBe('pedidos_2026');
  });

  it('enseña los índices, las claves y las restricciones que la tabla ya tiene', async () => {
    await open(table);

    tab('Índices');
    expect(items().length).toBeGreaterThan(0);

    // El índice de la clave primaria se enseña, pero no se puede quitar suelto:
    // los tres motores lo rechazan.
    const removes = items().map((item) => item.querySelector('.columns__remove'));
    expect((removes[0] as HTMLButtonElement).disabled).toBe(true);
    expect((removes[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('quitar un índice existente lo manda como borrado y avisa', async () => {
    await open(table);
    tab('Índices');

    const remove = items()[1].querySelector('.columns__remove') as HTMLButtonElement;
    remove.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.warning')).not.toBeNull();

    button('Ver SQL').click();
    await fixture.whenStable();

    expect(store.previewTable.mock.calls[0][1].droppedIndexes).toEqual(['ix_pedidos_total']);
  });

  it('modificar un índice viaja como una modificación, no como uno nuevo', async () => {
    await open(table);
    tab('Índices');

    // El segundo bloque es el índice editable; su segundo campo son las columnas.
    const columnas = items()[1].querySelectorAll('.field__input')[1] as HTMLInputElement;

    escribir(columnas, 'total, fecha');
    fixture.detectChanges();

    button('Ver SQL').click();
    await fixture.whenStable();

    const enviado = store.previewTable.mock.calls[0][1];

    expect(enviado.alteredIndexes.length).toBe(1);
    expect(enviado.alteredIndexes[0].currentName).toBe('ix_pedidos_total');
    expect(enviado.alteredIndexes[0].index.columns.map((c: { name: string }) => c.name)).toEqual([
      'total',
      'fecha',
    ]);
    expect(enviado.addedIndexes).toEqual([]);
  });

  it('una clave foránea con columnas descompensadas no llega al servidor', async () => {
    await open(table);
    tab('Claves foráneas');

    button('Añadir clave foránea').click();
    fixture.detectChanges();

    const campos = items().at(-1)!.querySelectorAll('.field__input');

    escribir(campos[1] as HTMLInputElement, 'cliente_id, sucursal_id');
    escribir(campos[2] as HTMLInputElement, 'clientes');
    escribir(campos[3] as HTMLInputElement, 'id');
    fixture.detectChanges();

    button('Ver SQL').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.previewTable).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.feedback').textContent).toContain('empareja 2');
  });

  it('el formulario solo ofrece lo que el motor admite', async () => {
    store.tableCapabilities.mockResolvedValue({
      ...capaces,
      supportsIncludedColumns: false,
      supportsFilter: false,
      methods: [],
    });

    await open(table);
    tab('Índices');

    const campos = [...items()[1].querySelectorAll('.field__input')].map((campo) =>
      campo.getAttribute('placeholder'),
    );

    expect(campos.some((texto) => texto?.includes('INCLUDE'))).toBe(false);
    expect(campos.some((texto) => texto?.includes('WHERE'))).toBe(false);
  });

  function escribir(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /**
   * Los bloques de la pestaña que se está viendo.
   *
   * Las secciones ocultas siguen en el DOM —se esconden con `hidden`, no se
   * quitan— así que buscar sin acotar mezclaría índices, claves y restricciones.
   */
  function items(): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll('.rows:not([hidden]) .rows__item')];
  }

  function tab(label: string): void {
    button(label).click();
    fixture.detectChanges();
  }

  function button(label: string): HTMLButtonElement {
    return [...fixture.nativeElement.querySelectorAll('button')].find((candidate: Element) =>
      candidate.textContent?.includes(label),
    ) as HTMLButtonElement;
  }
});
