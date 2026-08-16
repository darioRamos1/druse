import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject } from '../../../shared/models/workspace';
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
    await TestBed.configureTestingModule({
      imports: [QueryBuilder],
      providers: [{ provide: WorkspaceStore, useValue: store }],
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
    expect((fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement).value).toContain(
      'CROSS JOIN `public`.`customers` AS `t1`',
    );
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

    expect((fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement).value).toContain(
      'JOIN [audit].[customers] AS [t1]',
    );
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

    expect((fixture.nativeElement.querySelector('textarea.sql') as HTMLTextAreaElement).value).toContain(
      'INNER JOIN [audit].[customers] AS [t1]',
    );
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
    expect(fixture.nativeElement.querySelector('.join-suggestions .is-active')?.textContent).toContain(
      'audit',
    );

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
});
