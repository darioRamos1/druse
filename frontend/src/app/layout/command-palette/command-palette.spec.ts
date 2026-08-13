import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConnectionSummary, ExplorerNode } from '../../shared/models/workspace';
import CommandPalette from './command-palette';

const connection: ConnectionSummary = {
  id: 'connection-1',
  name: 'Pruebas',
  engine: 'postgresql',
  state: 'connected',
  expanded: true,
  sessionId: 'session-1',
  environment: 'testing',
  readOnly: false,
  saved: true,
  hasStoredPassword: true,
  database: 'druse_test',
};

const table: ExplorerNode = {
  id: 'connection-1|table:public.users',
  label: 'users',
  kind: 'table',
  depth: 4,
  expandable: true,
  expanded: false,
  loading: false,
  connectionId: connection.id,
  source: {
    id: 'table:public.users',
    name: 'users',
    kind: 'table',
    schema: 'public',
    database: 'druse_test',
    hasChildren: true,
  },
};

describe('CommandPalette', () => {
  let fixture: ComponentFixture<CommandPalette>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CommandPalette] }).compileComponents();

    fixture = TestBed.createComponent(CommandPalette);
    fixture.componentRef.setInput('connections', [connection]);
    fixture.componentRef.setInput('nodes', [table]);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('filtra y abre una tabla con Enter', () => {
    const opened: ExplorerNode[] = [];
    fixture.componentInstance.openNode.subscribe((node) => opened.push(node));

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'users';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(opened[0]?.id).toBe(table.id);
  });

  it('ofrece comandos de ejecución, formato e historial', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent;

    expect(text).toContain('Ejecutar consulta activa');
    expect(text).toContain('Formatear SQL');
    expect(text).toContain('Abrir historial');
  });

  it('distingue los objetos por conexión y base', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent;

    expect(text).toContain('Pruebas · druse_test · public.users');
  });
});
