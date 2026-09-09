import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ConnectionSummary, ExplorerNode } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
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
  authentication: 'password',
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

const schema: ExplorerNode = {
  ...view,
  id: 'connection-1|schema:public',
  label: 'public',
  kind: 'schema',
  depth: 2,
  source: {
    id: 'schema:public',
    name: 'public',
    kind: 'schema',
    database: 'druse_test',
    schema: 'public',
    hasChildren: true,
  },
};

const procedure: ExplorerNode = {
  ...view,
  id: 'connection-1|Procedure:oid:42',
  label: 'recalcular(integer)',
  kind: 'procedure',
  expandable: false,
  source: {
    id: 'Procedure:oid:42',
    name: 'recalcular(integer)',
    kind: 'procedure',
    database: 'druse_test',
    schema: 'public',
    hasChildren: false,
  },
};

const table: ExplorerNode = {
  ...view,
  id: 'connection-1|Table:public.orders',
  label: 'orders',
  kind: 'table',
  source: {
    id: 'Table:public.orders',
    name: 'orders',
    kind: 'table',
    database: 'druse_test',
    schema: 'public',
    hasChildren: true,
  },
};

const database: ExplorerNode = {
  ...view,
  id: 'connection-1|db:druse_test',
  label: 'druse_test',
  kind: 'database',
  depth: 1,
  source: {
    id: 'db:druse_test',
    name: 'druse_test',
    kind: 'database',
    database: 'druse_test',
    hasChildren: true,
  },
};

/**
 * Un árbol pequeño pero completo, en preorden, como el que aplana el store.
 *
 * Hace falta entero porque el filtro trabaja sobre la jerarquía: sin la base
 * encima, un esquema no tendría de dónde colgar.
 */
const arbol: readonly ExplorerNode[] = [
  database,
  { ...schema, depth: 2 },
  { ...table, id: 'connection-1|Table:public.clientes', label: 'clientes', depth: 3 },
  {
    ...column,
    id: 'connection-1|column:public.clientes.descripcion',
    label: 'descripción',
    depth: 4,
  },
  { ...table, id: 'connection-1|Table:public.factura_cliente', label: 'factura_cliente', depth: 3 },
  { ...view, id: 'connection-1|View:public.clientes_activos', label: 'clientes_activos', depth: 3 },
  { ...table, id: 'connection-1|Table:public.pedidos', label: 'pedidos', depth: 3 },
];

/** Los nombres de los objetos pintados, en el orden en que se ven. */
function pintados(fixture: ComponentFixture<ConnectionsSidebar>): string[] {
  return [...fixture.nativeElement.querySelectorAll('.node--object .node__label')].map(
    (label: Element) => label.textContent?.trim() ?? '',
  );
}

/** Escribe en el campo y deja que pase la espera del filtro. */
function filtrar(fixture: ComponentFixture<ConnectionsSidebar>, texto: string): void {
  const input = fixture.nativeElement.querySelector('.filter__input') as HTMLInputElement;
  input.value = texto;
  input.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(200);
  fixture.detectChanges();
}

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

  it('usa iconos semánticos para esquemas y eliminar conexiones guardadas', () => {
    fixture.componentRef.setInput('connections', [{ ...connection, saved: true }]);
    fixture.componentRef.setInput('explorerNodes', [schema]);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.connection-menu-trigger').click();
    fixture.detectChanges();

    const schemaIcon = fixture.debugElement.query(By.css('.node--object app-icon.node__icon'))
      .componentInstance as Icon;
    const deleteIcon = fixture.debugElement.query(
      By.css('[title="Eliminar esta conexión guardada"] app-icon'),
    ).componentInstance as Icon;

    expect(schemaIcon.name()).toBe('schema');
    expect(deleteIcon.name()).toBe('trash');
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

  it('ofrece únicamente Ver DDL como acción propia de un procedimiento', () => {
    fixture.componentRef.setInput('explorerNodes', [procedure]);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.node__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const labels = [...fixture.nativeElement.querySelectorAll('.node-menu button')].map(
      (button: Element) => button.textContent?.trim(),
    );

    expect(labels).toContain('Ver DDL');
    expect(labels).not.toContain('Abrir SELECT');
    expect(labels).not.toContain('Componer consulta');
    expect(labels).not.toContain('Importar archivo');
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

  /**
   * Los tres sitios desde los que se piensa «me llevo esto». Sobre una vista no
   * se ofrece: el respaldo todavía solo sabe guionizar tablas.
   */
  it.each([
    ['una base', database],
    ['un esquema', schema],
    ['una tabla', table],
  ])('ofrece respaldar sobre %s', (_caso, node) => {
    fixture.componentRef.setInput('explorerNodes', [node]);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.node__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const labels = [...fixture.nativeElement.querySelectorAll('.node-menu button')].map(
      (button: Element) => button.textContent?.trim(),
    );

    expect(labels).toContain('Respaldar…');
  });

  it('sobre una vista no se ofrece respaldar', () => {
    fixture.componentRef.setInput('explorerNodes', [view]);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.node__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const labels = [...fixture.nativeElement.querySelectorAll('.node-menu button')].map(
      (button: Element) => button.textContent?.trim(),
    );

    expect(labels).not.toContain('Respaldar…');
  });

  it('respaldar entrega el nodo entero, que es lo que el asistente necesita', () => {
    fixture.componentRef.setInput('explorerNodes', [table]);
    fixture.detectChanges();
    const pedidos: ExplorerNode[] = [];
    fixture.componentInstance.backup.subscribe((node) => pedidos.push(node));

    const trigger = fixture.nativeElement.querySelector('.node__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const accion = [...fixture.nativeElement.querySelectorAll('.node-menu button')].find(
      (button: Element) => button.textContent?.includes('Respaldar'),
    ) as HTMLButtonElement;
    accion.click();

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].connectionId).toBe('connection-1');
    expect(pedidos[0].source.name).toBe('orders');
  });

  /**
   * El diagrama de la base entera. Antes solo se ofrecía sobre un esquema, y en
   * SQL Server o Informix —donde una base tiene varios— no había forma de pedir
   * el mapa completo sin abrir uno por uno.
   */
  it('el diagrama se ofrece también sobre una base', () => {
    fixture.componentRef.setInput('explorerNodes', [database]);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.node__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const labels = [...fixture.nativeElement.querySelectorAll('.node-menu button')].map(
      (button: Element) => button.textContent?.trim(),
    );

    expect(labels).toContain('Ver diagrama…');
  });

  it('pedir el diagrama de una base entrega la base, no un esquema suyo', () => {
    fixture.componentRef.setInput('explorerNodes', [database]);
    fixture.detectChanges();
    const pedidos: ExplorerNode[] = [];
    fixture.componentInstance.diagram.subscribe((node) => pedidos.push(node));

    const trigger = fixture.nativeElement.querySelector('.node__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const accion = [...fixture.nativeElement.querySelectorAll('.node-menu button')].find(
      (button: Element) => button.textContent?.includes('Ver diagrama'),
    ) as HTMLButtonElement;
    accion.click();

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].source.kind).toBe('database');
    expect(pedidos[0].source.name).toBe('druse_test');
  });

  /** Sobre lo que no tiene tablas debajo, el diagrama no dice nada. */
  it('sobre un procedimiento no se ofrece el diagrama', () => {
    fixture.componentRef.setInput('explorerNodes', [procedure]);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.node__menu-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const labels = [...fixture.nativeElement.querySelectorAll('.node-menu button')].map(
      (button: Element) => button.textContent?.trim(),
    );

    expect(labels).not.toContain('Ver diagrama…');
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

  describe('teclado del explorador', () => {
    const root = { ...database, expanded: true };
    const child = { ...schema, expanded: false };
    let element: HTMLElement;
    beforeEach(() => {
      fixture.componentRef.setInput('connections', [
        connection,
        { ...connection, id: 'segunda', expanded: false },
      ]);
      fixture.componentRef.setInput('explorerNodes', [root, child]);
      fixture.detectChanges();
      element = fixture.nativeElement;
    });
    const key = (target: HTMLElement, value: string, shiftKey = false) => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true }));
      fixture.detectChanges();
    };
    const rows = () => Array.from(element.querySelectorAll<HTMLElement>('[role="treeitem"]'));

    it('recorre solo las filas visibles sin activar conexiones ni objetos', () => {
      const connect = vi.fn();
      const toggle = vi.fn();
      fixture.componentInstance.connectSaved.subscribe(connect);
      fixture.componentInstance.toggleNode.subscribe(toggle);
      expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
      expect(rows()[0].getAttribute('aria-setsize')).toBe('2');
      expect(rows()[3].getAttribute('aria-posinset')).toBe('2');
      expect(rows()[2].getAttribute('aria-level')).toBe('3');
      expect(rows()[2].getAttribute('aria-setsize')).toBe('1');
      rows()[0].focus();
      key(rows()[0], 'ArrowDown');
      expect(document.activeElement).toBe(rows()[1]);
      key(rows()[1], 'End');
      expect(document.activeElement).toBe(rows()[3]);
      key(rows()[3], 'ArrowUp');
      expect(document.activeElement).toBe(rows()[2]);
      key(rows()[2], 'Home');
      expect(document.activeElement).toBe(rows()[0]);
      expect(connect).not.toHaveBeenCalled();
      expect(toggle).not.toHaveBeenCalled();
    });

    it('derecha entra en hijos o despliega; izquierda pliega o vuelve al padre', () => {
      const toggle = vi.fn();
      fixture.componentInstance.toggleNode.subscribe(toggle);
      key(rows()[0], 'ArrowRight');
      expect(document.activeElement).toBe(rows()[1]);
      key(rows()[1], 'ArrowRight');
      expect(document.activeElement).toBe(rows()[2]);
      key(rows()[2], 'ArrowRight');
      expect(toggle).toHaveBeenLastCalledWith(child.id);
      key(rows()[2], 'ArrowLeft');
      expect(document.activeElement).toBe(rows()[1]);
      key(rows()[1], 'ArrowLeft');
      expect(toggle).toHaveBeenLastCalledWith(root.id);
    });

    it('Enter abre una tabla y Espacio conserva la expansión', () => {
      fixture.componentRef.setInput('explorerNodes', [table]);
      fixture.detectChanges();
      const open = vi.fn();
      const toggle = vi.fn();
      fixture.componentInstance.openNode.subscribe(open);
      fixture.componentInstance.toggleNode.subscribe(toggle);
      key(rows()[1], 'Enter');
      expect(open).toHaveBeenCalledWith(table);
      expect(toggle).not.toHaveBeenCalled();
      key(rows()[1], ' ');
      expect(toggle).toHaveBeenCalledWith(table.id);
    });

    it('el menú usa flechas y Escape devuelve el foco sin plegar la conexión', async () => {
      const toggled = vi.fn();
      fixture.componentInstance.toggleConnection.subscribe(toggled);
      fixture.componentRef.setInput('connections', [{ ...connection, saved: true }]);
      fixture.detectChanges();
      key(rows()[0], 'F10', true);
      await fixture.whenStable();
      const trigger = element.querySelector<HTMLButtonElement>('.connection-menu-trigger')!;
      const items = element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      expect(items.length).toBe(4);
      expect(document.activeElement).toBe(items[0]);
      key(items[0], 'ArrowDown');
      expect(document.activeElement).toBe(items[1]);
      key(items[1], 'End');
      expect(document.activeElement).toBe(items[3]);
      key(items[3], 'Escape');
      expect(element.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(toggled).not.toHaveBeenCalled();
    });

    it('cada acción de conexión emite solo su intención y cierra el menú', () => {
      fixture.componentRef.setInput('connections', [{ ...connection, saved: true }]);
      fixture.detectChanges();
      const actions: string[] = [];
      const toggle = vi.fn();
      fixture.componentInstance.reconnect.subscribe((id) => actions.push('reconnect:' + id));
      fixture.componentInstance.disconnect.subscribe((id) => actions.push('disconnect:' + id));
      fixture.componentInstance.edit.subscribe((id) => actions.push('edit:' + id));
      fixture.componentInstance.forget.subscribe((id) => actions.push('forget:' + id));
      fixture.componentInstance.toggleConnection.subscribe(toggle);
      const trigger = element.querySelector<HTMLButtonElement>('.connection-menu-trigger')!;
      for (let i = 0; i < 4; i++) {
        trigger.click();
        fixture.detectChanges();
        element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[i].click();
        fixture.detectChanges();
        expect(element.querySelector('[role="menu"]')).toBeNull();
      }
      expect(actions).toEqual([
        'reconnect:connection-1',
        'disconnect:connection-1',
        'edit:connection-1',
        'forget:connection-1',
      ]);
      expect(toggle).not.toHaveBeenCalled();
    });

    it('el menú se cierra al pulsar fuera', () => {
      element.querySelector<HTMLButtonElement>('.connection-menu-trigger')!.click();
      fixture.detectChanges();
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      fixture.detectChanges();
      expect(element.querySelector('[role="menu"]')).toBeNull();
    });
  });

  describe('filtro', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      fixture.componentRef.setInput('explorerNodes', []);
      fixture.componentRef.setInput('catalogNodes', arbol);
      fixture.detectChanges();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('encuentra una tabla que cuelga de una rama plegada', () => {
      filtrar(fixture, 'pedidos');

      expect(pintados(fixture)).toEqual(['druse_test', 'public', 'pedidos']);
    });

    it('coincidir con un esquema enseña lo que hay dentro, menos las columnas', () => {
      filtrar(fixture, 'public');
      const nombres = pintados(fixture);

      expect(nombres).toContain('clientes');
      expect(nombres).toContain('pedidos');
      expect(nombres).not.toContain('descripción');
    });

    it('pone delante la coincidencia más limpia', () => {
      filtrar(fixture, 'cli');
      const nombres = pintados(fixture);

      expect(nombres.indexOf('clientes')).toBeLessThan(nombres.indexOf('factura_cliente'));
    });

    it('ignora los acentos', () => {
      filtrar(fixture, 'descripcion');

      expect(pintados(fixture)).toContain('descripción');
    });

    it('exige todos los fragmentos escritos', () => {
      filtrar(fixture, 'fac cli');

      expect(pintados(fixture)).toEqual(['druse_test', 'public', 'factura_cliente']);
    });

    it('el prefijo de clase deja fuera lo que no es de esa clase', () => {
      filtrar(fixture, 'v:cli');

      expect(pintados(fixture)).toEqual(['druse_test', 'public', 'clientes_activos']);
    });

    it('abre la conexión plegada cuando la coincidencia está dentro', () => {
      fixture.componentRef.setInput('connections', [{ ...connection, expanded: false }]);
      fixture.detectChanges();

      filtrar(fixture, 'pedidos');

      expect(pintados(fixture)).toContain('pedidos');
    });

    it('la conexión se encuentra por su nombre y por el de su base', () => {
      filtrar(fixture, 'pruebas');

      expect(fixture.nativeElement.querySelector('.node--connection')).not.toBeNull();

      filtrar(fixture, 'druse_test');

      expect(fixture.nativeElement.querySelector('.node--connection')).not.toBeNull();
    });

    it('subraya el trozo que coincide', () => {
      filtrar(fixture, 'cli');
      const marcas = [...fixture.nativeElement.querySelectorAll('.node__hit')].map(
        (mark: Element) => mark.textContent,
      );

      expect(marcas).toContain('cli');
    });

    it('dice cuántos objetos quedan, y cuándo no queda ninguno', () => {
      filtrar(fixture, 'pedidos');

      expect(fixture.nativeElement.querySelector('.filter__count')?.textContent?.trim()).toBe(
        '3 objetos',
      );

      filtrar(fixture, 'no_existe_esta_tabla');

      expect(fixture.nativeElement.querySelector('.filter__count')?.textContent?.trim()).toBe(
        'Sin coincidencias',
      );
    });

    it('limpiar devuelve el árbol al instante, sin esperar', () => {
      filtrar(fixture, 'pedidos');

      const limpiar = fixture.nativeElement.querySelector('.filter__clear') as HTMLButtonElement;
      limpiar.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.filter__count')).toBeNull();
      expect(pintados(fixture)).toEqual([]);
    });
  });
});
