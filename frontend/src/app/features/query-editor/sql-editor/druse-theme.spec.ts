import { druseTheme } from './druse-theme';
import { contrast, parseHex } from '../../../core/theme/color';

/**
 * Los colores del editor que **solo se ven mirando la aplicación**.
 *
 * Monaco pinta parte de su superficie con `<canvas>`, y un canvas no hereda el
 * fondo del contenedor como hace el resto: lo que allí queda sin color se
 * rasteriza en negro. En el tema oscuro no se nota; en el claro deja una franja
 * negra pegada al borde derecho del editor, que es como se encontró.
 */
describe('druseTheme', () => {
  it('la regla de la derecha lleva el fondo del panel en los dos temas', () => {
    // Es un canvas: sin fondo propio sale negro, no transparente.
    expect(druseTheme('dark', null).colors['editorOverviewRuler.background']).toBe('#121417');
    expect(druseTheme('light', null).colors['editorOverviewRuler.background']).toBe('#FFFFFF');
  });

  it('el fondo del editor sí es transparente, que lo pone el contenedor', () => {
    // Lo contrario del caso de arriba: aquí el color sale del CSS de la
    // aplicación, y fijarlo en Monaco lo dejaría desincronizado del tema.
    expect(druseTheme('dark', null).colors['editor.background']).toBe('#00000000');
    expect(druseTheme('light', null).colors['editor.background']).toBe('#00000000');
  });

  it('el acento elegido manda sobre el del tema', () => {
    const conAcento = druseTheme('dark', '#ff8800');

    expect(conAcento.colors['editorCursor.foreground']?.toUpperCase()).toBe('#FF8800');
  });

  it.each(['dark', 'light'] as const)(
    'mantiene contraste alto en los signos y comentarios del tema %s',
    (name) => {
      const theme = druseTheme(name, null);
      const background = parseHex(theme.colors['editorOverviewRuler.background'])!;
      for (const token of ['keyword.sql', 'comment', 'operator.sql', 'delimiter']) {
        const rule = theme.rules.find((rule) => rule.token === token)!;
        expect(contrast(parseHex(rule.foreground!)!, background)).toBeGreaterThanOrEqual(7);
      }
    },
  );

  it.each(['dark', 'light'] as const)(
    'los operadores SQL se distinguen de los identificadores como las reservadas en %s',
    (name) => {
      const theme = druseTheme(name, '#ff8800');
      const keyword = theme.rules.find((rule) => rule.token === 'keyword.sql')!;
      const operator = theme.rules.find((rule) => rule.token === 'operator.sql')!;
      const identifier = theme.rules.find((rule) => rule.token === 'identifier')!;
      expect(operator.foreground).toBe(keyword.foreground);
      expect(operator.fontStyle).toBe(keyword.fontStyle);
      expect(operator.foreground).not.toBe(identifier.foreground);
    },
  );

  it('mantiene legibles los números de línea sobre el fondo oscuro', () => {
    const theme = druseTheme('dark', null);
    const background = parseHex(theme.colors['editorOverviewRuler.background'])!;
    expect(
      contrast(parseHex(theme.colors['editorLineNumber.foreground'])!, background),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
