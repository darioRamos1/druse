import { druseTheme } from './druse-theme';

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
    expect(druseTheme('dark', null).colors['editorOverviewRuler.background']).toBe('#0B0D11');
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
});
