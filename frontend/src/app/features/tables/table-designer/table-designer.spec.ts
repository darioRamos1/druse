import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject } from '../../../shared/models/workspace';
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
    previewTable: vi.fn(),
    createTable: vi.fn(),
    alterTable: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
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

    // Dos vueltas: la carga encadena dos peticiones —tipos y columnas— y la
    // segunda solo se resuelve después de que la primera haya asentado.
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
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

  function button(label: string): HTMLButtonElement {
    return [...fixture.nativeElement.querySelectorAll('button')].find((candidate: Element) =>
      candidate.textContent?.includes(label),
    ) as HTMLButtonElement;
  }
});
