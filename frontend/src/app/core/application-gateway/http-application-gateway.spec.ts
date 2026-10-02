import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { lastValueFrom, toArray } from 'rxjs';
import { AiStreamEvent, SaveAiProviderRequest } from '../../shared/models/ai';
import { DesktopHost } from './desktop-host';
import { HttpApplicationGateway } from './http-application-gateway';

describe('contrato SSE de las pruebas de IA', () => {
  let gateway: HttpApplicationGateway;
  const request: SaveAiProviderRequest = {
    name: 'Codex',
    kind: 'localcli',
    baseUrl: '',
    command: 'codex',
    model: 'gpt-6.1-sol',
    disclosure: 'nothing',
    ownSession: false,
    isDefault: false,
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        HttpApplicationGateway,
        { provide: HttpClient, useValue: {} },
        {
          provide: DesktopHost,
          useValue: {
            connection: () => ({ baseUrl: 'http://127.0.0.1:1234', token: 'token de prueba' }),
          },
        },
      ],
    });
    gateway = TestBed.inject(HttpApplicationGateway);
  });
  afterEach(() => vi.unstubAllGlobals());

  function response(parts: string[]): void {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  }

  it('envía el perfil al endpoint real y recompone sucesos partidos', async () => {
    response([
      'event: chu',
      'nk\ndata: {"text":"O"}\n\nevent: chunk\ndata: {"text":"K"}\n\nevent: done\ndata: {}\n\n',
    ]);
    const events = await lastValueFrom(gateway.streamAiProviderTest(request).pipe(toArray()));
    expect(events).toEqual([
      { kind: 'chunk', text: 'O' },
      { kind: 'chunk', text: 'K' },
      { kind: 'done' },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/api/ai/providers/test-response',
      expect.objectContaining({
        body: JSON.stringify(request),
        headers: expect.objectContaining({ 'X-Druse-Token': 'token de prueba' }),
      }),
    );
  });

  it('conserva la categoría y el detalle técnico del error', async () => {
    response([
      'event: error\ndata: {"message":"modelo rechazado","code":"unsupportedModel","detail":"JSON original"}\n\n',
    ]);
    expect(await lastValueFrom(gateway.streamAiProviderTest(request).pipe(toArray()))).toEqual([
      {
        kind: 'error',
        message: 'modelo rechazado',
        code: 'unsupportedModel',
        detail: 'JSON original',
      },
    ]);
  });

  it('la desconexión sin evento terminal es un error', async () => {
    response(['event: chunk\ndata: {"text":"parcial"}\n\n']);
    const events = await lastValueFrom(gateway.streamAiProviderTest(request).pipe(toArray()));
    expect(events.at(-1)?.kind).toBe('error');
  });

  it('muestra la validación de la API sin obligar a leer el JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"message":"Escribe el nombre del proveedor."}', { status: 400 }),
        ),
    );
    const events = await lastValueFrom(gateway.streamAiProviderTest(request).pipe(toArray()));
    expect(events[0]).toMatchObject({ kind: 'error', message: 'Escribe el nombre del proveedor.' });
  });

  it('acepta saltos CRLF aunque estén partidos entre fragmentos', async () => {
    response([
      'event: chunk\r',
      '\ndata: {"text":"OK"}\r\n\r',
      '\nevent: done\r\ndata: {}\r\n\r\n',
    ]);
    expect(await lastValueFrom(gateway.streamAiProviderTest(request).pipe(toArray()))).toEqual([
      { kind: 'chunk', text: 'OK' },
      { kind: 'done' },
    ]);
  });

  it('cancelar aborta fetch y evita errores tardíos', async () => {
    let signal: AbortSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) => {
        signal = init.signal;
        return new Promise(() => {});
      }),
    );
    const events: AiStreamEvent[] = [];
    const subscription = gateway
      .streamAiProviderTest(request)
      .subscribe((event) => events.push(event));
    subscription.unsubscribe();
    expect(signal!.aborted).toBe(true);
    expect(events).toEqual([]);
  });
});
