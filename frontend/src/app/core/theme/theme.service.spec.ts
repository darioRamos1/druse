import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import { THEME_PREFERENCE, ThemeService, parseTheme } from './theme.service';

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

describe('ThemeService', () => {
  let gateway: FakeGateway;
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    gateway = new FakeGateway();

    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
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

  it('recuerda el tema en esta máquina, para el arranque siguiente', async () => {
    await service.set('light');

    expect(parseTheme(localStorage.getItem('druse.theme'))).toBe('light');
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

  it('alterna entre los dos', async () => {
    await service.toggle();
    expect(service.theme()).toBe('light');

    await service.toggle();
    expect(service.theme()).toBe('dark');
  });
});
