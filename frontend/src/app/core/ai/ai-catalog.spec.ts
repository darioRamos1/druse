import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { ApplicationGateway } from '../application-gateway/application-gateway';
import { DatabaseColumn, DatabaseObject, TableStructure } from '../../shared/models/workspace';
import { AiCatalog, AiCatalogTarget } from './ai-catalog';

const table: DatabaseObject = {
  id: 't',
  name: 'facturas',
  kind: 'table',
  schema: 'ventas',
  database: 'bd',
  hasChildren: true,
};
const columns: readonly DatabaseColumn[] = [
  { name: 'id', dataType: 'INTEGER', isNullable: false, isPrimaryKey: true, ordinal: 0 },
];
const structure: TableStructure = {
  primaryKey: { name: 'pk', columns: ['id'] },
  indexes: [],
  foreignKeys: [],
  uniqueConstraints: [],
  checkConstraints: [],
};
const target: AiCatalogTarget = {
  source: { connectionId: 'c1', connectionName: 'Pruebas', database: 'bd', engine: 'sqlite' },
  sessionId: 's1',
  revision: 0,
};

describe('AiCatalog', () => {
  let catalog: AiCatalog;
  let gateway: {
    getDatabases: ReturnType<typeof vi.fn>;
    getChildren: ReturnType<typeof vi.fn>;
    getColumns: ReturnType<typeof vi.fn>;
    getTableStructure: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    gateway = {
      getDatabases: vi.fn(() =>
        of([{ id: 'bd', name: 'bd', kind: 'database', hasChildren: true }]),
      ),
      getChildren: vi.fn((_: string, parent: DatabaseObject) =>
        of(
          parent.kind === 'database'
            ? [{ id: 'schema', name: 'ventas', kind: 'schema', hasChildren: true }]
            : [table, { ...table, id: 'view', name: 'resumen', kind: 'view' }],
        ),
      ),
      getColumns: vi.fn(() => of(columns)),
      getTableStructure: vi.fn(() => of(structure)),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    });
    catalog = TestBed.inject(AiCatalog);
    catalog.activate(target);
  });

  afterEach(() => catalog.pause());

  it('enumera tablas y vistas sin desplegar el árbol ni leer columnas de objetos no elegidos', async () => {
    await catalog.loadCatalog();
    expect(catalog.catalog().map((item) => item.name)).toEqual(['facturas', 'resumen']);
    expect(gateway.getChildren).toHaveBeenCalledTimes(2);
    expect(gateway.getColumns).not.toHaveBeenCalled();
    expect(gateway.getTableStructure).not.toHaveBeenCalled();
    expect(catalog.selected()).toEqual([]);
  });

  it('lee la tabla seleccionada y propone sus referencias sin añadirlas automáticamente', async () => {
    const customers = { ...table, id: 'c', name: 'clientes' };
    gateway.getChildren.mockImplementation((_: string, parent: DatabaseObject) =>
      of(parent.kind === 'database' ? [table, customers] : []),
    );
    gateway.getTableStructure.mockReturnValue(
      of({
        ...structure,
        foreignKeys: [
          {
            name: 'fk',
            columns: ['cliente'],
            referencedTable: 'clientes',
            referencedColumns: ['id'],
            onDelete: 'noAction',
            onUpdate: 'noAction',
          },
        ],
      }),
    );
    await catalog.loadCatalog();
    catalog.add(table);
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    expect(catalog.described().schema).toContain('REFERENCES "ventas"."clientes"');
    expect(catalog.suggestions()).toEqual([customers]);
    expect(catalog.selected()).toHaveLength(1);
  });

  it('las vistas cargan columnas sin pedir la estructura reservada a tablas', async () => {
    catalog.add({ ...table, kind: 'view' });
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    expect(catalog.described().schema).toContain('VIEW');
    expect(gateway.getTableStructure).not.toHaveBeenCalled();
  });

  it('conserva separadas las tablas homónimas de distintos esquemas', async () => {
    catalog.add(table);
    catalog.add({ ...table, schema: 'archivo' });
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    expect(catalog.names()).toEqual(['"ventas"."facturas"', '"archivo"."facturas"']);
    catalog.remove(table);
    expect(catalog.selected()[0].table.schema).toBe('archivo');
  });

  it('relee la selección antes de enviar y no conserva columnas antiguas', async () => {
    catalog.add(table);
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    gateway.getColumns.mockReturnValue(of([{ ...columns[0], name: 'nuevo' }]));
    expect(await catalog.refreshSelected()).toBe(true);
    expect(catalog.described().schema).toContain('"nuevo"');
    expect(catalog.described().schema).not.toContain('"id" INTEGER');
  });

  it('avisa de permisos insuficientes y descarta la estructura anterior', async () => {
    catalog.add(table);
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    gateway.getColumns.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Sin permiso' } })),
    );
    await catalog.refreshSelected();
    expect(catalog.failures()[0].error).toContain('Sin permiso');
    expect(catalog.allowPartial()).toBe(false);
    expect(catalog.described().schema).toBe('');
    expect(catalog.warnings()[0]).toContain('facturas');
  });

  it('un objeto sin columnas no se declara como una tabla vacía válida', async () => {
    gateway.getColumns.mockReturnValue(of([]));
    catalog.add(table);
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    expect(catalog.failures()).toHaveLength(1);
    expect(gateway.getTableStructure).not.toHaveBeenCalled();
  });

  it('cambiar de base cancela lecturas y no incorpora respuestas tardías', async () => {
    const pending = new Subject<readonly DatabaseColumn[]>();
    gateway.getColumns.mockReturnValue(pending);
    catalog.add(table);
    expect(pending.observed).toBe(true);
    catalog.activate({ ...target, source: { ...target.source, database: 'otra' } });
    expect(pending.observed).toBe(false);
    pending.next(columns);
    expect(catalog.selected()).toEqual([]);
    expect(gateway.getTableStructure).not.toHaveBeenCalled();
  });

  it('recupera la selección por conexión y base y la relee tras reconectar o invalidar', async () => {
    catalog.add(table);
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    catalog.activate({ ...target, source: { ...target.source, connectionId: 'c2' } });
    expect(catalog.selected()).toEqual([]);
    catalog.activate({ ...target, sessionId: 's2', revision: 1 });
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    expect(catalog.selected()).toHaveLength(1);
    expect(gateway.getColumns).toHaveBeenLastCalledWith('s2', table);
    catalog.activate({ ...target, sessionId: 's2', revision: 2 });
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    expect(gateway.getColumns).toHaveBeenCalledTimes(3);
  });

  it('modificar la selección durante la preparación impide darla por confirmada', async () => {
    catalog.add(table);
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    const pending = new Subject<readonly DatabaseColumn[]>();
    gateway.getColumns.mockReturnValue(pending);
    const refreshed = catalog.refreshSelected();
    catalog.remove(table);
    expect(await refreshed).toBe(false);
    expect(pending.observed).toBe(false);
  });

  it('cancelar una preparación no permite enviar después con un resultado parcial implícito', async () => {
    catalog.add(table);
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    gateway.getColumns.mockReturnValue(new Subject<readonly DatabaseColumn[]>());
    const refreshed = catalog.refreshSelected();
    catalog.pause();
    expect(await refreshed).toBe(false);
    expect(catalog.loading()).toBe(false);
  });

  it('un fallo en una rama deja visibles los objetos accesibles y explica el catálogo parcial', async () => {
    gateway.getChildren.mockImplementation((_: string, parent: DatabaseObject) =>
      parent.kind === 'database'
        ? of([table, { id: 'denied', name: 'privado', kind: 'schema', hasChildren: true }])
        : throwError(
            () => new HttpErrorResponse({ status: 403, error: { message: 'Rama restringida' } }),
          ),
    );
    await catalog.loadCatalog();
    expect(catalog.catalog()).toEqual([table]);
    expect(catalog.catalogError()).toContain('Rama restringida');
  });
});
