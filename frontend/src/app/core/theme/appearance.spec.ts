import {
  DEFAULT_APPEARANCE,
  DEFAULT_GRID,
  appearancePreferences,
  appearanceVariables,
  backgroundStyle,
  parseAppearance,
  readableOn,
} from './appearance';
import { parseHex } from './color';

describe('apariencia', () => {
  describe('lectura de lo guardado', () => {
    it('sin nada guardado se queda como estaba', () => {
      const current = { ...DEFAULT_APPEARANCE, accent: '#3ddc97', scale: 110 };

      expect(parseAppearance({}, current)).toEqual(current);
    });

    it('una clave vacía sí borra: es el usuario quitándola', () => {
      const current = { ...DEFAULT_APPEARANCE, accent: '#3ddc97' };

      expect(parseAppearance({ 'ui.accent': '' }, current).accent).toBeNull();
    });

    it('descarta un color que ya no es un color', () => {
      expect(parseAppearance({ 'ui.accent': 'azulado' }).accent).toBeNull();
    });

    it('recorta una escala imposible en lugar de aplicarla', () => {
      expect(parseAppearance({ 'ui.scale': '4000' }).scale).toBe(150);
      expect(parseAppearance({ 'ui.scale': '10' }).scale).toBe(80);
    });

    it('ignora un cuerpo de letra que no se ofrece', () => {
      expect(parseAppearance({ 'ui.editorFontSize': '37' }).editorFontSize).toBe(13);
    });

    it('da la vuelta a lo que escribe, sin perder nada por el camino', () => {
      const appearance = {
        theme: 'light' as const,
        scale: 125,
        editorFontSize: 16,
        accent: '#3ddc97',
        tint: '#a89272',
        background: {
          name: 'foto.jpg',
          opacity: 24,
          fit: 'scale' as const,
          scale: 140,
          x: 20,
          y: 80,
        },
        grid: {
          fontSize: 14,
          font: 'ui' as const,
          zebra: true,
          colors: { headerBackground: '#223344', number: '#f0b429' },
        },
      };

      expect(parseAppearance(appearancePreferences(appearance))).toEqual(appearance);
    });
  });

  describe('variables que se escriben encima del tema', () => {
    it('sin personalizar no escribe ninguna', () => {
      expect(appearanceVariables(DEFAULT_APPEARANCE)).toEqual({});
    });

    it('del acento salen sus cuatro tonos', () => {
      const variables = appearanceVariables({ ...DEFAULT_APPEARANCE, accent: '#6c8bff' });

      expect(variables['--dr-accent-rgb']).toBe('108 139 255');
      expect(variables['--dr-accent-bright-rgb']).toBeDefined();
      expect(variables['--dr-accent-deep-rgb']).toBeDefined();
      expect(variables['--dr-accent-alt-rgb']).toBeDefined();
    });

    it('en claro el acento con presencia es más oscuro, no más claro', () => {
      const claro = appearanceVariables({
        ...DEFAULT_APPEARANCE,
        theme: 'light',
        accent: '#6c8bff',
      });
      const oscuro = appearanceVariables({ ...DEFAULT_APPEARANCE, accent: '#6c8bff' });

      const brillo = (value: string) =>
        value.split(' ').reduce((total, part) => total + Number(part), 0);

      expect(brillo(claro['--dr-accent-bright-rgb'])).toBeLessThan(brillo('108 139 255'));
      expect(brillo(oscuro['--dr-accent-bright-rgb'])).toBeGreaterThan(brillo('108 139 255'));
    });

    it('el tinte mueve el matiz y deja en paz la luminosidad', () => {
      const variables = appearanceVariables({ ...DEFAULT_APPEARANCE, tint: '#5b9c7f' });

      // Verde: en torno a 150 grados.
      expect(Number(variables['--dr-hue'])).toBeGreaterThan(130);
      expect(Number(variables['--dr-hue'])).toBeLessThan(170);
      expect(variables['--dr-sat-scale']).toBeDefined();
    });

    it('un gris deja la interfaz sin color en lugar de teñirla de gris', () => {
      const variables = appearanceVariables({ ...DEFAULT_APPEARANCE, tint: '#808080' });

      expect(Number(variables['--dr-sat-scale'])).toBe(0);
    });

    it('la escala solo se escribe cuando no es la de partida', () => {
      expect(
        appearanceVariables({ ...DEFAULT_APPEARANCE, scale: 100 })['--dr-scale'],
      ).toBeUndefined();
      expect(appearanceVariables({ ...DEFAULT_APPEARANCE, scale: 125 })['--dr-scale']).toBe('1.25');
    });
  });

  describe('cuadrícula de resultados', () => {
    it('lo que el servidor no trae no borra lo elegido', () => {
      const current = {
        ...DEFAULT_APPEARANCE,
        grid: { ...DEFAULT_GRID, zebra: true, colors: { number: '#f0b429' } },
      };

      expect(parseAppearance({}, current).grid).toEqual(current.grid);
    });

    it('un color vacío vuelve al del tema y uno roto se descarta', () => {
      const current = {
        ...DEFAULT_APPEARANCE,
        grid: { ...DEFAULT_GRID, colors: { text: '#ffffff' } },
      };

      const parsed = parseAppearance(
        { 'ui.grid.color.text': '', 'ui.grid.color.number': 'rojizo' },
        current,
      );

      expect(parsed.grid.colors).toEqual({});
    });

    it('ignora un tamaño de letra que no se ofrece', () => {
      expect(parseAppearance({ 'ui.grid.fontSize': '41' }).grid.fontSize).toBe(12);
    });

    it('cada tipo escribe su variable', () => {
      const variables = appearanceVariables({
        ...DEFAULT_APPEARANCE,
        grid: { ...DEFAULT_GRID, colors: { number: '#F0B429', null: '#ff0000' } },
      });

      expect(variables['--dr-grid-number']).toBe('#f0b429');
      expect(variables['--dr-grid-null']).toBe('#ff0000');
      expect(variables['--dr-grid-text']).toBeUndefined();
    });

    it('una cabecera pintada sin color de letra se queda con el legible', () => {
      const variables = appearanceVariables({
        ...DEFAULT_APPEARANCE,
        grid: { ...DEFAULT_GRID, colors: { headerBackground: '#f5f0c8' } },
      });

      expect(variables['--dr-grid-header-text']).not.toBe('#fff');
    });

    it('el booleano arrastra el borde y el relleno de su píldora', () => {
      const variables = appearanceVariables({
        ...DEFAULT_APPEARANCE,
        grid: { ...DEFAULT_GRID, colors: { boolean: '#6c8bff' } },
      });

      expect(variables['--dr-grid-boolean-tint']).toBe('rgb(108 139 255 / 12%)');
      expect(variables['--dr-grid-boolean-line']).toBe('rgb(108 139 255 / 35%)');
    });

    it('letra, tipo y franjas solo se escriben si cambian', () => {
      const variables = appearanceVariables({
        ...DEFAULT_APPEARANCE,
        grid: { ...DEFAULT_GRID, fontSize: 14, font: 'ui', zebra: true },
      });

      expect(variables['--dr-grid-font-size']).toBe('14px');
      expect(variables['--dr-grid-font']).toBe('var(--dr-font-ui)');
      expect(variables['--dr-grid-stripe']).toBe('var(--dr-surface-stripe)');
    });
  });

  describe('texto sobre el acento', () => {
    it('elige blanco sobre un azul y tinta sobre un amarillo', () => {
      expect(readableOn(parseHex('#4a67e8')!)).toBe('#fff');
      expect(readableOn(parseHex('#f0b429')!)).not.toBe('#fff');
    });
  });

  describe('imagen de fondo', () => {
    const image = { name: 'f.png', opacity: 20, fit: 'cover' as const, scale: 100, x: 50, y: 50 };

    it('deja que el encaje decida el tamaño cuando él lo calcula', () => {
      expect(backgroundStyle(image, 'x')['--dr-editor-background-size']).toBe('cover');
    });

    it('escribe el tamaño solo cuando lo decide el usuario', () => {
      expect(
        backgroundStyle({ ...image, fit: 'scale', scale: 140 }, 'x')['--dr-editor-background-size'],
      ).toBe('140% auto');
      expect(
        backgroundStyle({ ...image, fit: 'tile', scale: 40 }, 'x')['--dr-editor-background-repeat'],
      ).toBe('repeat');
    });

    it('lleva el encuadre a la posición del fondo', () => {
      expect(
        backgroundStyle({ ...image, x: 10, y: 90 }, 'x')['--dr-editor-background-position'],
      ).toBe('10% 90%');
    });

    it('la intensidad viaja como fracción, que es lo que entiende la opacidad', () => {
      expect(
        backgroundStyle({ ...image, opacity: 25 }, 'x')['--dr-editor-background-opacity'],
      ).toBe('0.25');
    });
  });
});
