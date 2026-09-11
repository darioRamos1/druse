import { TestBed } from '@angular/core/testing';

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
    TestBed.configureTestingModule({});
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

  it('un módulo que no carga rechaza en lugar de dejar la espera colgada', async () => {
    const promesa = loader.load();

    (window as { require?: unknown }).require = Object.assign(
      (_modules: string[], _onLoad: () => void, onError?: (error: unknown) => void) => {
        onError?.({ moduleId: 'vs/editor/editor.main', errorCode: 'load' });
      },
      { config: () => undefined },
    );

    scripts[0].onload?.(new Event('load'));

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

    scripts[0].onload?.(new Event('load'));
    await expect(primera).rejects.toThrow(/la red iba mal/);

    // El segundo intento vuelve a inyectar el script: si se hubiera guardado la
    // promesa fallida, no habría segundo intento.
    const segunda = loader.load();

    expect(scripts).toHaveLength(2);

    (window as { require?: unknown }).require = Object.assign(
      (_modules: string[], onLoad: () => void) => {
        (window as { monaco?: unknown }).monaco = { editor: {} };
        onLoad();
      },
      { config: () => undefined },
    );

    scripts[1].onload?.(new Event('load'));

    await expect(segunda).resolves.toBeDefined();
  });

  it('si el script del cargador no llega, se rechaza con un motivo', async () => {
    const promesa = loader.load();

    scripts[0].onerror?.(new Event('error'));

    await expect(promesa).rejects.toThrow(/No se pudo cargar Monaco/);
  });

  it('con Monaco ya cargado no se vuelve a inyectar nada', async () => {
    (window as { monaco?: unknown }).monaco = { editor: {} };

    await expect(loader.load()).resolves.toBeDefined();
    expect(scripts).toHaveLength(0);
  });
});
