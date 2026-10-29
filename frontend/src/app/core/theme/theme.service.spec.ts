import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import { DesktopHost } from '../application-gateway/desktop-host';
import { THEME_PREFERENCE, ThemeService, cachedAppearance } from './theme.service';
import { BackgroundTarget, DEFAULT_GRID } from './appearance';
import { EditorBackgroundStore } from './editor-background.store';

/** Gateway mínimo: de todo lo que ofrece, el tema solo usa las preferencias. */
class FakeGateway {
  readonly saved: { key: string; value: string }[] = [];
  fails = false;

  setPreference(key: string, value: string): Observable<void> {
    if (this.fails) {
      return throwError(() => new Error('sin servidor'));
    }

    this.saved.push({ key, value });

    return of(undefined);
  }
}

/** Envoltorio de escritorio de mentira: solo interesa qué tema se le pide. */
class FakeDesktopHost {
  readonly asked: string[] = [];

  async setWindowTheme(theme: string): Promise<void> {
    this.asked.push(theme);
  }
}

describe('ThemeService', () => {
  let gateway: FakeGateway;
  let desktop: FakeDesktopHost;
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    gateway = new FakeGateway();
    desktop = new FakeDesktopHost();

    TestBed.configureTestingModule({
      providers: [
        { provide: ApplicationGateway, useValue: gateway },
        { provide: DesktopHost, useValue: desktop },
      ],
    });

    service = TestBed.inject(ThemeService);
  });

  it('arranca en oscuro y lo deja escrito en el documento', () => {
    expect(service.theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('aplica y guarda el tema elegido', async () => {
    await service.set('light');

    expect(service.theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(gateway.saved).toEqual([{ key: THEME_PREFERENCE, value: 'light' }]);
  });

  it('no vuelve a guardar el tema que ya estaba puesto', async () => {
    await service.set('dark');

    expect(gateway.saved).toEqual([]);
  });

  it('recuerda la apariencia en esta máquina, para el arranque siguiente', async () => {
    await service.set('light');

    expect(cachedAppearance().theme).toBe('light');
  });

  it('mantiene el tema aunque no se pueda guardar en el servidor', async () => {
    gateway.fails = true;

    await service.set('light');

    expect(service.theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('adopta el tema que llega en las preferencias', () => {
    service.adopt({ [THEME_PREFERENCE]: 'light' });

    expect(service.theme()).toBe('light');
  });

  it('cae en oscuro ante una preferencia que ya no significa nada', () => {
    service.adopt({ [THEME_PREFERENCE]: 'solarizado' });

    expect(service.theme()).toBe('dark');
  });

  it('pide al envoltorio que tiña también el marco de la ventana', async () => {
    await service.set('light');

    // El primero es el del arranque; el segundo, el cambio.
    expect(desktop.asked).toEqual(['dark', 'light']);
  });

  it('alterna entre los dos', async () => {
    await service.toggle();
    expect(service.theme()).toBe('light');

    await service.toggle();
    expect(service.theme()).toBe('dark');
  });
});

describe('fondos independientes del editor y los resultados', () => {
  const images = {
    editor: { name: 'editor.png', source: 'data:image/png;base64,AAAA' },
    grid: { name: 'results.png', source: 'data:image/png;base64,BBBB' },
  };
  let service: ThemeService;
  let forgotten: BackgroundTarget[];

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    forgotten = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: ApplicationGateway, useValue: new FakeGateway() },
        { provide: DesktopHost, useValue: new FakeDesktopHost() },
        {
          provide: EditorBackgroundStore,
          useValue: {
            choose: async (target: BackgroundTarget) => images[target],
            load: async (target: BackgroundTarget) => images[target].source,
            forget: async (target: BackgroundTarget = 'editor') => {
              forgotten.push(target);
            },
          },
        },
      ],
    });
    service = TestBed.inject(ThemeService);
  });

  it('elegir, ajustar y quitar el fondo de resultados no cambia el editor', async () => {
    await service.chooseBackground();
    await service.chooseBackground('grid');
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--dr-grid-background')).toContain(images.grid.source);
    expect(style.getPropertyValue('--dr-editor-background')).toContain(images.editor.source);
    await service.update({
      grid: {
        ...service.appearance().grid,
        background: {
          ...service.appearance().grid.background!,
          opacity: 25,
          fit: 'tile',
          scale: 40,
        },
      },
    });
    expect(style.getPropertyValue('--dr-grid-background-opacity')).toBe('0.25');
    expect(style.getPropertyValue('--dr-grid-background-size')).toBe('40% auto');
    expect(cachedAppearance().grid.background?.name).toBe('results.png');
    await service.clearBackground('grid');
    expect(style.getPropertyValue('--dr-grid-background')).toBe('');
    expect(style.getPropertyValue('--dr-editor-background')).toContain(images.editor.source);
    expect(forgotten).toEqual(['grid']);
  });

  it('restaura la imagen al adoptar preferencias y restablece solo resultados', async () => {
    await service.chooseBackground();
    service.adopt({ 'ui.gridBackground.name': 'results.png' });
    await Promise.resolve();
    expect(document.documentElement.style.getPropertyValue('--dr-grid-background')).toContain(
      images.grid.source,
    );
    await service.resetGrid();
    expect(service.appearance().grid).toEqual(DEFAULT_GRID);
    expect(service.appearance().background?.name).toBe('editor.png');
    expect(document.documentElement.style.getPropertyValue('--dr-grid-background')).toBe('');
  });

  it('el reinicio general borra ambas imágenes', async () => {
    await service.chooseBackground();
    await service.chooseBackground('grid');
    await service.reset();
    expect(forgotten).toEqual(['editor', 'grid']);
    expect(service.appearance().background).toBeNull();
    expect(service.appearance().grid.background).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--dr-grid-background')).toBe('');
  });

  it('una caché anterior sin fondo de resultados recibe el valor por defecto', () => {
    localStorage.setItem('druse.appearance', JSON.stringify({ grid: { fontSize: 14 } }));
    expect(cachedAppearance().grid.background).toBeNull();
    expect(cachedAppearance().grid.fontSize).toBe(14);
  });
});
