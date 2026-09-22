import { cachedLocale, rememberLocale, resolveLocale } from './locale';

describe('elegir el idioma', () => {
  beforeEach(() => localStorage.clear());

  it('toma el primero de los del sistema que Druse tenga', () => {
    expect(resolveLocale(['de-DE', 'fr-CA', 'en-US'])).toBe('fr');
    expect(resolveLocale(['es-CO'])).toBe('es');
    expect(resolveLocale(['en-GB', 'es'])).toBe('en');
  });

  it('cualquier portugués va a portugués de Brasil', () => {
    expect(resolveLocale(['pt-PT'])).toBe('pt-BR');
    expect(resolveLocale(['pt'])).toBe('pt-BR');
  });

  it('sin ninguno conocido, inglés', () => {
    expect(resolveLocale(['de-DE', 'ja'])).toBe('en');
    expect(resolveLocale([])).toBe('en');
  });

  it('recuerda el elegido en esta máquina e ignora valores que no son idiomas', () => {
    expect(cachedLocale()).toBeNull();

    rememberLocale('fr');
    expect(cachedLocale()).toBe('fr');

    localStorage.setItem('druse.locale', 'klingon');
    expect(cachedLocale()).toBeNull();
  });
});
