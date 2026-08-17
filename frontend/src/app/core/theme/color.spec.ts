import { contrast, hslToRgb, parseHex, rgbToHsl, shift, toHex, toRgbComponents } from './color';

describe('color', () => {
  it('lee las dos formas de escribir un hexadecimal', () => {
    expect(parseHex('#6c8bff')).toEqual({ r: 108, g: 139, b: 255 });
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('6c8bff')).toEqual({ r: 108, g: 139, b: 255 });
  });

  it('no se inventa un color cuando no lo hay', () => {
    expect(parseHex('')).toBeNull();
    expect(parseHex('azul')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
  });

  it('ida y vuelta por HSL devuelve el mismo color', () => {
    for (const hex of ['#6c8bff', '#0b0d11', '#ffffff', '#000000', '#3ddc97', '#f0b429']) {
      const rgb = parseHex(hex)!;

      expect(toHex(hslToRgb(rgbToHsl(rgb)))).toBe(hex);
    }
  });

  it('un gris no tiene matiz ni saturación que conservar', () => {
    const { h, s } = rgbToHsl(parseHex('#808080')!);

    expect(h).toBe(0);
    expect(s).toBe(0);
  });

  it('mover la luminosidad no cambia el matiz', () => {
    const original = parseHex('#6c8bff')!;
    const claro = shift(original, { l: 12 });

    expect(Math.round(rgbToHsl(claro).h)).toBe(Math.round(rgbToHsl(original).h));
    expect(rgbToHsl(claro).l).toBeGreaterThan(rgbToHsl(original).l);
  });

  it('no se sale de los topes al empujar un color ya extremo', () => {
    expect(toHex(shift(parseHex('#ffffff')!, { l: 40 }))).toBe('#ffffff');
    expect(toHex(shift(parseHex('#000000')!, { l: -40 }))).toBe('#000000');
  });

  it('escribe los componentes como los quiere rgb()', () => {
    expect(toRgbComponents(parseHex('#6c8bff')!)).toBe('108 139 255');
  });

  it('mide el contraste como manda WCAG', () => {
    const white = parseHex('#ffffff')!;
    const black = parseHex('#000000')!;

    expect(contrast(white, black)).toBeCloseTo(21, 1);
    expect(contrast(white, white)).toBeCloseTo(1, 5);
  });
});
