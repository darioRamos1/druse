import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import {
  ApplicationGateway,
  SavedCompositionRecord,
} from '../../../core/application-gateway/application-gateway';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject, QueryResult } from '../../../shared/models/workspace';
import { QueryBuilder } from './query-builder';

const table: DatabaseObject = {
  id: 'table:public.orders',
  name: 'orders',
  kind: 'table',
  database: 'druse_test',
  schema: 'public',
  hasChildren: true,
};

const customer: DatabaseObject = {
  id: 'table:public.customers',
  name: 'customers',
  kind: 'table',
  database: 'druse_test',
  schema: 'public',
  hasChildren: true,
};

const customerNode = {
  id: 'connection-1|druse_test|table:public.customers',
  label: 'customers',
  kind: 'table' as const,
  depth: 5,
  expandable: true,
  expanded: false,
  loading: false,
  source: customer,
  connectionId: 'connection-1',
};

const auditCustomerNode = {
  ...customerNode,
  id: 'connection-1|druse_test|table:audit.customers',
  source: {
    ...customer,
    id: 'table:audit.customers',
    schema: 'audit',
  },
};

const foreignCustomerNode = {
  ...customerNode,
  id: 'connection-1|otra_base|table:public.customers',
  source: {
    ...customer,
    id: 'table:otra_base:public.customers',
    database: 'otra_base',
  },
};

const schemaNode = (schema: string, database = 'druse_test') => ({
  id: `connection-1|${database}|schema:${schema}`,
  label: schema,
  kind: 'schema' as const,
  depth: 2,
  expandable: true,
  expanded: false,
  loading: false,
  source: {
    id: `schema:${schema}`,
    name: schema,
    kind: 'schema' as const,
    database,
    schema,
    hasChildren: true,
  },
  connectionId: 'connection-1',
});

const relationLoads: { schema: string; connectionId?: string; database?: string }[] = [];
const relationNodes = signal([customerNode, auditCustomerNode, foreignCustomerNode]);
let tableForeignKeys: readonly Record<string, unknown>[] = [];

const store = {
  searchableRelations: relationNodes,
  searchableSchemas: () => [
    schemaNode('public'),
    schemaNode('audit'),
    schemaNode('privado', 'otra_base'),
  ],
  ensureRelationsAsync: (schema: string, connectionId?: string, database?: string) => {
    relationLoads.push({ schema, connectionId, database });

    if (schema === 'audit' && !relationNodes().some((node) => node.source.schema === 'audit')) {
      relationNodes.update((nodes) => [...nodes, auditCustomerNode]);
    }

    return Promise.resolve();
  },
  ensureColumnsAsync: (_schema: string | null, name: string) =>
    Promise.resolve(
      name === 'customers'
        ? [
            { name: 'id', dataType: 'int', isNullable: false, isPrimaryKey: true },
            { name: 'name', dataType: 'nvarchar(200)', isNullable: false, isPrimaryKey: false },
          ]
        : [
            {
              name: 'id',
              dataType: 'int',
              isNullable: false,
              isPrimaryKey: true,
              isGenerated: true,
            },
            {
              name: 'total',
              dataType: 'numeric(12,2)',
              isNullable: false,
              isPrimaryKey: false,
            },
            {
              name: 'note',
              dataType: 'nvarchar(200)',
              isNullable: true,
              isPrimaryKey: false,
            },
            {
              name: 'created_at',
              dataType: 'datetime2',
              isNullable: false,
              isPrimaryKey: false,
              defaultValue: 'sysdatetime()',
            },
          ],
    ),
  tableStructure: () => Promise.resolve({ foreignKeys: tableForeignKeys }),
  schemaGraph: (_connectionId: string, tables: readonly DatabaseObject[]) =>
    Promise.resolve({
      tables: tables.map((item) => ({
        table: item,
        columns: [],
        structure: {
          foreignKeys:
            item.name === 'orders'
              ? [
                  {
                    name: 'fk_customer',
                    columns: ['customer_id'],
                    referencedSchema: 'public',
                    referencedTable: 'customers',
                    referencedColumns: ['id'],
                  },
                ]
              : [],
        },
      })),
      missing: [],
    }),
  previewQuery: (): Promise<QueryResult | null> => Promise.resolve(null),
  cancelExecution: () => Promise.resolve(),
  countRows: () => Promise.resolve(3),
};

/**
 * La base de Druse, de mentira: una lista en memoria.
 *
 * `failing` hace que todo falle, para ver qué hace el compositor sin ella.
 */
const compositions = {
  records: [] as SavedCompositionRecord[],
  failing: false,
};

const gateway = {
  getCompositions: (
    connectionId: string,
    database: string,
    schema: string | undefined,
    name: string,
  ) =>
    compositions.failing
      ? throwError(() => new Error('sin base'))
      : of(
          compositions.records.filter(
            (record) =>
              record.connectionId === connectionId &&
              record.database === database &&
              (record.schema ?? '') === (schema ?? '') &&
              record.table === name,
          ),
        ),
  saveComposition: (record: SavedCompositionRecord) => {
    if (compositions.failing) {
      return throwError(() => new Error('sin base'));
    }
    compositions.records = [
      record,
      ...compositions.records.filter((item) => item.id !== record.id),
    ];
    return of(undefined);
  },
  deleteComposition: (id: string) => {
    if (compositions.failing) {
      return throwError(() => new Error('sin base'));
    }
    compositions.records = compositions.records.filter((item) => item.id !== id);
    return of(undefined);
  },
};

async function create(target: DatabaseObject): Promise<ComponentFixture<QueryBuilder>> {
  const fixture = TestBed.createComponent(QueryBuilder);

  fixture.componentRef.setInput('table', target);
  fixture.componentRef.setInput('engine', 'sqlserver');
  fixture.componentRef.setInput('connectionId', 'connection-1');
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

describe('QueryBuilder', () => {
  beforeEach(async () => {
    relationLoads.length = 0;
    relationNodes.set([customerNode, auditCustomerNode, foreignCustomerNode]);
    tableForeignKeys = [];
    localStorage.clear();
    compositions.records = [];
    compositions.failing = false;
    await TestBed.configureTestingModule({
      imports: [QueryBuilder],
      providers: [
        { provide: WorkspaceStore, useValue: store },
        { provide: ApplicationGateway, useValue: gateway },
      ],
    }).compileComponents();
  });

  it('ofrece formularios de escritura y plantillas estructurales para una tabla', async () => {
    const fixture = await create(table);
    const operations = [...fixture.nativeElement.querySelectorAll('.operations button')].map(
      (button: Element) => button.textContent?.trim(),
    );
    const labels = [...fixture.nativeElement.querySelectorAll('.templates button')].map(
      (button: Element) => button.textContent?.trim(),
    );

    expect(operations).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    expect(labels).toEqual(['CREATE TABLE', 'DROP TABLE']);
  });

  it('el DELETE exige condición y cuenta antes de borrar', async () => {
    const fixture = await create(table);

    const [, , , borrar] = [...fixture.nativeElement.querySelectorAll('.operations button')];
    (borrar as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sql = (fixture.nativeElement.querySelector('.sql') as HTMLTextAreaElement).value;

    // Los filtros arrancan con la clave primaria, así que ya hay condición; lo
    // que se comprueba es que el DELETE nunca sale sin ella.
    expect(sql).toContain('DELETE FROM');
    expect(sql).toContain('WHERE');
    expect(fixture.nativeElement.textContent).toContain('Contar filas afectadas');

    // Un borrado no modifica columnas: enseñar la lista de valores del UPDATE
    // haría pensar que influyen en algo.
    expect(fixture.nativeElement.textContent).not.toContain('Cambios');
    expect(fixture.nativeElement.textContent).toContain('Qué filas se borran');
  });

  it('invalida el recuento de DELETE cuando cambia una condición', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;
    const [, , , remove] = [...element.querySelectorAll<HTMLButtonElement>('.operations button')];
    remove.click();
    fixture.detectChanges();

    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Contar filas afectadas'))!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();
    // El número va en su propio `<span>`, así que el texto llega con los
    // espacios de las etiquetas: se comparan las palabras, no el espaciado.
    const dicho = () => element.textContent?.replace(/\s+/g, ' ') ?? '';

    expect(dicho()).toContain('Se borrarían 3 filas');

    const value = element.querySelector('input[aria-label="Valor del filtro"]') as HTMLInputElement;
    value.value = '42';
    value.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(dicho()).not.toContain('Se borrarían');
  });

  it('una vista solo permite componer SELECT', async () => {
    const fixture = await create({ ...table, id: 'view:public.orders', kind: 'view' });

    expect(fixture.nativeElement.querySelectorAll('.templates button').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.operations button').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.btn--primary')?.textContent).toContain(
      'Insertar SELECT en el editor',
    );
  });

  it('abre DROP TABLE con el dialecto recibido de la conexión', async () => {
    const fixture = await create(table);
    let emitted = '';

    fixture.componentInstance.insert.subscribe((sql) => (emitted = sql));

    const drop = [...fixture.nativeElement.querySelectorAll('.templates button')].find(
      (button: Element) => button.textContent?.includes('DROP TABLE'),
    ) as HTMLButtonElement;
    drop.click();

    expect(emitted).toBe('DROP TABLE [public].[orders];\n');
  });

  it('rellena un INSERT distinguiendo valor y NULL', async () => {
    const fixture = await create(table);
    let emitted = '';
    fixture.componentInstance.insert.subscribe((sql) => (emitted = sql));

    const insert = [...fixture.nativeElement.querySelectorAll('.operations button')].find(
      (button: Element) => button.textContent?.includes('INSERT'),
    ) as HTMLButtonElement;
    insert.click();
    fixture.detectChanges();

    const totalMode = fixture.nativeElement.querySelector(
      'select[aria-label="Modo para total"]',
    ) as HTMLSelectElement;
    totalMode.value = 'value';
    totalMode.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const totalValue = fixture.nativeElement.querySelector(
      'input[aria-label="Valor para total"]',
    ) as HTMLInputElement;
    totalValue.value = '12.5';
    totalValue.dispatchEvent(new Event('input'));

    const noteMode = fixture.nativeElement.querySelector(
      'select[aria-label="Modo para note"]',
    ) as HTMLSelectElement;
    noteMode.value = 'null';
    noteMode.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.btn--primary') as HTMLButtonElement).click();

    expect(emitted).toContain('INSERT INTO [public].[orders]');
    expect(emitted).toContain('VALUES (12.5, NULL)');
    expect(emitted).not.toContain('[created_at]');
  });

  it('UPDATE empieza filtrado por la clave y permite editar la vista SQL', async () => {
    const fixture = await create(table);
    let emitted = '';
    fixture.componentInstance.insert.subscribe((sql) => (emitted = sql));

    const update = [...fixture.nativeElement.querySelectorAll('.operations button')].find(
      (button: Element) => button.textContent?.includes('UPDATE'),
    ) as HTMLButtonElement;
    update.click();
    fixture.detectChanges();

    const totalMode = fixture.nativeElement.querySelector(
      'select[aria-label="Modo para total"]',
    ) as HTMLSelectElement;
    totalMode.value = 'value';
    totalMode.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement;
    expect(preview.value).toContain('WHERE [id] = /* valor obligatorio */');

    preview.value = 'UPDATE [public].[orders] SET [total] = 20 WHERE [id] = 7;';
    preview.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.btn--primary') as HTMLButtonElement).click();

    expect(emitted).toBe('UPDATE [public].[orders] SET [total] = 20 WHERE [id] = 7;');
  });

  it('compone INNER JOIN con otra tabla y permite devolver sus columnas', async () => {
    const fixture = await create(table);

    (fixture.nativeElement.querySelector('.joins-block .btn') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const rightColumn = fixture.nativeElement.querySelector(
      'select[aria-label="Columna de la tabla cruzada"]',
    ) as HTMLSelectElement;
    expect(rightColumn.value).toBe('id');

    const customerName = [...fixture.nativeElement.querySelectorAll('.join-columns label')].find(
      (label: Element) => label.textContent?.includes('name'),
    ) as HTMLLabelElement;
    customerName.click();
    fixture.detectChanges();

    const sql = (fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement).value;
    expect(sql).toContain('FROM [public].[orders] AS [t0]');
    expect(sql).toContain('INNER JOIN [public].[customers] AS [t1]');
    expect(sql).toContain('ON [t0].[id] = [t1].[id]');
    expect(sql).toContain('[t1].[name]');
  });

  it('activa GROUP BY y mantiene WHERE separado de HAVING', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;
    const grouping = element.querySelector('.grouping input[type="checkbox"]') as HTMLInputElement;

    grouping.click();
    fixture.detectChanges();

    expect(element.textContent).toContain('Condiciones HAVING');
    expect(element.textContent).toContain('Filtros WHERE');

    const aggregateFunction = element.querySelector(
      'select[aria-label="Función agregada"]',
    ) as HTMLSelectElement;
    aggregateFunction.value = 'SUM';
    aggregateFunction.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const aggregateColumn = element.querySelector(
      'select[aria-label="Columna agregada"]',
    ) as HTMLSelectElement;
    aggregateColumn.value = 'base:total';
    aggregateColumn.dispatchEvent(new Event('change'));

    const aggregateAlias = element.querySelector(
      'input[aria-label="Alias del cálculo"]',
    ) as HTMLInputElement;
    aggregateAlias.value = 'total_agrupado';
    aggregateAlias.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const addHaving = [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Añadir condición HAVING'),
    )!;
    addHaving.click();
    fixture.detectChanges();

    const value = element.querySelector('input[aria-label="Valor HAVING"]') as HTMLInputElement;
    value.value = '100';
    value.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const sql = (element.querySelector('textarea.sql') as HTMLTextAreaElement).value;
    expect(sql).toContain('SELECT TOP 100 [id], SUM([total]) AS [total_agrupado]');
    expect(sql).toContain('GROUP BY [id]');
    expect(sql).toContain('HAVING SUM([total]) > 100');
    expect(sql).not.toContain('WHERE');
  });

  it('permite agrupar y agregar columnas procedentes de un JOIN', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;

    (element.querySelector('.join-add') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    (element.querySelector('.grouping input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();

    const joinedName = [
      ...element.querySelectorAll<HTMLLabelElement>('.grouping .columns label'),
    ].find((label) => label.textContent?.includes('t1 · name'))!;
    joinedName.click();
    fixture.detectChanges();

    const sql = (element.querySelector('textarea.sql') as HTMLTextAreaElement).value;
    expect(sql).toContain('[t1].[name]');
    expect(sql).toContain('GROUP BY [t0].[id], [t1].[name]');
  });

  it('sugiere un JOIN desde una clave foránea conocida', async () => {
    tableForeignKeys = [
      {
        name: 'fk_orders_customer',
        columns: ['id'],
        referencedSchema: 'public',
        referencedTable: 'customers',
        referencedColumns: ['id'],
        onDelete: 'noAction',
        onUpdate: 'noAction',
      },
    ];
    const fixture = await create(table);
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const button = [...element.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
      candidate.textContent?.includes('id → customers'),
    )!;

    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const sql = (fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement).value;
    expect(sql).toContain('INNER JOIN [public].[customers] AS [t1]');
    expect(sql).toContain('ON [t0].[id] = [t1].[id]');
  });

  it('ejecuta una vista previa aislada con el SQL visible', async () => {
    const preview = vi.spyOn(store, 'previewQuery').mockResolvedValueOnce({
      executionId: 'preview-1',
      state: 'succeeded',
      durationMs: 3,
      resultSets: [
        {
          columns: [{ name: 'id', dataType: 'int', kind: 'number', width: null }],
          rows: [{ number: 1, values: ['7'] }],
          totalRows: 1,
          truncated: false,
          durationMs: 3,
        },
      ],
      messages: [],
    });
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;
    const button = [...element.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
      candidate.textContent?.includes('Probar con 10 filas'),
    )!;
    const sql = element.querySelector('textarea.sql') as HTMLTextAreaElement;
    sql.value = 'SELECT TOP 7 [id] FROM [public].[orders];';
    sql.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(preview).toHaveBeenCalledWith(
      'connection-1',
      'druse_test',
      'SELECT TOP 7 [id] FROM [public].[orders];',
      expect.any(String),
    );
    expect(fixture.nativeElement.querySelector('app-results-grid')).not.toBeNull();
  });

  it('guarda y vuelve a cargar una composición para la tabla', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;
    const name = element.querySelector(
      'input[aria-label="Nombre de la composición"]',
    ) as HTMLInputElement;
    name.value = 'Ventas por mes';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Guardar')!
      .click();
    fixture.detectChanges();

    expect(element.textContent).toContain('Ventas por mes');
    // En la base de Druse, no en el navegador.
    expect(compositions.records.map((record) => record.name)).toEqual(['Ventas por mes']);
    expect(compositions.records[0]).toMatchObject({
      connectionId: 'connection-1',
      database: 'druse_test',
      schema: 'public',
      table: 'orders',
    });
    expect(localStorage.length).toBe(0);
  });

  it('al abrirse lee las composiciones guardadas de su tabla', async () => {
    compositions.records = [
      {
        id: 'guardada',
        connectionId: 'connection-1',
        database: 'druse_test',
        schema: 'public',
        table: 'orders',
        name: 'De la base',
        model: JSON.stringify({ sql: 'SELECT 1;' }),
      },
      {
        id: 'otra-tabla',
        connectionId: 'connection-1',
        database: 'druse_test',
        schema: 'public',
        table: 'customers',
        name: 'De otra tabla',
        model: JSON.stringify({ sql: 'SELECT 2;' }),
      },
    ];

    const fixture = await create(table);

    expect(fixture.nativeElement.textContent).toContain('De la base');
    expect(fixture.nativeElement.textContent).not.toContain('De otra tabla');
  });

  /**
   * Las que quedaron en el navegador de antes se suben a la base una vez, y
   * solo entonces se borran de allí.
   */
  it('sube a la base las composiciones que quedaban en el navegador', async () => {
    const key = 'druse.query-builder.v1:connection-1:druse_test:public:orders';
    localStorage.setItem(
      key,
      JSON.stringify([{ id: 'vieja', name: 'De antes', sql: 'SELECT 3;' }]),
    );

    const fixture = await create(table);
    // La subida y la lectura van una detrás de otra: la lista llega después.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compositions.records.map((record) => record.id)).toEqual(['vieja']);
    expect(localStorage.getItem(key)).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('De antes');
  });

  it('sin la base, no borra del navegador lo que no pudo subir', async () => {
    const key = 'druse.query-builder.v1:connection-1:druse_test:public:orders';
    localStorage.setItem(
      key,
      JSON.stringify([{ id: 'vieja', name: 'De antes', sql: 'SELECT 3;' }]),
    );
    compositions.failing = true;

    const fixture = await create(table);

    expect(localStorage.getItem(key)).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('De antes');
    expect(fixture.nativeElement.textContent).toContain(
      'No se pudieron leer las composiciones guardadas.',
    );
  });

  it('si no se pudo borrar, la composición vuelve a la lista', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;

    builder.compositionName.set('Se queda');
    builder.saveComposition();
    await fixture.whenStable();
    compositions.failing = true;

    await builder.removeComposition(builder.savedCompositions()[0].id);

    expect(builder.savedCompositions().map((saved: { name: string }) => saved.name)).toEqual([
      'Se queda',
    ]);
    expect(builder.compositionError()).toBe('No se pudo borrar la composición.');
  });

  /**
   * Una composición guardada vuelve como formulario, no como texto.
   *
   * Antes solo se guardaba el SQL: al cargarla, cambiar un filtro obligaba a
   * rehacerla desde el formulario vacío.
   */
  it('al cargar una composición recupera el formulario y no solo el SQL', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;
    const builder = fixture.componentInstance as any;

    builder.filters.set([{ column: 'id', operator: 'BETWEEN', value: '1', valueTo: '9' }]);
    builder.limit.set(25);
    builder.compositionName.set('Primeros pedidos');
    builder.saveComposition();
    fixture.detectChanges();

    const guardado = (element.querySelector('.sql') as HTMLTextAreaElement).value;

    // Se cambia todo lo que la composición debe devolver.
    builder.filters.set([]);
    builder.limit.set(100);
    fixture.detectChanges();
    expect((element.querySelector('.sql') as HTMLTextAreaElement).value).not.toBe(guardado);

    await builder.loadComposition(builder.savedCompositions()[0]);
    fixture.detectChanges();

    expect((element.querySelector('.sql') as HTMLTextAreaElement).value).toBe(guardado);
    expect(builder.filters()).toEqual([
      { column: 'id', operator: 'BETWEEN', value: '1', valueTo: '9' },
    ]);
    // Formulario vivo, no texto fijo: no hay nada que restablecer.
    expect(element.textContent).not.toContain('Restablecer desde el formulario');
  });

  it('restaura los cruces con las columnas que se eligieron', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;

    builder.joins.set([
      {
        id: 1,
        type: 'LEFT',
        tableId: customer.id,
        search: 'public.customers',
        leftJoinId: null,
        leftColumn: 'customer_id',
        rightColumn: 'id',
        columns: [],
        chosen: ['name'],
        loading: false,
        suggestionsOpen: false,
        highlighted: 0,
      },
    ]);
    builder.compositionName.set('Con clientes');
    builder.saveComposition();
    builder.joins.set([]);

    await builder.loadComposition(builder.savedCompositions()[0]);

    const [join] = builder.joins();
    expect(join).toMatchObject({
      type: 'LEFT',
      leftColumn: 'customer_id',
      rightColumn: 'id',
      chosen: ['name'],
      loading: false,
    });
    expect(join.columns.map((column: { name: string }) => column.name)).toEqual(['id', 'name']);
  });

  it('una composición antigua, sin formulario, se sigue abriendo como SQL', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;

    await builder.loadComposition({ id: 'x', name: 'Antigua', sql: 'SELECT 1;' });
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('.sql') as HTMLTextAreaElement).value).toBe(
      'SELECT 1;',
    );
  });

  it('explica el orden de evaluación solo cuando se mezclan AND y OR', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;
    const builder = fixture.componentInstance as any;
    const nota = 'Se evalúan en orden';

    builder.filters.set([
      { column: 'id', operator: '=', value: '1' },
      { column: 'id', operator: '=', value: '2', conjunction: 'OR' },
    ]);
    fixture.detectChanges();
    expect(element.textContent).not.toContain(nota);

    builder.filters.update((filters: unknown[]) => [
      ...filters,
      { column: 'id', operator: '=', value: '3', conjunction: 'AND' },
    ]);
    fixture.detectChanges();
    expect(element.textContent).toContain(nota);
  });

  it('BETWEEN pide los dos extremos', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;
    const builder = fixture.componentInstance as any;

    builder.filters.set([{ column: 'id', operator: 'BETWEEN', value: null, valueTo: null }]);
    fixture.detectChanges();

    expect(element.querySelector('.filter__between')?.textContent).toContain('y');
    expect(element.querySelectorAll('.filter app-value-input').length).toBe(2);
  });

  it('un filtro nuevo queda pendiente, no comparado con texto vacío', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;

    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Añadir filtro')!
      .click();
    fixture.detectChanges();

    const sql = (element.querySelector('.sql') as HTMLTextAreaElement).value;
    expect(sql).toContain('/* valor obligatorio */');
    expect(sql).not.toContain("= ''");
  });

  it('vaciar el valor de una columna numérica lo deja pendiente', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;

    builder.columns.set([
      { name: 'id', dataType: 'int', isNullable: false, isPrimaryKey: true, inputKind: 'integer' },
      { name: 'name', dataType: 'text', isNullable: true, isPrimaryKey: false, inputKind: 'text' },
    ]);

    expect(builder.filterText({ column: 'id', operator: '=', value: '1' }, '')).toBeNull();
    // En texto, la cadena vacía sí es un valor.
    expect(builder.filterText({ column: 'name', operator: '=', value: 'a' }, '')).toBe('');
  });

  it('al comparar con otra columna propone una distinta de la del filtro', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;

    builder.filters.set([{ column: 'id', operator: '>', value: null }]);
    builder.setCompareTarget(0, 'column');

    expect(builder.filters()[0].compareColumn).toBeTruthy();
    expect(builder.filters()[0].compareColumn).not.toBe('id');

    builder.setCompareTarget(0, 'value');
    expect(builder.filters()[0].compareColumn).toBeNull();
  });

  it('busca columnas por nombre o tipo y conserva las selecciones ocultas', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;
    const search = element.querySelector<HTMLInputElement>('.column-tools input')!;
    const select = element.querySelector<HTMLButtonElement>('.column-tools button')!;
    const sql = element.querySelector<HTMLTextAreaElement>('.sql')!;
    search.value = 'NUMERIC';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(element.querySelectorAll('.column')).toHaveLength(1);
    select.click();
    search.value = 'note';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    select.click();
    fixture.detectChanges();
    expect(sql.value).toContain('[total], [note]');
    search.value = 'missing-column';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(select.disabled).toBe(true);
    expect(sql.value).toContain('[total], [note]');
  });

  it('bloquea una prueba con filtros incompletos y permite probar el SQL editado', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;
    const preview = vi.spyOn(store, 'previewQuery');
    preview.mockClear();
    builder.filters.set([{ column: 'id', operator: '=', value: null }]);
    await builder.runPreview();
    expect(preview).not.toHaveBeenCalled();
    builder.patchSql('SELECT 1;');
    await builder.runPreview();
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('no reemplaza los resultados nuevos con una respuesta cancelada tardía', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;
    let finishOld!: (result: QueryResult) => void;
    const result: QueryResult = {
      executionId: 'new',
      state: 'succeeded',
      durationMs: 1,
      resultSets: [],
      messages: [],
    };
    vi.spyOn(store, 'previewQuery')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce(result);
    const oldRequest = builder.runPreview();
    builder.setAutoPreview(true);
    builder.limit.set(5);
    await builder.refreshPreview();
    finishOld({ ...result, executionId: 'old' });
    await oldRequest;
    expect(builder.previewResult()?.executionId).toBe('new');
    expect(builder.previewStale()).toBe(false);
    builder.limit.set(8);
    expect(builder.previewStale()).toBe(true);
  });

  it('no lanza otra prueba si se destruye el diálogo mientras cancela la anterior', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;
    let finishCancel!: () => void;
    let finishPreview!: (result: null) => void;
    const preview = vi
      .spyOn(store, 'previewQuery')
      .mockClear()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishPreview = resolve;
          }),
      );
    vi.spyOn(store, 'cancelExecution').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCancel = resolve;
        }),
    );
    const pending = builder.runPreview();
    builder.setAutoPreview(true);
    const refresh = builder.refreshPreview();
    fixture.destroy();
    finishCancel();
    await refresh;
    finishPreview(null);
    await pending;
    expect(preview).toHaveBeenCalledTimes(1);
    expect(builder.previewResult()).toBeNull();
  });

  describe('vista previa automática', () => {
    it('está apagada por omisión', async () => {
      const fixture = await create(table);

      expect((fixture.componentInstance as any).autoPreview()).toBe(false);
    });

    it('se refresca sola con el SQL del formulario', async () => {
      const previews: string[] = [];
      const original = store.previewQuery;
      store.previewQuery = ((_c: string, _d: string, sql: string) => {
        previews.push(sql);
        return Promise.resolve(null);
      }) as never;

      try {
        vi.useFakeTimers();
        const fixture = await create(table);
        const builder = fixture.componentInstance as any;

        builder.setAutoPreview(true);
        builder.limit.set(5);
        fixture.detectChanges();
        await vi.advanceTimersByTimeAsync(1000);

        expect(previews.length).toBe(1);
        expect(localStorage.getItem('druse.query-builder.auto-preview')).toBe('1');
      } finally {
        vi.useRealTimers();
        store.previewQuery = original;
      }
    });

    it('nunca ejecuta sola el SQL retocado a mano ni un UPDATE', async () => {
      const fixture = await create(table);
      const builder = fixture.componentInstance as any;

      builder.patchSql('DELETE FROM orders');
      expect(builder.canAutoPreview()).toBe(false);

      builder.resetSql();
      builder.setOperation('update');
      expect(builder.canAutoPreview()).toBe(false);
    });

    it('espera a que los filtros tengan su valor', async () => {
      const fixture = await create(table);
      const builder = fixture.componentInstance as any;

      builder.filters.set([{ column: 'id', operator: '=', value: null }]);
      expect(builder.canAutoPreview()).toBe(false);

      builder.filters.set([{ column: 'id', operator: '=', value: '1' }]);
      expect(builder.canAutoPreview()).toBe(true);
    });
  });

  it('llegar hasta una tabla añade el cruce que sale de las claves foráneas', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;

    builder.columns.update((columns: readonly unknown[]) => [
      ...columns,
      { name: 'customer_id', dataType: 'int', isNullable: false, isPrimaryKey: false },
    ]);
    await builder.joinPathTo(customer.id);
    fixture.detectChanges();

    expect(builder.joins()).toHaveLength(1);
    expect(builder.joins()[0]).toMatchObject({
      tableId: customer.id,
      leftJoinId: null,
      leftColumn: 'customer_id',
      rightColumn: 'id',
      loading: false,
    });
    expect((fixture.nativeElement.querySelector('.sql') as HTMLTextAreaElement).value).toContain(
      'ON [t0].[customer_id] = [t1].[id]',
    );

    // Lo que se ve tiene que ser lo que se escribe. Con `[value]` en el select,
    // el valor llegaba antes que las opciones y se enseñaba la primera, `id`.
    const izquierda = fixture.nativeElement.querySelector(
      'select[aria-label="Columna izquierda del JOIN"]',
    ) as HTMLSelectElement;
    expect(izquierda.selectedOptions[0]?.value).toBe('customer_id');
  });

  it('avisa cuando no hay camino hasta la tabla', async () => {
    const fixture = await create(table);
    const builder = fixture.componentInstance as any;

    await builder.joinPathTo(auditCustomerNode.source.id);

    expect(builder.joins()).toHaveLength(0);
    expect(builder.pathNotice()).toContain('No hay un camino');
  });

  describe('reabrir desde el editor', () => {
    it('al insertar un SELECT manda también su formulario', async () => {
      const fixture = await create(table);
      const builder = fixture.componentInstance as any;
      const emitted: { sql: string; state: any }[] = [];
      fixture.componentInstance.composed.subscribe((event) => emitted.push(event as never));

      builder.limit.set(7);
      builder.insertSql();

      expect(emitted).toHaveLength(1);
      expect(emitted[0].sql).toContain('TOP 7');
      expect(emitted[0].state.limit).toBe(7);
    });

    it('un UPDATE no se recuerda: se escribe con sus valores y se ejecuta una vez', async () => {
      const fixture = await create(table);
      const builder = fixture.componentInstance as any;
      let emitted = 0;
      fixture.componentInstance.composed.subscribe(() => emitted++);

      builder.setOperation('update');
      builder.insertSql();

      expect(emitted).toBe(0);
    });

    it('arranca con el formulario recibido en vez del vacío', async () => {
      const fixture = TestBed.createComponent(QueryBuilder);
      fixture.componentRef.setInput('table', table);
      fixture.componentRef.setInput('engine', 'sqlserver');
      fixture.componentRef.setInput('connectionId', 'connection-1');
      fixture.componentRef.setInput('initialState', {
        chosen: ['id'],
        joins: [],
        filters: [{ column: 'total', operator: '>', value: '100' }],
        grouped: false,
        groupByKeys: [],
        groupPeriods: {},
        aggregates: [],
        having: [],
        orders: [{ id: 1, target: '', descending: false }],
        limit: 5,
        distinct: true,
        sqlOverride: null,
      });
      fixture.detectChanges();
      await fixture.whenStable();
      // Las columnas y la estructura llegan una detrás de otra, y el formulario
      // se aplica después de las dos.
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();

      const sql = (fixture.nativeElement.querySelector('.sql') as HTMLTextAreaElement).value;
      expect(sql).toContain('SELECT DISTINCT TOP 5 [id]');
      expect(sql).toContain('WHERE [total] > 100');
    });
  });

  it('presenta cada JOIN como una relación legible entre dos tablas', async () => {
    const fixture = await create(table);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.join-empty')?.textContent).toContain('Aún no hay cruces');

    (element.querySelector('.join-add') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const card = element.querySelector('.join-card') as HTMLElement;
    expect(card.querySelector('.join-card__step')?.textContent).toContain('JOIN 1');
    expect(card.querySelector('.join-card__step')?.textContent).toContain('t1');
    expect(card.querySelector('.join-condition__title')?.textContent).toContain(
      'Condición de relación',
    );
    expect(
      [...card.querySelectorAll('.join-operand__role')].map((item) => item.textContent?.trim()),
    ).toEqual(['Tabla existente', 'Tabla incorporada']);
    expect(card.querySelector('.join-operand__table strong')?.textContent).toContain('t1');
    expect(card.querySelector('.join-operand__table span')?.textContent).toContain(
      'public.customers',
    );
    expect(card.querySelector('.join-columns__head')?.textContent).toContain('Columnas de t1');
    expect(card.querySelector('select[aria-label="Tabla izquierda del JOIN"]')).not.toBeNull();
    expect(card.querySelector('select[aria-label="Columna izquierda del JOIN"]')).not.toBeNull();
    expect(card.querySelector('select[aria-label="Columna de la tabla cruzada"]')).not.toBeNull();
  });

  it('permite relacionar un JOIN con cualquier tabla incorporada antes', async () => {
    const fixture = await create(table);
    const addJoin = fixture.nativeElement.querySelector('.joins-block .btn') as HTMLButtonElement;

    addJoin.click();
    await fixture.whenStable();
    fixture.detectChanges();
    addJoin.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.join-card') as NodeListOf<HTMLElement>;
    const source = cards[1].querySelector(
      'select[aria-label="Tabla izquierda del JOIN"]',
    ) as HTMLSelectElement;

    expect([...source.options].map((option) => option.textContent?.trim())).toEqual([
      't0 · public.orders',
      't1 · public.customers',
    ]);

    source.value = '1';
    source.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const leftColumn = cards[1].querySelector(
      'select[aria-label="Columna izquierda del JOIN"]',
    ) as HTMLSelectElement;
    const rightColumn = cards[1].querySelector(
      'select[aria-label="Columna de la tabla cruzada"]',
    ) as HTMLSelectElement;

    expect([...leftColumn.options].map((option) => option.value)).toEqual(['id', 'name']);
    leftColumn.value = 'name';
    leftColumn.dispatchEvent(new Event('change'));
    rightColumn.value = 'name';
    rightColumn.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement;
    expect(preview.value).toContain('ON [t1].[name] = [t2].[name]');

    // Si desaparece la tabla elegida, la condición vuelve a la principal y no
    // conserva una columna que allí no existe.
    (cards[0].querySelector('.icon') as HTMLButtonElement).click();
    fixture.detectChanges();

    const remainingSource = fixture.nativeElement.querySelector(
      'select[aria-label="Tabla izquierda del JOIN"]',
    ) as HTMLSelectElement;
    expect(remainingSource.value).toBe('');
    expect(preview.value).toContain('ON [t0].[id] = [t1].[name]');
  });

  /**
   * Los dos Informix son el mismo servidor: el protocolo no cambia el dialecto.
   * Antes solo `informix` quitaba la opción, y por SQLI aparecía.
   */
  it.each(['informix', 'informixsqli'] as const)('oculta FULL OUTER JOIN en %s', async (engine) => {
    const fixture = TestBed.createComponent(QueryBuilder);
    fixture.componentRef.setInput('table', table);
    fixture.componentRef.setInput('engine', engine);
    fixture.componentRef.setInput('connectionId', 'connection-1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect((fixture.componentInstance as any).joinTypes()).not.toContain('FULL OUTER');
  });

  it('oculta FULL OUTER JOIN en MySQL y CROSS JOIN no muestra condición', async () => {
    const fixture = TestBed.createComponent(QueryBuilder);
    fixture.componentRef.setInput('table', table);
    fixture.componentRef.setInput('engine', 'mysql');
    fixture.componentRef.setInput('connectionId', 'connection-1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.joins-block .btn') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const type = fixture.nativeElement.querySelector(
      'select[aria-label="Tipo de JOIN"]',
    ) as HTMLSelectElement;
    expect([...type.options].map((option) => option.value)).not.toContain('FULL OUTER');

    type.value = 'CROSS';
    type.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.join-condition')).toBeNull();
    expect(
      (fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement).value,
    ).toContain('CROSS JOIN `public`.`customers` AS `t1`');
  });

  it('busca tablas por esquema y nombre sin ofrecer otras bases', async () => {
    const fixture = await create(table);
    (fixture.nativeElement.querySelector('.joins-block .btn') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector(
      'input[aria-label="Buscar tabla para JOIN"]',
    ) as HTMLInputElement;
    search.value = 'audit.cust';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    const options = [...fixture.nativeElement.querySelectorAll('.join-suggestions button')].map(
      (option: HTMLButtonElement) => option.dataset['value'],
    );
    expect(options).toEqual(['audit.customers']);
    expect(options).not.toContain('public.customers');
    expect(relationLoads).toContainEqual({
      schema: 'audit',
      connectionId: 'connection-1',
      database: 'druse_test',
    });

    search.value = 'audit.customers';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement).value,
    ).toContain('JOIN [audit].[customers] AS [t1]');
  });

  it('carga las tablas al elegir un esquema sin relaciones precargadas', async () => {
    relationNodes.set([]);
    const fixture = await create(table);
    const originalSql = (fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement)
      .value;

    const addJoin = fixture.nativeElement.querySelector('.joins-block .btn') as HTMLButtonElement;
    expect(addJoin.disabled).toBe(false);
    addJoin.click();
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement).value).toBe(
      originalSql,
    );

    const auditSchema = fixture.nativeElement.querySelector(
      '.join-suggestions button[data-value="audit"]',
    ) as HTMLButtonElement;
    auditSchema.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector(
      'input[aria-label="Buscar tabla para JOIN"]',
    ) as HTMLInputElement;
    expect(search.value).toBe('audit.');
    expect(relationLoads).toContainEqual({
      schema: 'audit',
      connectionId: 'connection-1',
      database: 'druse_test',
    });

    const auditTable = fixture.nativeElement.querySelector(
      '.join-suggestions button[data-value="audit.customers"]',
    ) as HTMLButtonElement;
    expect(auditTable).not.toBeNull();
    auditTable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement).value,
    ).toContain('INNER JOIN [audit].[customers] AS [t1]');
  });

  it('permite recorrer sugerencias con flechas, elegir con Enter y cerrar con Escape', async () => {
    const fixture = await create(table);
    (fixture.nativeElement.querySelector('.joins-block .btn') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector(
      'input[aria-label="Buscar tabla para JOIN"]',
    ) as HTMLInputElement;
    search.value = 'customers';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.join-suggestions button').length).toBe(2);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.join-suggestions .is-active')?.textContent,
    ).toContain('audit');

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(search.value).toBe('audit.customers');
    expect(fixture.nativeElement.querySelector('.join-suggestions')).toBeNull();

    search.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.join-suggestions')).not.toBeNull();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.join-suggestions')).toBeNull();
  });

  /**
   * Lo que se espera de cualquier ventana modal, y lo que ya hacían las demás.
   *
   * Este diálogo se quedó fuera cuando se añadió: el barrido visual lo encontró
   * porque era el único que no obedecía a la tecla.
   */
  it('se cierra con Escape', async () => {
    const fixture = await create(table);
    let cerrado = false;

    fixture.componentInstance.closed.subscribe(() => (cerrado = true));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();

    expect(cerrado).toBe(true);
  });

  /**
   * Con el desplegable abierto, la tecla es suya.
   *
   * Si el diálogo también la atendiera, buscar una tabla para el JOIN y
   * arrepentirse cerraría la ventana entera y se perdería lo compuesto.
   */
  it('Escape cierra las sugerencias del JOIN sin cerrar el diálogo', async () => {
    const fixture = await create(table);
    let cerrado = false;

    fixture.componentInstance.closed.subscribe(() => (cerrado = true));

    (fixture.nativeElement.querySelector('.joins-block .btn') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const search = fixture.nativeElement.querySelector(
      'input[aria-label="Buscar tabla para JOIN"]',
    ) as HTMLInputElement;

    search.value = 'customers';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.join-suggestions')).not.toBeNull();

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.join-suggestions')).toBeNull();
    expect(cerrado).toBe(false);
  });
});
