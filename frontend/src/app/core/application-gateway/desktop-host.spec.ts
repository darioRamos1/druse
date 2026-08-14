import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { apiInterceptor } from './api-interceptor';
import { DesktopHost } from './desktop-host';

describe('DesktopHost', () => {
  afterEach(() => {
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it('fuera del escritorio no hay host ni token', async () => {
    TestBed.configureTestingModule({});
    const host = TestBed.inject(DesktopHost);

    await host.initialize();

    expect(host.isDesktop).toBe(false);
    expect(host.connection()).toEqual({ baseUrl: '', token: null });
  });

  it('dentro del escritorio pide el punto de conexión al envoltorio', async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: () =>
          Promise.resolve({ base_url: 'http://127.0.0.1:54321', token: 'secreto' }),
      },
    };

    TestBed.configureTestingModule({});
    const host = TestBed.inject(DesktopHost);

    await host.initialize();

    expect(host.isDesktop).toBe(true);
    expect(host.connection()).toEqual({
      baseUrl: 'http://127.0.0.1:54321',
      token: 'secreto',
    });
  });

  it('si el envoltorio falla, no impide arrancar', async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: () => Promise.reject(new Error('sin respuesta')) },
    };

    TestBed.configureTestingModule({});
    const host = TestBed.inject(DesktopHost);

    // Un envoltorio que no responde no puede dejar la ventana en blanco: se
    // sigue con rutas relativas y el fallo aparecerá con un error claro.
    await host.initialize();

    expect(host.connection().baseUrl).toBe('');
  });

  it('abre y guarda documentos SQL mediante comandos tipados', async () => {
    const invocations: { command: string; args?: unknown }[] = [];
    (window as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (command: string, args?: unknown) => {
          invocations.push({ command, args });
          return Promise.resolve(
            command === 'open_sql_file'
              ? { documentId: 'sql-1', fileName: 'ventas.sql', contents: 'SELECT 1;' }
              : { documentId: 'sql-1', fileName: 'ventas.sql' },
          );
        },
      },
    };
    TestBed.configureTestingModule({});
    const host = TestBed.inject(DesktopHost);

    await expect(host.openSqlFile()).resolves.toEqual({
      documentId: 'sql-1',
      fileName: 'ventas.sql',
      contents: 'SELECT 1;',
    });
    await host.saveSqlFile('sql-1', 'SELECT 2;');

    expect(invocations).toEqual([
      { command: 'open_sql_file', args: undefined },
      {
        command: 'save_sql_file',
        args: { documentId: 'sql-1', contents: 'SELECT 2;' },
      },
    ]);
  });
});

describe('apiInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let host: DesktopHost;

  function setup(connection: { baseUrl: string; token: string | null }): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    host = TestBed.inject(DesktopHost);
    // El estado real lo fija `initialize`; aquí se inyecta directamente para
    // probar el interceptor sin depender del envoltorio.
    (host as unknown as { _connection: { set(value: unknown): void } })._connection.set(
      connection,
    );

    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  }

  afterEach(() => controller?.verify());

  it('en desarrollo deja la petición intacta', () => {
    setup({ baseUrl: '', token: null });

    http.get('/api/health').subscribe();

    const request = controller.expectOne('/api/health');
    expect(request.request.headers.has('X-Druse-Token')).toBe(false);
    request.flush({});
  });

  it('en escritorio antepone el host y añade el token', () => {
    setup({ baseUrl: 'http://127.0.0.1:54321', token: 'secreto' });

    http.get('/api/connections').subscribe();

    const request = controller.expectOne('http://127.0.0.1:54321/api/connections');
    expect(request.request.headers.get('X-Druse-Token')).toBe('secreto');
    request.flush([]);
  });

  it('no toca las peticiones que no van a la API', () => {
    setup({ baseUrl: 'http://127.0.0.1:54321', token: 'secreto' });

    http.get('/assets/monaco/vs/loader.js').subscribe();

    const request = controller.expectOne('/assets/monaco/vs/loader.js');
    expect(request.request.headers.has('X-Druse-Token')).toBe(false);
    request.flush('');
  });
});
