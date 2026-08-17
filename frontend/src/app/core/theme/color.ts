/**
 * Aritmética de color, sin Angular y sin DOM.
 *
 * Vive aparte porque es lo único de la apariencia que se puede equivocar en
 * silencio: un color mal derivado no lanza ningún error, solo deja un botón
 * ilegible. Aquí se puede probar con números.
 *
 * Todo trabaja en HSL. Es el espacio en el que «el mismo color con más luz» es
 * una suma, que es exactamente lo que hace falta para derivar un acento entero a
 * partir del color que elija el usuario.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Hsl {
  /** Matiz en grados, 0–360. */
  readonly h: number;
  /** Saturación en porcentaje, 0–100. */
  readonly s: number;
  /** Luminosidad en porcentaje, 0–100. */
  readonly l: number;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Lee un color escrito como `#rgb` o `#rrggbb`. Devuelve `null` si no lo es. */
export function parseHex(value: string): Rgb | null {
  const match = value.trim().match(HEX);

  if (!match) {
    return null;
  }

  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((c) => c + c)
          .join('')
      : digits;

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

/**
 * Los tres componentes separados por espacios, como los quiere `rgb()`.
 *
 * Es la forma en que la paleta guarda el acento: escrito así, un mismo valor
 * sirve para el color pleno y para cualquiera de sus rellenos con alfa.
 */
export function toRgbComponents({ r, g, b }: Rgb): string {
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) {
    return { h: 0, s: 0, l: l * 100 };
  }

  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === rn
      ? ((gn - bn) / d) % 6
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;

  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = ln - c / 2;

  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** Mueve un color por sus tres ejes a la vez, que es como se derivan variantes. */
export function shift(color: Rgb, change: { h?: number; s?: number; l?: number }): Rgb {
  const hsl = rgbToHsl(color);

  return hslToRgb({
    h: hsl.h + (change.h ?? 0),
    s: clamp(hsl.s * (change.s ?? 1), 0, 100),
    l: clamp(hsl.l + (change.l ?? 0), 0, 100),
  });
}

/**
 * Cuánto contrasta un color con otro, según WCAG.
 *
 * Se usa para decidir si el texto que va encima del acento debe ser blanco o
 * negro. Un acento amarillo con letras blancas es la clase de detalle que nadie
 * ve al elegir el color y todo el mundo sufre al usarlo.
 */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];

  return (light + 0.05) / (dark + 0.05);
}

function luminance({ r, g, b }: Rgb): number {
  const [rn, gn, bn] = [r, g, b].map((v) => {
    const channel = v / 255;

    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * rn + 0.7152 * gn + 0.0722 * bn;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
