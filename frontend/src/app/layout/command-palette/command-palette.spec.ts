import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SavedSnippet } from '../../core/application-gateway/application-gateway';
import { ConnectionSummary, ExplorerNode, QueryTab } from '../../shared/models/workspace';
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

const openTab: QueryTab = {
  id: 'q7',
  title: 'facturas pendientes',
  active: true,
  dirty: true,
  sql: 'SELECT * FROM facturas',
  connectionId: connection.id,
};

describe('CommandPalette', () => {
  let fixture: ComponentFixture<CommandPalette>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CommandPalette] }).compileComponents();

    fixture = TestBed.createComponent(CommandPalette);
    fixture.componentRef.setInput('connections', [connection]);
    fixture.componentRef.setInput('nodes', [table]);
    fixture.componentRef.setInput('snippets', [snippet]);
    fixture.componentRef.setInput('tabs', [openTab]);
    fixture.componentRef.setInput('hasConnection', true);
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

  it('muestra la combinación real de reemplazar en macOS', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    try {
      const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
      input.value = 'reemplazar';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('⌘+⌥+F');
      expect(fixture.nativeElement.textContent).not.toContain('Ctrl+H');
    } finally {
      platform.mockRestore();
    }
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

  it('ofrece los comandos de pestaña, diagrama y transacción', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent;

    expect(text).toContain('Duplicar la pestaña');
    expect(text).toContain('Cerrar las demás pestañas');
    expect(text).toContain('Copiar el nombre calificado');
    expect(text).toContain('Ver el diagrama');
    expect(text).toContain('Iniciar transacción');
    expect(text).toContain('Ver los atajos de teclado');
  });

  /**
   * Confirmar y deshacer se piden desde aquí y **sin atajo**: son de las pocas
   * cosas de Druse que no se pueden deshacer, y un dedazo no debería llegar a
   * ellas.
   */
  it('confirmar la transacción se pide con su nombre entero', () => {
    fixture.componentRef.setInput('transactionOpen', true);
    const pedidos: string[] = [];
    fixture.componentInstance.transaction.subscribe((accion) => pedidos.push(accion));

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'confirmar la transacción';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(pedidos).toEqual(['commit']);
  });

  function search(term: string): HTMLInputElement {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = term;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    return input;
  }

  function option(label: string): HTMLButtonElement {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '[role="option"]',
      ),
    ].find((button) => button.querySelector('strong')?.textContent === label)!;
  }

  it('explica la falta de conexión y no ejecuta ni cierra con Enter o clic', () => {
    fixture.componentRef.setInput('hasConnection', false);
    const execute = vi.fn();
    const closed = vi.fn();
    fixture.componentInstance.executeQuery.subscribe(execute);
    fixture.componentInstance.closed.subscribe(closed);

    const input = search('Ejecutar consulta activa');
    const result = option('Ejecutar consulta activa');
    expect(result.getAttribute('aria-disabled')).toBe('true');
    expect(result.textContent).toContain('Abre una conexión');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    result.click();
    expect(execute).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });

  it('actualiza la disponibilidad sin perder la búsqueda cuando se pierde y recupera la sesión', () => {
    const execute = vi.fn();
    fixture.componentInstance.executeQuery.subscribe(execute);
    const input = search('Ejecutar consulta activa');
    expect(option('Ejecutar consulta activa').hasAttribute('aria-disabled')).toBe(false);

    fixture.componentRef.setInput('hasConnection', false);
    // Incluso antes del siguiente render, el clic consulta el estado actual.
    option('Ejecutar consulta activa').click();
    expect(execute).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(option('Ejecutar consulta activa').getAttribute('aria-disabled')).toBe('true');

    fixture.componentRef.setInput('hasConnection', true);
    fixture.detectChanges();
    expect(input.value).toBe('Ejecutar consulta activa');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('permite recorrer una acción no disponible y continuar hacia otra con las flechas', async () => {
    fixture.componentRef.setInput('hasConnection', false);
    const input = search('');
    // JSDOM no implementa el desplazamiento visual de las filas.
    for (const row of (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '[role="option"]',
    )) {
      row.scrollIntoView = vi.fn();
    }
    for (let i = 0; i < 3; i++) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    }
    fixture.detectChanges();
    const selected = () => fixture.nativeElement.querySelector('[aria-selected="true"]');
    expect(selected().textContent).toContain('Ejecutar consulta activa');
    expect(selected().getAttribute('aria-disabled')).toBe('true');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(selected().textContent).toContain('Formatear SQL');
    expect(selected().hasAttribute('aria-disabled')).toBe(false);
    await fixture.whenStable();
  });

  it('pide SQL para ejecutar, formatear o guardar un fragmento vacío', () => {
    fixture.componentRef.setInput('tabs', [{ ...openTab, sql: '  \n  ' }]);
    search('');
    for (const label of ['Ejecutar consulta activa', 'Formatear SQL', 'Guardar como fragmento']) {
      expect(option(label).getAttribute('aria-disabled')).toBe('true');
      expect(option(label).textContent).toContain('Escribe SQL');
    }
    expect(option('Nueva consulta').hasAttribute('aria-disabled')).toBe(false);
    expect(option('Nueva conexión').hasAttribute('aria-disabled')).toBe(false);
  });

  it.each(['running', 'transactionBusy'])(
    'bloquea ejecución y transacciones mientras %s',
    (input) => {
      fixture.componentRef.setInput(input, true);
      fixture.componentRef.setInput('transactionOpen', true);
      search('');
      for (const label of [
        'Ejecutar consulta activa',
        'Iniciar transacción',
        'Confirmar la transacción',
        'Deshacer la transacción',
      ]) {
        expect(option(label).getAttribute('aria-disabled')).toBe('true');
        expect(option(label).textContent).toContain('Espera a que termine');
      }
    },
  );

  it('ofrece iniciar o terminar la transacción según el estado de la conexión', () => {
    search('transacción');
    expect(option('Iniciar transacción').hasAttribute('aria-disabled')).toBe(false);
    expect(option('Confirmar la transacción').getAttribute('aria-disabled')).toBe('true');
    expect(option('Deshacer la transacción').textContent).toContain(
      'No hay una transacción abierta',
    );

    fixture.componentRef.setInput('transactionOpen', true);
    fixture.detectChanges();
    expect(option('Iniciar transacción').getAttribute('aria-disabled')).toBe('true');
    expect(option('Confirmar la transacción').hasAttribute('aria-disabled')).toBe(false);
    expect(option('Deshacer la transacción').hasAttribute('aria-disabled')).toBe(false);
  });

  it('distingue una consulta suelta de una pestaña de tabla y no exige sesión para copiar su nombre', () => {
    search('');
    expect(option('Ver el diagrama').getAttribute('aria-disabled')).toBe('true');
    expect(option('Copiar el nombre calificado').getAttribute('aria-disabled')).toBe('true');
    fixture.componentRef.setInput('tabs', [{ ...openTab, sourceTable: table.source }]);
    fixture.detectChanges();
    expect(option('Ver el diagrama').hasAttribute('aria-disabled')).toBe(false);
    fixture.componentRef.setInput('hasConnection', false);
    fixture.detectChanges();
    expect(option('Ver el diagrama').getAttribute('aria-disabled')).toBe('true');
    expect(option('Copiar el nombre calificado').hasAttribute('aria-disabled')).toBe(false);
  });

  it('anuncia ejecutar selección y conserva su atajo', () => {
    fixture.componentRef.setInput('hasSelection', true);
    search('Ejecutar selección');
    expect(option('Ejecutar selección').hasAttribute('aria-disabled')).toBe(false);
    expect(option('Ejecutar selección').textContent).toContain('Ctrl+Shift+Enter');
  });

  it('duplicar la pestaña se pide desde la paleta', () => {
    let pedido = 0;
    fixture.componentInstance.duplicateTab.subscribe(() => pedido++);

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'duplicar';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(pedido).toBe(1);
  });

  it('distingue los objetos por conexión y base', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent;

    expect(text).toContain('Pruebas · druse_test · public.users');
  });

  it('presenta los tipos de resultado en español', () => {
    const element = fixture.nativeElement as HTMLElement;
    const kinds = [...element.querySelectorAll<HTMLElement>('.result__kind')].map((item) =>
      item.textContent?.trim(),
    );

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
  it('encuentra una pestaña abierta y salta a ella', () => {
    const activated: string[] = [];
    fixture.componentInstance.activateTab.subscribe((id) => activated.push(id));

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'facturas pend';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Pruebas · druse_test');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(activated).toEqual([openTab.id]);
  });
});
