import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApplicationGateway } from '../../core/application-gateway/application-gateway';
import { WorkspaceStore } from '../../core/workspace/workspace-store';
import { ConnectionForm, DatabaseObject } from '../../shared/models/workspace';
import { AppShell } from './app-shell';

/** Gateway que no habla con nadie: el shell debe montarse sin API detrás. */
function silentGateway(): Partial<ApplicationGateway> {
  return {
    getEngines: () => of([]),
    getJobs: () => of([]),
    getAiProviders: () => of({ providers: [], canStoreKeys: true, storeDescription: '' }),
    getDatabases: () => of([]),
    getChildren: () => of([]),
  };
}

/**
 * Gateway mínimo que sí deja abrir una sesión, para probar el contexto.
 *
 * `schemaName` es lo único que cambia entre motores: en PostgreSQL el esquema se
 * llama `public`, y en MySQL igual que la base.
 */
function connectedGateway(
  engine: 'mysql' | 'postgresql',
  schemaName: string,
): Partial<ApplicationGateway> {
  return {
    getEngines: () => of([]),
    getSavedConnections: () => of([]),
    getSecretStoreStatus: () => of({ available: true, description: 'Prueba' }),
    getHistory: () => of([]),
    openSession: () =>
      of({
        sessionId: 'sesion-1',
        engine,
        serverVersion: '18.0.0',
        database: 'druse_test',
        readOnly: false,
      }),
    getDatabases: () =>
      of([
        { id: 'db:druse_test', name: 'druse_test', kind: 'database' as const, hasChildren: true },
      ]),
    getChildren: () =>
      of([
        {
          id: `schema:${schemaName}`,
          name: schemaName,
          kind: 'schema' as const,
          database: 'druse_test',
          schema: schemaName,
          hasChildren: true,
        },
      ]),
  };
}

/**
 * Catálogo con fondo, para el asistente de respaldos.
 *
 * El del resto de pruebas devuelve siempre el mismo esquema, y el asistente
 * recorre hacia abajo hasta dar con las tablas: sin un final, la recursión no
 * pararía nunca.
 */
function backupGateway(): Partial<ApplicationGateway> {
  const schema: DatabaseObject = {
    id: 'schema:public',
    name: 'public',
    kind: 'schema',
    database: 'druse_test',
    schema: 'public',
    hasChildren: true,
  };
  const tables: DatabaseObject[] = [
    {
      id: 'Table:public.orders',
      name: 'orders',
      kind: 'table',
      database: 'druse_test',
      schema: 'public',
      hasChildren: true,
    },
  ];

  return {
    ...connectedGateway('postgresql', 'public'),
    getChildren: (_sessionId: string, parent: DatabaseObject) => {
      if (parent.kind === 'database') {
        return of([schema]);
      }

      return of(parent.kind === 'schema' ? tables : []);
    },
  };
}

const connectionForm: ConnectionForm = {
  name: 'Pruebas',
  engine: 'mysql',
  host: '127.0.0.1',
  port: 33306,
  database: 'druse_test',
  username: 'root',
  password: 'da-igual',
  authentication: 'password',
  sslMode: 'prefer',
  readOnly: false,
  environment: 'development',
  save: false,
  storePassword: false,
};

describe('AppShell', () => {
  let fixture: ComponentFixture<AppShell>;
  let element: HTMLElement;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [{ provide: ApplicationGateway, useValue: silentGateway() }],
    }).compileComponents();

    fixture = TestBed.createComponent(AppShell);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('reproduce las cinco zonas del mockup', () => {
    expect(element.querySelector('app-top-bar')).toBeTruthy();
    expect(element.querySelector('app-connections-sidebar')).toBeTruthy();
    expect(element.querySelector('app-editor-tabs')).toBeTruthy();
    expect(element.querySelector('app-results-panel')).toBeTruthy();
    expect(element.querySelector('app-status-bar')).toBeTruthy();
  });

  it('permite ajustar resultados y volver al tamaño automático con Intro', () => {
    const sidebar = element.querySelector<HTMLElement>('app-connections-sidebar');
    const results = element.querySelector<HTMLElement>('app-results-panel');

    expect(sidebar?.style.width).toBe('274px');
    const initial = Number.parseFloat(results!.style.height);
    const handle = element.querySelector<HTMLElement>('app-resize-handle[axis="height"]')!;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    fixture.detectChanges();
    expect(Number.parseFloat(results!.style.height)).toBe(initial + 16);
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(Number.parseFloat(results!.style.height)).toBe(initial);
  });

  it('ofrece un tirador por cada panel redimensionable', () => {
    const handles = element.querySelectorAll('app-resize-handle');

    expect(handles.length).toBe(2);
    expect(handles[0].getAttribute('aria-orientation')).toBe('vertical');
    expect(handles[1].getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('sin conexiones, invita a crear una', () => {
    expect(element.querySelector('.empty__action')?.textContent).toContain('Crear una conexión');
  });

  it('la ayuda inicial abre el formulario de conexión', async () => {
    expect(element.querySelector('.welcome h2')?.textContent).toContain('primera base de datos');
    element.querySelector<HTMLButtonElement>('.welcome__primary')!.click();
    await fixture.whenStable();
    expect(element.querySelector('app-connection-dialog')).not.toBeNull();
  });

  it('la ayuda inicial se retira cuando ya hay SQL en una pestaña', async () => {
    const store = TestBed.inject(WorkspaceStore);
    store.updateSql('SELECT 1;');
    await fixture.whenStable();
    expect(element.querySelector('.welcome')).toBeNull();
    store.createTab();
    await fixture.whenStable();
    expect(element.querySelector('.welcome')).toBeNull();
  });

  it('sin conexión, la barra de estado lo dice', () => {
    expect(element.querySelector('app-status-bar')?.textContent).toContain('Sin conexión');
  });

  it('sin conexión, no se puede ejecutar', () => {
    const run = element.querySelector<HTMLButtonElement>('app-editor-toolbar .run');

    expect(run?.disabled).toBe(true);
  });

  it('abre el diálogo de conexión desde la barra superior', async () => {
    expect(element.querySelector('app-connection-dialog')).toBeNull();

    element.querySelector<HTMLButtonElement>('app-top-bar .btn--primary')?.click();
    await fixture.whenStable();

    expect(element.querySelector('app-connection-dialog')).toBeTruthy();
  });

  it('abre una pestaña nueva y la deja activa', async () => {
    const tabsBefore = element.querySelectorAll('app-editor-tabs .tab').length;

    element.querySelector<HTMLButtonElement>('app-editor-tabs .tabs__add')?.click();
    await fixture.whenStable();

    const tabs = element.querySelectorAll('app-editor-tabs .tab');
    const active = element.querySelectorAll('app-editor-tabs .tab.is-active');

    expect(tabs.length).toBe(tabsBefore + 1);
    expect(active.length).toBe(1);
    expect(tabs[tabs.length - 1].classList).toContain('is-active');
  });

  /** Conecta un shell nuevo y expande la base, para que el árbol cargue su esquema. */
  async function toolbarTextAfterConnecting(
    engine: 'mysql' | 'postgresql',
    schemaName: string,
  ): Promise<string> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [{ provide: ApplicationGateway, useValue: connectedGateway(engine, schemaName) }],
    }).compileComponents();

    const shell = TestBed.createComponent(AppShell);
    await shell.whenStable();

    const store = TestBed.inject(WorkspaceStore);
    await store.connect({ ...connectionForm, engine });
    // Expandir la base es lo que hace que el árbol cargue su esquema, que es de
    // donde sale el contexto.
    await store.toggleNode(store.explorerNodes()[0].id);

    shell.detectChanges();
    await shell.whenStable();

    return (
      (shell.nativeElement as HTMLElement).querySelector('app-editor-toolbar')?.textContent ?? ''
    );
  }

  it('no inventa un esquema en el contexto del editor', async () => {
    // `public` es el esquema por omisión de PostgreSQL y de nadie más: en SQL
    // Server es `dbo` y en MySQL el esquema es la propia base. Escribirlo fijo
    // mentía en dos motores de tres.
    const toolbar = await toolbarTextAfterConnecting('mysql', 'druse_test');

    expect(toolbar).toContain('druse_test');
    expect(toolbar).not.toContain('public');
  });

  it('muestra el esquema cuando el motor sí tiene uno propio', async () => {
    const toolbar = await toolbarTextAfterConnecting('postgresql', 'public');

    expect(toolbar).toContain('druse_test.public');
  });

  it('al cerrar la pestaña activa deja otra activa', async () => {
    element.querySelector<HTMLButtonElement>('app-editor-tabs .tabs__add')?.click();
    await fixture.whenStable();

    element.querySelector<HTMLButtonElement>('app-editor-tabs .tab.is-active .tab__close')?.click();
    await fixture.whenStable();

    // Nunca debe quedar el editor sin pestaña seleccionada.
    expect(element.querySelectorAll('app-editor-tabs .tab.is-active').length).toBe(1);
  });

  it('no cierra una pestaña modificada sin confirmación', async () => {
    element.querySelector<HTMLButtonElement>('app-editor-tabs .tabs__add')?.click();
    await fixture.whenStable();
    const store = TestBed.inject(WorkspaceStore);
    store.updateSql('SELECT 1;');
    fixture.detectChanges();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const count = store.tabs().length;

    element.querySelector<HTMLButtonElement>('app-editor-tabs .tab.is-active .tab__close')?.click();
    await fixture.whenStable();

    expect(confirm).toHaveBeenCalled();
    expect(store.tabs().length).toBe(count);
  });

  it('abre la paleta global con Ctrl+K', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element.querySelector('app-command-palette')).toBeTruthy();
  });

  it('la paleta conserva la búsqueda y explica por qué no puede ejecutar sin sesión', async () => {
    const store = TestBed.inject(WorkspaceStore);
    store.updateSql('SELECT 1;');
    const execute = vi.spyOn(store, 'execute');
    element.querySelector<HTMLButtonElement>('[aria-label="Abrir búsqueda global"]')!.click();
    await fixture.whenStable();
    const search = element.querySelector<HTMLInputElement>('app-command-palette input')!;
    search.value = 'Ejecutar consulta activa';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    expect(execute).not.toHaveBeenCalled();
    expect(
      element.querySelector('app-command-palette [aria-disabled="true"]')?.textContent,
    ).toContain('Abre una conexión');
    expect(search.value).toBe('Ejecutar consulta activa');
  });

  describe('atajos de pestañas', () => {
    /** Deja tres pestañas abiertas y la tercera activa. */
    async function tresPestanas(): Promise<WorkspaceStore> {
      const store = TestBed.inject(WorkspaceStore);

      store.createTab();
      store.createTab();
      fixture.detectChanges();
      await fixture.whenStable();

      return store;
    }

    function pulsar(key: string, modificadores: Partial<KeyboardEventInit> = {}): void {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, ...modificadores }));
      fixture.detectChanges();
    }

    it('Alt y un número va a esa pestaña', async () => {
      const store = await tresPestanas();

      pulsar('1', { altKey: true });

      expect(store.tabs()[0].active).toBe(true);
    });

    it('Alt+9 va a la última aunque no sean nueve', async () => {
      const store = await tresPestanas();
      pulsar('1', { altKey: true });

      pulsar('9', { altKey: true });

      expect(store.tabs().at(-1)?.active).toBe(true);
    });

    /** Con tres pestañas, «siguiente» desde la última es la primera. */
    it('las flechas dan la vuelta por los extremos', async () => {
      const store = await tresPestanas();

      pulsar('ArrowRight', { altKey: true });

      expect(store.tabs()[0].active).toBe(true);

      pulsar('ArrowLeft', { altKey: true });

      expect(store.tabs().at(-1)?.active).toBe(true);
    });

    it('Ctrl+F4 cierra la pestaña de delante', async () => {
      const store = await tresPestanas();
      const antes = store.tabs().length;

      pulsar('F4', { ctrlKey: true });
      await fixture.whenStable();

      expect(store.tabs().length).toBe(antes - 1);
      expect(store.tabs().filter((tab) => tab.active)).toHaveLength(1);
    });

    /**
     * Con un diálogo delante el teclado es suyo: cambiar de pestaña por detrás
     * dejaría al usuario mirando un formulario que ya no corresponde.
     */
    it('con la paleta abierta, los atajos de pestaña no actúan', async () => {
      const store = await tresPestanas();
      const activa = store.tabs().findIndex((tab) => tab.active);

      pulsar('k', { ctrlKey: true });
      await fixture.whenStable();
      pulsar('1', { altKey: true });

      expect(store.tabs().findIndex((tab) => tab.active)).toBe(activa);
    });
  });

  it('F1 abre la hoja de atajos', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element.querySelector('app-shortcuts-sheet')).toBeTruthy();
  });

  it('Actividad se abre desde la barra, bloquea atajos de fondo y cierra con Escape', async () => {
    element.querySelector<HTMLButtonElement>('.op--activity')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = element.querySelector<HTMLElement>('app-activity-dialog .dialog');
    expect(dialog).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' }));
    fixture.detectChanges();
    expect(element.querySelector('app-shortcuts-sheet')).toBeNull();
    dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(element.querySelector('app-activity-dialog')).toBeNull();
  });

  it('duplicar la pestaña deja el mismo SQL en otra nueva', async () => {
    const store = TestBed.inject(WorkspaceStore);
    store.updateSql('SELECT 42;');
    fixture.detectChanges();
    const antes = store.tabs().length;

    element.querySelector('app-command-palette');
    (fixture.componentInstance as unknown as { duplicateTab(): void }).duplicateTab();
    await fixture.whenStable();

    expect(store.tabs().length).toBe(antes + 1);
    expect(store.activeTab()?.sql).toBe('SELECT 42;');
  });

  /**
   * El enganche completo de la función: sin esto, el asistente existe en el
   * paquete pero no hay forma de llegar a él desde la aplicación.
   */
  it('abre el asistente de respaldos desde el menú del árbol', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [{ provide: ApplicationGateway, useValue: backupGateway() }],
    }).compileComponents();

    const shell = TestBed.createComponent(AppShell);
    const dom = shell.nativeElement as HTMLElement;
    await shell.whenStable();
    await TestBed.inject(WorkspaceStore).connect({ ...connectionForm, engine: 'postgresql' });
    shell.detectChanges();

    const fila = [...dom.querySelectorAll('.node--object')].find((nodo) =>
      nodo.textContent?.includes('druse_test'),
    ) as HTMLElement;
    fila.querySelector<HTMLButtonElement>('.node__menu-trigger')?.click();
    shell.detectChanges();

    const respaldar = [...fila.querySelectorAll('.node-menu button')].find((boton) =>
      boton.textContent?.includes('Respaldar'),
    ) as HTMLButtonElement;

    expect(respaldar).toBeTruthy();

    respaldar.click();
    shell.detectChanges();
    await shell.whenStable();
    shell.detectChanges();

    expect(dom.querySelector('app-backup-dialog')).toBeTruthy();
  });

  it('en móvil conserva un control para abrir el explorador', () => {
    expect(element.querySelector('.mobile-explorer-toggle')).toBeTruthy();
  });

  it('ajusta el asistente con teclado, conserva el panel al cerrar y restablece su ancho', async () => {
    vi.spyOn(TestBed.inject(ApplicationGateway), 'getAiProviders').mockReturnValue(
      of({
        providers: [
          {
            id: 'local-test',
            name: 'Prueba',
            kind: 'openaicompatible',
            baseUrl: 'http://localhost:11434',
            model: 'prueba',
            command: '',
            disclosure: 'nothing',
            ownSession: false,
            isDefault: true,
            hasStoredKey: false,
          },
        ],
        canStoreKeys: true,
        storeDescription: '',
      }),
    );
    const toggle = element.querySelector<HTMLButtonElement>('app-top-bar .assistant')!;
    toggle.click();
    await fixture.whenStable();
    const panel = element.querySelector<HTMLElement>('app-ai-panel')!;
    const initial = parseFloat(panel.style.width);
    const draft = panel.querySelector<HTMLTextAreaElement>('textarea')!;
    draft.value = 'Explica esta consulta';
    draft.dispatchEvent(new Event('input'));
    element
      .querySelector<HTMLElement>('.ai-resize')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await fixture.whenStable();
    expect(parseFloat(panel.style.width)).toBe(initial + 16);
    panel.querySelector<HTMLButtonElement>('[aria-label="Cerrar el asistente"]')!.click();
    await fixture.whenStable();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    toggle.click();
    await fixture.whenStable();
    expect(element.querySelector('app-ai-panel')).toBe(panel);
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('textarea')?.value).toBe('Explica esta consulta');
    expect(parseFloat(panel.style.width)).toBe(initial + 16);
    element
      .querySelector<HTMLElement>('.ai-resize')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(parseFloat(panel.style.width)).toBe(initial);
    element
      .querySelector<HTMLElement>('.ai-resize')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  it('pliega el explorador sin perder el filtro ni el ancho elegido y el atajo lo recupera', async () => {
    const toggle = element.querySelector<HTMLButtonElement>('.explorer-toggle')!;
    const sidebar = element.querySelector<HTMLElement>('.sidebar')!;
    const input = sidebar.querySelector<HTMLInputElement>('.filter__input')!;
    const resize = element.querySelector<HTMLElement>('.sidebar + app-resize-handle')!;
    input.value = 'ventas';
    input.dispatchEvent(new Event('input'));
    resize.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await fixture.whenStable();
    const width = sidebar.style.width;
    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(sidebar.classList.contains('is-collapsed')).toBe(true);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true }),
    );
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(sidebar.classList.contains('is-collapsed')).toBe(false);
    expect(sidebar.style.width).toBe(width);
    expect(sidebar.querySelector('.filter__input')).toBe(input);
    expect(input.value).toBe('ventas');
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe(6);
  });

  it('el atajo del explorador respeta el diálogo abierto', async () => {
    element.querySelector<HTMLButtonElement>('.explorer-toggle')!.click();
    element.querySelector<HTMLButtonElement>('.op--activity')!.click();
    await fixture.whenStable();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true }),
    );
    await fixture.whenStable();
    expect(element.querySelector('.sidebar')!.classList.contains('is-collapsed')).toBe(true);
    expect(document.activeElement?.closest('app-connections-sidebar')).toBeNull();
  });
});
