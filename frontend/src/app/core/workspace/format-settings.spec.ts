import { DEFAULT_FORMAT_SETTINGS, formatPreferences, parseFormatSettings } from './format-settings';

describe('ajustes de formateo', () => {
  it('sin nada guardado, formatea como siempre lo hizo', () => {
    expect(parseFormatSettings({})).toEqual(DEFAULT_FORMAT_SETTINGS);
  });

  it('recupera lo que el usuario eligió', () => {
    const settings = parseFormatSettings({
      'editor.format.style': 'tabular',
      'editor.format.width': '120',
      'editor.format.keywordCase': 'lower',
      'editor.format.indent': 'tabs',
    });

    expect(settings).toEqual({
      style: 'tabular',
      expressionWidth: 120,
      keywordCase: 'lower',
      indent: 'tabs',
    });
  });

  /**
   * Las preferencias viven en una base local que sobrevive a las versiones. Un
   * valor que dejó de existir no puede dejar el formateador sin funcionar.
   */
  it('ignora los valores que no reconoce', () => {
    const settings = parseFormatSettings({
      'editor.format.style': 'artesanal',
      'editor.format.width': 'ancho',
      'editor.format.keywordCase': 'SHOUTING',
      'editor.format.indent': 'puntos',
    });

    expect(settings).toEqual(DEFAULT_FORMAT_SETTINGS);
  });

  it('acota un ancho absurdo en lugar de aceptarlo', () => {
    expect(parseFormatSettings({ 'editor.format.width': '5000' }).expressionWidth).toBe(200);
    expect(parseFormatSettings({ 'editor.format.width': '1' }).expressionWidth).toBe(20);
  });

  it('lo guardado se vuelve a leer igual', () => {
    const original = {
      style: 'tabular',
      expressionWidth: 100,
      keywordCase: 'preserve',
      indent: 'spaces4',
    } as const;

    expect(parseFormatSettings(formatPreferences(original))).toEqual(original);
  });
});
