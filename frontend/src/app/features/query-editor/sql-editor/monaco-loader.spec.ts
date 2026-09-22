import { TestBed } from '@angular/core/testing';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { I18nService } from '../../../core/i18n/i18n.service';
import { MonacoLoader } from './monaco-loader';

/**
 * Estas pruebas existen por un fallo concreto: el cargador pedía los módulos
 * **sin callback de error**, así que cuando uno no cargaba la promesa se quedaba
 * colgada. El editor no mostraba editor ni error: se quedaba «cargando» para
 * siempre, y como la promesa quedaba cacheada, tampoco se recuperaba.
 */
describe('MonacoLoader', () => {
  let loader: MonacoLoader;
  let scripts: HTMLScriptElement[];
  let originalMonaco: PropertyDescriptor | undefined;
  let originalRequire: PropertyDescriptor | undefined;

  /** Sustituye la inserción del script para no cargar Monaco de verdad. */
  function interceptScripts(): void {
    scripts = [];

    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      scripts.push(node as HTMLScriptElement);
      return node;
    }) as typeof document.head.appendChild);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: {} }],
    });
    loader = TestBed.inject(MonacoLoader);

    originalMonaco = Object.getOwnPropertyDescriptor(window, 'monaco');
    originalRequire = Object.getOwnPropertyDescriptor(window, 'require');
    delete (window as { monaco?: unknown }).monaco;
    delete (window as { require?: unknown }).require;

    interceptScripts();
  });

  afterEach(() => {
    // El runner comparte el navegador entre archivos: dejar { editor: {} }
    // aquí hacía que App intentara montar un Monaco incompleto en otra suite.
    for (const [key, descriptor] of [
      ['monaco', originalMonaco],
      ['require', originalRequire],
    ] as const) {
      if (descriptor) Object.defineProperty(window, key, descriptor);
      else Reflect.deleteProperty(window, key);
    }
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const esTraduccion = (script: HTMLScriptElement) => script.src.endsWith('/nls/lang/es.js');
  const esCargador = (script: HTMLScriptElement) => script.src.endsWith('/vs/loader.js');

  /**
   * Deja pasar la traducción —o su fallo— y devuelve el script del cargador,
   * que solo se inserta después.
   */
  async function cargador(traduccion: 'load' | 'error' = 'load'): Promise<HTMLScriptElement> {
    const textos = scripts.filter(esTraduccion).at(-1)!;

    if (traduccion === 'load') {
      textos.onload?.(new Event('load'));
    } else {
      textos.onerror?.(new Event('error'));
    }

    await vi.advanceTimersByTimeAsync(0);

    return scripts.filter(esCargador).at(-1)!;
  }

  /**
   * Los textos en español van **antes** que Monaco y como script suelto.
   *
   * Se pedían con la opción `vs/nls` del cargador AMD, y como el archivo no es
   * un módulo AMD, el cargador se quedaba esperando su `define`: el editor no
   * arrancaba nunca.
   */
  it('carga los textos en español antes que el cargador de Monaco', async () => {
    void loader.load();

    expect(scripts.map((script) => script.src.split('/assets/')[1])).toEqual([
      'monaco/vs/nls/lang/es.js',
    ]);

    let options: Record<string, unknown> | null = null;
    (window as { require?: unknown }).require = Object.assign(() => undefined, {
      config: (value: Record<string, unknown>) => (options = value),
    });

    (await cargador()).onload?.(new Event('load'));

    expect(scripts.filter(esCargador)).toHaveLength(1);
    expect(options).not.toHaveProperty('vs/nls');
  });

  it('sigue al idioma de Druse: en inglés no carga textos, porque Monaco ya viene así', async () => {
    await TestBed.inject(I18nService).setLocale('en', { persist: false });

    void loader.load();
    await vi.advanceTimersByTimeAsync(0);

    expect(scripts.map((script) => script.src.split('/assets/')[1])).toEqual([
      'monaco/vs/loader.js',
    ]);
  });

  it('si los textos no llegan, el editor arranca igual, en inglés', async () => {
    const promesa = loader.load();

    (window as { require?: unknown }).require = Object.assign(
      (_modules: string[], onLoad: () => void) => {
        (window as { monaco?: unknown }).monaco = { editor: {} };
        onLoad();
      },
      { config: () => undefined },
    );

    (await cargador('error')).onload?.(new Event('load'));

    await expect(promesa).resolves.toBeDefined();
  });

  it('un módulo que no carga rechaza en lugar de dejar la espera colgada', async () => {
    const promesa = loader.load();

    (window as { require?: unknown }).require = Object.assign(
      (_modules: string[], _onLoad: () => void, onError?: (error: unknown) => void) => {
        onError?.({ moduleId: 'vs/editor/editor.main', errorCode: 'load' });
      },
      { config: () => undefined },
    );

    (await cargador()).onload?.(new Event('load'));

    await expect(promesa).rejects.toThrow(/vs\/editor\/editor\.main/);
  });

  /** Cachear el rechazo dejaría el editor roto el resto de la sesión. */
  it('tras fallar se puede volver a intentar', async () => {
    const primera = loader.load();

    (window as { require?: unknown }).require = Object.assign(
      (_modules: string[], _onLoad: () => void, onError?: (error: unknown) => void) => {
        onError?.(new Error('la red iba mal'));
      },
      { config: () => undefined },
    );

    (await cargador()).onload?.(new Event('load'));
    await expect(primera).rejects.toThrow(/la red iba mal/);

    // El segundo intento vuelve a inyectar el script: si se hubiera guardado la
    // promesa fallida, no habría segundo intento.
    const segunda = loader.load();

    expect(scripts.filter(esTraduccion)).toHaveLength(2);

    (window as { require?: unknown }).require = Object.assign(
      (_modules: string[], onLoad: () => void) => {
        (window as { monaco?: unknown }).monaco = { editor: {} };
        onLoad();
      },
      { config: () => undefined },
    );

    (await cargador()).onload?.(new Event('load'));

    await expect(segunda).resolves.toBeDefined();
  });

  it('si el script del cargador no llega, se rechaza con un motivo', async () => {
    const promesa = loader.load();

    (await cargador()).onerror?.(new Event('error'));

    await expect(promesa).rejects.toThrow(/No se pudo cargar Monaco/);
  });

  it('con Monaco ya cargado no se vuelve a inyectar nada', async () => {
    (window as { monaco?: unknown }).monaco = { editor: {} };

    await expect(loader.load()).resolves.toBeDefined();
    expect(scripts).toHaveLength(0);
  });
});
