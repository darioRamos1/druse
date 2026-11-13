import { ReportIdentity } from '../../shared/models/reports';

/**
 * Lo que la interfaz sabe hacer con una identidad de empresa sin pintarla:
 * normalizar el color, medir su contraste y proponer uno que se lea.
 */

/** Lo que admite el servidor: lo mismo que `ReportIdentityRules`. */
export const IDENTITY_LIMITS = {
  name: 120,
  line: 160,
  details: 3,
  logoBytes: 512 * 1024,
  logoWidth: 1200,
  logoHeight: 400,
} as const;

/**
 * Las superficies contra las que se validó la paleta de Reportes
 * (`_report-palette.scss`): un panel en claro y uno en oscuro. El color de
 * marca se mide contra las mismas, para que las dos cosas sigan el mismo
 * criterio.
 */
export const PANEL_SURFACE = { light: '#E6EAF3', dark: '#272C3A' } as const;

/** Contraste mínimo para barras y líneas (WCAG 1.4.11). */
export const GRAPHIC_CONTRAST = 3;

export function emptyIdentity(id: string): ReportIdentity {
  return {
    id,
    name: '',
    subtitle: null,
    details: [],
    footer: null,
    brandColor: null,
    logoOnWhite: false,
  };
}

/** `#abc`, `0a6cbf` o `#0A6CBF` → `#0A6CBF`; cualquier otra cosa, `null`. */
export function normalizeHex(text: string | null | undefined): string | null {
  const value = (text ?? '').trim().replace(/^#/, '');

  if (/^[0-9a-f]{3}$/i.test(value)) {
    return `#${[...value].map((c) => c + c).join('')}`.toUpperCase();
  }

  return /^[0-9a-f]{6}$/i.test(value) ? `#${value}`.toUpperCase() : null;
}

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Luminancia relativa de WCAG. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste de WCAG, de 1 a 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;

  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`.toUpperCase();
}

/**
 * El tono más cercano que llega al contraste pedido contra una superficie.
 *
 * Mueve solo la luminosidad, en el sentido que aleja del fondo: es el mismo
 * color de la marca, más claro o más oscuro. Si ya llega, lo devuelve igual.
 */
export function readableShade(hex: string, surface: string, target = GRAPHIC_CONTRAST): string {
  if (contrast(hex, surface) >= target) {
    return hex;
  }

  const [h, s, l] = toHsl(hex);
  const lighter = luminance(surface) < 0.5;

  for (let step = 1; step <= 100; step++) {
    const next = Math.min(1, Math.max(0, lighter ? l + step / 100 : l - step / 100));
    const candidate = fromHsl(h, s, next);
    if (contrast(candidate, surface) >= target) {
      return candidate;
    }
  }

  return lighter ? '#FFFFFF' : '#000000';
}

/** Cómo se lee un color de marca en los dos temas. */
export interface BrandCheck {
  readonly color: string;
  /** La variante del tema oscuro: la misma marca, más clara si hace falta. */
  readonly dark: string;
  readonly lightContrast: number;
  readonly darkContrast: number;
  /** El tono más cercano que se lee en claro, si el elegido no llega. */
  readonly lightSuggestion: string | null;
}

export function checkBrand(hex: string): BrandCheck {
  const dark = readableShade(hex, PANEL_SURFACE.dark);
  const lightContrast = contrast(hex, PANEL_SURFACE.light);

  return {
    color: hex,
    dark,
    lightContrast,
    darkContrast: contrast(dark, PANEL_SURFACE.dark),
    lightSuggestion:
      lightContrast >= GRAPHIC_CONTRAST ? null : readableShade(hex, PANEL_SURFACE.light),
  };
}

/** Las líneas de datos tal como se guardan: sin espacios sobrantes ni huecos. */
export function cleanDetails(lines: readonly string[]): readonly string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, IDENTITY_LIMITS.details);
}

/** Qué impide guardar una identidad, como clave de idioma, o `null`. */
export function identityProblem(identity: ReportIdentity): string | null {
  const name = identity.name.trim();

  if (!name || name.length > IDENTITY_LIMITS.name) {
    return 'reports.identity.problem.name';
  }

  if (
    [identity.subtitle, identity.footer, ...identity.details].some(
      (line) => (line ?? '').length > IDENTITY_LIMITS.line,
    )
  ) {
    return 'reports.identity.problem.line';
  }

  if (identity.brandColor !== null && normalizeHex(identity.brandColor) === null) {
    return 'reports.identity.problem.color';
  }

  return null;
}

/** El tamaño que cabe en el máximo sin deformar ni agrandar. */
export function fitWithin(
  width: number,
  height: number,
  maxWidth = IDENTITY_LIMITS.logoWidth,
  maxHeight = IDENTITY_LIMITS.logoHeight,
): { readonly width: number; readonly height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
