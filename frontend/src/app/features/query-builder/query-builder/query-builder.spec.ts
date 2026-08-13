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

const store = {
  ensureColumnsAsync: () =>
    Promise.resolve([
      { name: 'id', dataType: 'int', isNullable: false, isPrimaryKey: true },
      { name: 'total', dataType: 'numeric(12,2)', isNullable: false, isPrimaryKey: false },
    ]),
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
    await TestBed.configureTestingModule({
      imports: [QueryBuilder],
      providers: [{ provide: WorkspaceStore, useValue: store }],
    }).compileComponents();
  });

  it('ofrece las plantillas de escritura y DROP TABLE para una tabla', async () => {
    const fixture = await create(table);
    const labels = [...fixture.nativeElement.querySelectorAll('.templates button')].map(
      (button: Element) => button.textContent?.trim(),
    );

    expect(labels).toEqual(['INSERT', 'UPDATE', 'CREATE TABLE', 'DROP TABLE']);
  });

  it('una vista solo permite componer SELECT', async () => {
    const fixture = await create({ ...table, id: 'view:public.orders', kind: 'view' });

    expect(fixture.nativeElement.querySelectorAll('.templates button').length).toBe(0);
    expect(fixture.nativeElement.querySelector('.btn--primary')?.textContent).toContain(
      'Insertar en el editor',
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
});
