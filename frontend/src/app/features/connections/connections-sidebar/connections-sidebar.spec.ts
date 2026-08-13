import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConnectionSummary, ExplorerNode } from '../../../shared/models/workspace';
import { ConnectionsSidebar } from './connections-sidebar';

const connection: ConnectionSummary = {
  id: 'connection-1',
  name: 'Pruebas',
  engine: 'postgresql',
  state: 'connected',
  expanded: true,
  sessionId: 'session-1',
  environment: 'development',
  readOnly: false,
  saved: false,
  hasStoredPassword: false,
  database: 'druse_test',
};

const column: ExplorerNode = {
  id: 'connection-1|column:public.orders.total',
  label: 'total',
  kind: 'column',
  depth: 5,
  expandable: false,
  expanded: false,
  loading: false,
  hint: 'numeric(12,2)',
  source: {
    id: 'column:public.orders.total',
    name: 'total',
    kind: 'column',
    database: 'druse_test',
    schema: 'public',
    dataType: 'numeric(12,2)',
    hasChildren: false,
  },
  connectionId: connection.id,
};

const view: ExplorerNode = {
  ...column,
  id: 'connection-1|View:public.active_users',
  label: 'active_users',
  kind: 'view',
  depth: 4,
  expandable: true,
  hint: undefined,
  source: {
    id: 'View:public.active_users',
    name: 'active_users',
    kind: 'view',
    database: 'druse_test',
    schema: 'public',
    hasChildren: true,
  },
};

describe('ConnectionsSidebar', () => {
  let fixture: ComponentFixture<ConnectionsSidebar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ConnectionsSidebar] }).compileComponents();

    fixture = TestBed.createComponent(ConnectionsSidebar);
    fixture.componentRef.setInput('connections', [connection]);
    fixture.componentRef.setInput('explorerNodes', [column]);
    fixture.detectChanges();
  });

  it('muestra el tipo completo junto al nombre de una columna', () => {
    const hint = fixture.nativeElement.querySelector('.node__hint') as HTMLElement | null;

    expect(hint?.textContent?.trim()).toBe('numeric(12,2)');
    expect(hint?.title).toBe('numeric(12,2)');
  });

  it('ofrece Ver DDL dentro del menú de una vista', () => {
    fixture.componentRef.setInput('explorerNodes', [column, view]);
    fixture.detectChanges();

    const viewRow = [...fixture.nativeElement.querySelectorAll('.node--object')].find(
      (node: Element) => node.textContent?.includes('active_users'),
    ) as HTMLElement;
    viewRow.querySelector<HTMLButtonElement>('.node__menu-trigger')?.click();
    fixture.detectChanges();

    const ddl = [...viewRow.querySelectorAll('.node-menu button')].find((button: Element) =>
      button.textContent?.includes('Ver DDL'),
    );

    expect(ddl).toBeTruthy();
  });

  it('el menú usa acciones textuales y botones accesibles', () => {
    fixture.componentRef.setInput('explorerNodes', [view]);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.node__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const labels = [...fixture.nativeElement.querySelectorAll('.node-menu button')].map(
      (button: Element) => button.textContent?.trim(),
    );

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(labels).toContain('Abrir SELECT');
    expect(labels).toContain('Componer consulta');
    expect(labels).toContain('Copiar nombre calificado');
  });

  it('Enter en una acción no pliega el nodo del árbol', () => {
    fixture.componentRef.setInput('explorerNodes', [view]);
    fixture.detectChanges();
    let toggles = 0;
    fixture.componentInstance.toggleNode.subscribe(() => toggles++);

    const trigger = fixture.nativeElement.querySelector('.node__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const action = fixture.nativeElement.querySelector('.node-menu button') as HTMLButtonElement;
    action.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(toggles).toBe(0);
  });
});
