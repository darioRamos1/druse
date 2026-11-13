import { describe, expect, it } from 'vitest';

import {
  GRAPHIC_CONTRAST,
  PANEL_SURFACE,
  checkBrand,
  cleanDetails,
  contrast,
  emptyIdentity,
  fitWithin,
  identityProblem,
  normalizeHex,
  readableShade,
} from './report-identity-model';

describe('report-identity-model', () => {
  it('normaliza el color a #RRGGBB y rechaza lo que no lo es', () => {
    expect(normalizeHex('#0a6cbf')).toBe('#0A6CBF');
    expect(normalizeHex('0a6cbf')).toBe('#0A6CBF');
    expect(normalizeHex(' #abc ')).toBe('#AABBCC');
    expect(normalizeHex('azul')).toBeNull();
    expect(normalizeHex('#0a6cb')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });

  it('mide el contraste como WCAG', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('el tono que se lee es la misma marca, más clara sobre oscuro y más oscura sobre claro', () => {
    const navy = '#0A2A6C';
    const lighter = readableShade(navy, PANEL_SURFACE.dark);
    const yellow = '#FFD400';
    const darker = readableShade(yellow, PANEL_SURFACE.light);

    expect(contrast(navy, PANEL_SURFACE.dark)).toBeLessThan(GRAPHIC_CONTRAST);
    expect(contrast(lighter, PANEL_SURFACE.dark)).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST);
    expect(contrast(darker, PANEL_SURFACE.light)).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST);
    // Un color que ya se lee se queda como está.
    expect(readableShade('#0A6CBF', PANEL_SURFACE.light)).toBe('#0A6CBF');
  });

  it('comprueba la marca en los dos temas y propone uno cercano si no se lee en claro', () => {
    const blue = checkBrand('#0A6CBF');
    const yellow = checkBrand('#FFD400');

    expect(blue.lightSuggestion).toBeNull();
    expect(blue.darkContrast).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST);
    expect(yellow.lightContrast).toBeLessThan(GRAPHIC_CONTRAST);
    expect(yellow.lightSuggestion).not.toBeNull();
    expect(contrast(yellow.lightSuggestion!, PANEL_SURFACE.light)).toBeGreaterThanOrEqual(
      GRAPHIC_CONTRAST,
    );
  });

  it('limpia los datos: sin espacios, sin huecos y como mucho tres líneas', () => {
    expect(cleanDetails([' NIT 900 ', '', '  ', 'Bogotá', 'cuarta', 'quinta'])).toEqual([
      'NIT 900',
      'Bogotá',
      'cuarta',
    ]);
  });

  it('dice qué impide guardar', () => {
    const base = { ...emptyIdentity('a'), name: 'Andina' };

    expect(identityProblem(base)).toBeNull();
    expect(identityProblem({ ...base, name: '  ' })).toBe('reports.identity.problem.name');
    expect(identityProblem({ ...base, subtitle: 'x'.repeat(161) })).toBe(
      'reports.identity.problem.line',
    );
    expect(identityProblem({ ...base, details: ['x'.repeat(161)] })).toBe(
      'reports.identity.problem.line',
    );
    expect(identityProblem({ ...base, brandColor: 'azul' })).toBe('reports.identity.problem.color');
  });

  it('reduce el logo sin deformarlo ni agrandarlo', () => {
    expect(fitWithin(2400, 400)).toEqual({ width: 1200, height: 200 });
    expect(fitWithin(800, 800)).toEqual({ width: 400, height: 400 });
    expect(fitWithin(300, 100)).toEqual({ width: 300, height: 100 });
  });
});
