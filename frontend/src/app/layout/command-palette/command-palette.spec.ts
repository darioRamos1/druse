import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SavedSnippet } from '../../core/application-gateway/application-gateway';
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
  authentication: 'password',
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

const snippet: SavedSnippet = {
  id: 'snippet-1',
  name: 'Pedidos del día',
  sql: ['-- los de hoy', 'SELECT * FROM pedidos WHERE creado >= CURRENT_DATE'].join('\n'),
};

describe('CommandPalette', () => {
  let fixture: ComponentFixture<CommandPalette>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CommandPalette] }).compileComponents();

    fixture = TestBed.createComponent(CommandPalette);
    fixture.componentRef.setInput('connections', [connection]);
    fixture.componentRef.setInput('nodes', [table]);
    fixture.componentRef.setInput('snippets', [snippet]);
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
    expect(text).toContain('Comentar/descomentar líneas');
    expect(text).toContain('Abrir historial');
  });

  it('ejecuta comentar líneas desde la paleta', () => {
    let emitted = 0;
    fixture.componentInstance.toggleLineComment.subscribe(() => emitted++);

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'comentar';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(emitted).toBe(1);
  });

  it('distingue los objetos por conexión y base', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent;

    expect(text).toContain('Pruebas · druse_test · public.users');
  });

  it('presenta los tipos de resultado en español', () => {
    const element = fixture.nativeElement as HTMLElement;
    const kinds = [...element.querySelectorAll<HTMLElement>('.result__kind')]
      .map((item) => item.textContent?.trim());

    expect(kinds).toContain('comando');
    expect(kinds).toContain('conexión');
    expect(kinds).toContain('tabla');
    expect(kinds).toContain('fragmento');
    expect(kinds).not.toContain('command');
    expect(kinds).not.toContain('connection');
  });

  /** El comentario de cabecera explica, pero no distingue un fragmento de otro. */
  it('lista los fragmentos por su nombre y su primera línea de SQL', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent;

    expect(text).toContain('Pedidos del día');
    expect(text).toContain('SELECT * FROM pedidos');
    expect(text).not.toContain('-- los de hoy');
  });

  it('inserta el fragmento elegido', () => {
    const inserted: SavedSnippet[] = [];
    fixture.componentInstance.insertSnippet.subscribe((item) => inserted.push(item));

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'Pedidos del día';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(inserted[0]?.id).toBe(snippet.id);
  });

  /**
   * El nombre se pide en el mismo campo: abrir un diálogo encima para una línea
   * de texto sería sacar al usuario del teclado para devolverlo al mismo sitio.
   */
  it('pide el nombre en el propio buscador y guarda con él', async () => {
    const names: string[] = [];
    fixture.componentInstance.saveSnippet.subscribe((name) => names.push(name));

    const input = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input().value = 'Guardar como fragmento';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(input().getAttribute('aria-label')).toBe('Nombre del fragmento');

    input().value = '  Ventas del mes  ';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(names).toEqual(['Ventas del mes']);
  });

  it('permite dejar el nombre vacío para que lo proponga el SQL', async () => {
    const names: string[] = [];
    fixture.componentInstance.saveSnippet.subscribe((name) => names.push(name));

    const input = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input().value = 'Guardar como fragmento';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    await fixture.whenStable();

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(names).toEqual(['']);
  });

  /**
   * Borrar no se deshace, así que la primera pulsación pregunta. Una lista que
   * se recorre con las flechas no puede borrar a la primera.
   */
  it('borra un fragmento a la segunda pulsación', () => {
    const deleted: SavedSnippet[] = [];
    fixture.componentInstance.deleteSnippet.subscribe((item) => deleted.push(item));

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'Pedidos del día';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const borrar = () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', shiftKey: true }));

    borrar();
    fixture.detectChanges();

    expect(deleted).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('otra vez');

    borrar();

    expect(deleted[0]?.id).toBe(snippet.id);
  });
});
