import { TestBed } from '@angular/core/testing';

import { SplashScreen } from './splash-screen';

describe('SplashScreen', () => {
  /** Deja en el documento el mismo elemento que trae `index.html`. */
  function pintarSplash(): HTMLElement {
    const element = document.createElement('div');
    element.id = 'druse-splash';
    element.className = 'druse-splash';
    document.body.append(element);

    return element;
  }

  function create(): SplashScreen {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});

    return TestBed.inject(SplashScreen);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // El suelo de permanencia se cuenta desde que abrió la ventana, así que cada
    // prueba dice cuánto lleva abierta.
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
  });

  afterEach(() => {
    document.getElementById('druse-splash')?.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('quita la pantalla del documento al terminar el arranque', () => {
    const element = pintarSplash();
    const splash = create();

    expect(splash.visible).toBe(true);

    splash.dismiss();
    vi.advanceTimersByTime(0);

    expect(element.classList.contains('is-leaving')).toBe(true);
    expect(element.isConnected).toBe(true);

    // Hasta que la transición no acaba, el elemento sigue puesto: quitarlo antes
    // sería un corte en vez de un desvanecido.
    vi.advanceTimersByTime(260);

    expect(element.isConnected).toBe(false);
    expect(splash.visible).toBe(false);
  });

  it('se deja ver un mínimo aunque el arranque sea instantáneo', () => {
    vi.spyOn(performance, 'now').mockReturnValue(120);

    const element = pintarSplash();

    create().dismiss();
    vi.advanceTimersByTime(120);

    // Todavía entera: un arranque de 120 ms no puede verse como un parpadeo.
    expect(element.classList.contains('is-leaving')).toBe(false);

    vi.advanceTimersByTime(330);

    expect(element.classList.contains('is-leaving')).toBe(true);
  });

  it('la retira sola si el arranque nunca termina', () => {
    const element = pintarSplash();

    create();

    // El plazo de seguridad son 12 s; se pasa de largo para incluir también el
    // desvanecido que dispara.
    vi.advanceTimersByTime(13_000);

    expect(element.isConnected).toBe(false);
  });

  it('no vuelve a empezar si se pide retirarla dos veces', () => {
    const element = pintarSplash();
    const splash = create();

    splash.dismiss();
    vi.advanceTimersByTime(260);
    splash.dismiss();

    expect(element.isConnected).toBe(false);

    // Y lo que quede en la cola no puede tocar un elemento que ya no está.
    expect(() => vi.advanceTimersByTime(12_000)).not.toThrow();
  });

  it('sin pantalla en el documento no hace nada', () => {
    const splash = create();

    expect(splash.visible).toBe(false);
    expect(() => splash.dismiss()).not.toThrow();
    // Ni siquiera arma el plazo de seguridad: no hay nada que retirar.
    expect(vi.getTimerCount()).toBe(0);
  });
});
