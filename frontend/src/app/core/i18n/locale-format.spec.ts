import { compareText, formatNumber, setFormatLocale } from './locale-format';

describe('formatos según el idioma', () => {
  afterEach(() => setFormatLocale('es'));

  it('los números siguen al idioma elegido', () => {
    setFormatLocale('es');
    expect(formatNumber(12345.5)).toBe('12.345,5');

    setFormatLocale('en');
    expect(formatNumber(12345.5)).toBe('12,345.5');
  });

  it('ordena como lo haría una persona, con tildes incluidas', () => {
    setFormatLocale('es');

    expect(['Zona', 'árbol', 'Bota'].sort(compareText)).toEqual(['árbol', 'Bota', 'Zona']);
  });
});
