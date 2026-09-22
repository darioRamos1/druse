import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import { I18nService } from './i18n.service';
import { formatLocale } from './locale-format';

describe('I18nService', () => {
  let saved: [string, string][];
  let service: I18nService;

  beforeEach(() => {
    localStorage.clear();
    saved = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApplicationGateway,
          useValue: {
            setPreference: (key: string, value: string) => {
              saved.push([key, value]);
              return of(undefined);
            },
          },
        },
      ],
    });
    service = TestBed.inject(I18nService);
  });

  afterEach(() => {
    document.documentElement.lang = 'es';
  });

  it('arranca en español y traduce desde su catálogo', () => {
    expect(service.locale()).toBe('es');
    expect(service.t('settings.language.title')).toBe('Idioma');
  });

  it('cambia de idioma al momento, lo recuerda y lo guarda', async () => {
    await service.setLocale('en');

    expect(service.t('settings.language.title')).toBe('Language');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('druse.locale')).toBe('en');
    expect(saved).toEqual([['ui.locale', 'en']]);
    // Los números y fechas siguen al idioma elegido.
    expect(formatLocale()).toBe('en');
  });

  it('tParts devuelve la frase en trozos, con cada elemento marcado en su sitio', async () => {
    await service.setLocale('en', { persist: false });

    const parts = service.tParts('settings.license.grant', { copyright: 'COPYRIGHT.txt' });
    const code = parts.find((part) => part.tag === 'copyright');

    expect(code?.text).toBe('COPYRIGHT.txt');
    expect(parts.map((part) => part.text).join('')).toContain('described in COPYRIGHT.txt.');
    // El trozo con formato va entre dos de texto, sin partir la frase.
    expect(parts.at(-1)).toEqual({ text: '.', tag: null });
  });

  it('una clave desconocida se enseña tal cual, para que se note', () => {
    expect(service.t('no.existe')).toBe('no.existe');
  });

  it('el pseudoidioma marca el texto y formatea como el español', async () => {
    await service.setLocale('qps');

    expect(service.t('settings.language.title')).toMatch(/^\[Îðîöɱå ~+\]$/);
    expect(document.documentElement.lang).toBe('es');
  });

  it('adopta el idioma de las preferencias sin volver a guardarlo', async () => {
    await service.adopt({ 'ui.locale': 'en' });

    expect(service.locale()).toBe('en');
    expect(saved).toEqual([]);
  });

  it('ignora una preferencia que no es un idioma', async () => {
    await service.adopt({ 'ui.locale': 'klingon' });

    expect(service.locale()).toBe('es');
  });

  it('ofrece los idiomas que tienen algo traducido, con su nombre en su idioma', async () => {
    const options = await service.options();
    const names = options.filter((option) => option.id !== 'qps').map((option) => option.name);

    expect(names).toEqual(['Español', 'English']);
  });
});
