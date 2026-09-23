import { Rgb, clamp, contrast, parseHex, rgbToHsl, shift, toHex, toRgbComponents } from './color';
/**
 * Qué paleta se está pintando.
 *
 * Solo dos, y ninguno significa «lo que diga el sistema»: la aplicación es de
 * escritorio y vive abierta horas, así que un tema que cambia solo al anochecer
 * es una interrupción, no una comodidad.
 */
export type ThemeName = 'dark' | 'light';

/** El del mockup. Lo que se ve si nadie ha elegido nunca. */
export const DEFAULT_THEME: ThemeName = 'dark';

/** Recompone un tema a partir de lo que se guardó; lo que no se reconozca, oscuro. */
export function parseTheme(value: string | null | undefined): ThemeName {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}

/**
 * Cómo encaja la imagen de fondo del editor.
 *
 * Cuatro modos y no los siete de CSS. Los tres primeros deciden el tamaño solos
 * —llenar recorta, encajar deja ver la imagen entera, repetir la convierte en
 * patrón—; el cuarto existe porque a veces ninguno acierta y hace falta decir el
 * tamaño a mano.
 */
export type BackgroundFit = 'cover' | 'contain' | 'tile' | 'scale';

export interface EditorBackground {
  /** Nombre del archivo, para poder enseñar cuál está puesto. */
  readonly name: string;
  /** Cuánto se ve, de 0 a 100. Por encima de 40 el código empieza a pelearse con la imagen. */
  readonly opacity: number;
  readonly fit: BackgroundFit;
  /** Tamaño en porcentaje del ancho del editor. Solo lo miran «repetir» y «tamaño». */
  readonly scale: number;
  /** Encuadre horizontal y vertical, de 0 a 100. En «llenar» decide qué parte se recorta. */
  readonly x: number;
  readonly y: number;
}

/**
 * Todo lo que el usuario puede cambiar del aspecto.
 *
 * `accent` y `tint` son **deltas**: `null` significa «lo que diga el tema», no
 * un color concreto. Guardar el color del tema como si lo hubiera elegido el
 * usuario congelaría la paleta de esa versión, y al cambiar de tema seguiría
 * pintando el acento del otro.
 */
export interface Appearance {
  readonly theme: ThemeName;
  /** Escala de toda la interfaz, en porcentaje. 100 es el tamaño del mockup. */
  readonly scale: number;
  /** Cuerpo de la letra del editor, en píxeles. */
  readonly editorFontSize: number;
  /** Color de acento elegido, en hexadecimal. */
  readonly accent: string | null;
  /** Color del que se toman matiz y saturación para teñir el decorado. */
  readonly tint: string | null;
  readonly background: EditorBackground | null;
  readonly grid: GridAppearance;
}

/**
 * Lo que se puede pintar a mano en la cuadrícula de resultados.
 *
 * Una clave por cosa que se distingue al leer un resultado: la cabecera, las
 * líneas y el color que ya da el tipo de cada columna. No hay un color por
 * columna concreta porque las columnas cambian con cada consulta; lo que se
 * repite de una a otra es el tipo.
 */
export type GridColorKey =
  | 'headerBackground'
  | 'headerText'
  | 'lines'
  | 'text'
  | 'number'
  | 'timestamp'
  | 'boolean'
  | 'null';

export const GRID_COLOR_KEYS: readonly GridColorKey[] = [
  'headerBackground',
  'headerText',
  'lines',
  'text',
  'number',
  'timestamp',
  'boolean',
  'null',
];

/**
 * Qué letra usan las celdas.
 *
 * La monoespaciada alinea las cifras de una columna, que es por lo que es la de
 * serie; la de la interfaz cabe más texto por columna, y hay quien consulta más
 * nombres que importes.
 */
export type GridFont = 'mono' | 'ui';

export interface GridAppearance {
  /** Cuerpo de la letra de las celdas, en píxeles. El modo compacto le quita uno. */
  readonly fontSize: number;
  readonly font: GridFont;
  /** Filas alternas sombreadas, para no perder la fila al leer de lado a lado. */
  readonly zebra: boolean;
  /** Colores elegidos; lo que falta, o es `null`, es el del tema. */
  readonly colors: Readonly<Partial<Record<GridColorKey, string | null>>>;
}

/** Tamaños de letra de la cuadrícula que se ofrecen. */
export const GRID_FONT_SIZES: readonly number[] = [10, 11, 12, 13, 14, 16];

export const DEFAULT_GRID: GridAppearance = {
  fontSize: 12,
  font: 'mono',
  zebra: false,
  colors: {},
};

export const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_THEME,
  scale: 100,
  editorFontSize: 13,
  accent: null,
  tint: null,
  background: null,
  grid: DEFAULT_GRID,
};

/** Si la cuadrícula está como la trae el tema. */
export function isDefaultGrid(grid: GridAppearance): boolean {
  return (
    grid.fontSize === DEFAULT_GRID.fontSize &&
    grid.font === DEFAULT_GRID.font &&
    grid.zebra === DEFAULT_GRID.zebra &&
    GRID_COLOR_KEYS.every((key) => !grid.colors[key])
  );
}

/** Saturación del decorado en las dos paletas. Es el 1× de la escala. */
const BASE_TINT_SATURATION = 30;

/** Tope de la escala de saturación: más allá, el decorado compite con los estados. */
const MAX_SAT_SCALE = 2;

export const MAX_BACKGROUND_OPACITY = 60;

/**
 * Hasta dónde se puede estirar o encoger la interfaz.
 *
 * Los topes no son decorativos: por debajo del 80 % la barra de estado deja de
 * leerse, y por encima del 150 % la barra superior ya no cabe en una pantalla de
 * portátil y empieza a esconder botones.
 */
export const MIN_SCALE = 80;

/** Hasta dónde se puede estirar la imagen de fondo. */
export const MIN_BACKGROUND_SCALE = 25;
export const MAX_BACKGROUND_SCALE = 300;
export const MAX_SCALE = 150;

/** Tamaños de letra del editor que se ofrecen. Escribir un número cualquiera no aporta nada. */
export const EDITOR_FONT_SIZES: readonly number[] = [11, 12, 13, 14, 16, 18];

/** Cómo se guarda cada ajuste. Las claves son el contrato con la base local. */
export function appearancePreferences(appearance: Appearance): Readonly<Record<string, string>> {
  return {
    'ui.theme': appearance.theme,
    'ui.scale': String(appearance.scale),
    'ui.editorFontSize': String(appearance.editorFontSize),
    'ui.accent': appearance.accent ?? '',
    'ui.tint': appearance.tint ?? '',
    'ui.editorBackground.name': appearance.background?.name ?? '',
    'ui.editorBackground.opacity': String(appearance.background?.opacity ?? ''),
    'ui.editorBackground.fit': appearance.background?.fit ?? '',
    'ui.editorBackground.scale': String(appearance.background?.scale ?? ''),
    'ui.editorBackground.x': String(appearance.background?.x ?? ''),
    'ui.editorBackground.y': String(appearance.background?.y ?? ''),
    'ui.grid.fontSize': String(appearance.grid.fontSize),
    'ui.grid.font': appearance.grid.font,
    'ui.grid.zebra': String(appearance.grid.zebra),
    ...Object.fromEntries(
      GRID_COLOR_KEYS.map((key) => [`ui.grid.color.${key}`, appearance.grid.colors[key] ?? '']),
    ),
  };
}

/**
 * Recompone la apariencia a partir de lo guardado.
 *
 * Un valor que no se reconozca cae en el que se traía, por lo mismo que en los
 * ajustes de formato: las preferencias viven en una base que sobrevive a las
 * versiones, y un color que dejó de existir no puede dejar la interfaz sin
 * pintar.
 *
 * **Una clave ausente no es una clave vacía.** Ausente significa que el servidor
 * no sabe nada de ese ajuste y manda lo que ya había; vacía significa que el
 * usuario lo quitó. Sin esa distinción, arrancar contra un servidor que aún no
 * ha guardado nada —o que no pudo— borraría lo que se acabara de elegir, que es
 * exactamente lo que el usuario ve como «no me guarda los colores».
 */
export function parseAppearance(
  raw: Readonly<Record<string, string>>,
  current: Appearance = DEFAULT_APPEARANCE,
): Appearance {
  const scale = Number.parseInt(raw['ui.scale'] ?? '', 10);
  const fontSize = Number.parseInt(raw['ui.editorFontSize'] ?? '', 10);

  return {
    theme: 'ui.theme' in raw ? parseTheme(raw['ui.theme']) : current.theme,
    scale: Number.isFinite(scale) ? clamp(scale, MIN_SCALE, MAX_SCALE) : current.scale,
    editorFontSize: EDITOR_FONT_SIZES.includes(fontSize) ? fontSize : current.editorFontSize,
    accent: color(raw, 'ui.accent', current.accent),
    tint: color(raw, 'ui.tint', current.tint),
    background: background(raw, current.background),
    grid: grid(raw, current.grid),
  };
}

function grid(raw: Readonly<Record<string, string>>, current: GridAppearance): GridAppearance {
  const fontSize = Number.parseInt(raw['ui.grid.fontSize'] ?? '', 10);
  const font = raw['ui.grid.font'];
  const zebra = raw['ui.grid.zebra'];

  return {
    fontSize: GRID_FONT_SIZES.includes(fontSize) ? fontSize : current.fontSize,
    font: font === 'mono' || font === 'ui' ? font : current.font,
    zebra: zebra === 'true' ? true : zebra === 'false' ? false : current.zebra,
    // Solo lo elegido: un color que es el del tema no se apunta, ni como `null`.
    colors: Object.fromEntries(
      GRID_COLOR_KEYS.flatMap((key) => {
        const value = color(raw, `ui.grid.color.${key}`, current.colors[key] ?? null);
        return value ? [[key, value]] : [];
      }),
    ),
  };
}

function color(
  raw: Readonly<Record<string, string>>,
  key: string,
  current: string | null,
): string | null {
  if (!(key in raw)) {
    return current;
  }

  return parseHex(raw[key]) ? raw[key] : null;
}

function background(
  raw: Readonly<Record<string, string>>,
  current: EditorBackground | null,
): EditorBackground | null {
  if (!('ui.editorBackground.name' in raw)) {
    return current;
  }

  const name = raw['ui.editorBackground.name'].trim();

  if (!name) {
    return null;
  }

  const opacity = Number.parseInt(raw['ui.editorBackground.opacity'] ?? '', 10);
  const previous = current ?? { ...DEFAULT_BACKGROUND, name };

  return {
    name,
    opacity: Number.isFinite(opacity)
      ? clamp(opacity, 0, MAX_BACKGROUND_OPACITY)
      : previous.opacity,
    fit: parseFit(raw['ui.editorBackground.fit']),
    scale: percentage(
      raw['ui.editorBackground.scale'],
      previous.scale,
      MIN_BACKGROUND_SCALE,
      MAX_BACKGROUND_SCALE,
    ),
    x: percentage(raw['ui.editorBackground.x'], previous.x, 0, 100),
    y: percentage(raw['ui.editorBackground.y'], previous.y, 0, 100),
  };
}

/**
 * Con qué entra una imagen nueva: centrada, llenando y con poca presencia.
 *
 * Es el punto de partida del que se separa quien quiera; que se vea sin molestar
 * es lo que evita que el primer intento parezca un error.
 */
export const DEFAULT_BACKGROUND: Omit<EditorBackground, 'name'> = {
  opacity: 18,
  fit: 'cover',
  scale: 100,
  x: 50,
  y: 50,
};

function percentage(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? '', 10);

  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function parseFit(value: string | undefined): BackgroundFit {
  return value === 'contain' || value === 'tile' || value === 'scale' ? value : 'cover';
}

/**
 * Las variables que hay que escribir encima del tema.
 *
 * Devuelve solo lo que el usuario ha cambiado. Un mapa vacío significa que la
 * paleta del tema se aplica tal cual, que es lo que debe pasar mientras nadie
 * toque nada.
 */
export function appearanceVariables(appearance: Appearance): Readonly<Record<string, string>> {
  return {
    ...accentVariables(appearance),
    ...tintVariables(appearance),
    ...scaleVariables(appearance),
    ...gridVariables(appearance.grid),
  };
}

/**
 * La cuadrícula de resultados, escrita como variables que la hoja de la
 * cuadrícula lee con el color del tema de respaldo.
 *
 * Dos colores arrastran a otros. Una cabecera con fondo propio y sin color de
 * letra elegido se queda con el que más contraste dé, por lo mismo que el texto
 * sobre el acento; y el booleano pinta también su píldora, con el borde y el
 * relleno sacados de él para que no quede un verde enmarcando otro color.
 */
function gridVariables(grid: GridAppearance): Record<string, string> {
  const variables: Record<string, string> = {};
  const colors = Object.fromEntries(
    GRID_COLOR_KEYS.flatMap((key) => {
      const rgb = grid.colors[key] ? parseHex(grid.colors[key]!) : null;
      return rgb ? [[key, rgb]] : [];
    }),
  ) as Partial<Record<GridColorKey, Rgb>>;

  for (const [key, rgb] of Object.entries(colors) as [GridColorKey, Rgb][]) {
    variables[`--dr-grid-${GRID_VARIABLE[key]}`] = toHex(rgb);
  }

  if (colors.headerBackground && !colors.headerText) {
    variables['--dr-grid-header-text'] = readableOn(colors.headerBackground);
  }

  // El tipo de la columna va en el mismo color que el nombre pero apagado: con
  // su gris de serie encima de una cabecera pintada a mano podía no leerse.
  if (colors.headerBackground || colors.headerText) {
    variables['--dr-grid-header-type-opacity'] = '0.65';
  }

  if (colors.boolean) {
    const rgb = toRgbComponents(colors.boolean);
    variables['--dr-grid-boolean-tint'] = `rgb(${rgb} / 12%)`;
    variables['--dr-grid-boolean-line'] = `rgb(${rgb} / 35%)`;
  }

  if (grid.fontSize !== DEFAULT_GRID.fontSize) {
    variables['--dr-grid-font-size'] = `${grid.fontSize}px`;
  }

  if (grid.font === 'ui') {
    variables['--dr-grid-font'] = 'var(--dr-font-ui)';
  }

  if (grid.zebra) {
    variables['--dr-grid-stripe'] = 'var(--dr-surface-stripe)';
  }

  return variables;
}

/** El nombre de la variable de cada color, sin el prefijo. */
const GRID_VARIABLE: Readonly<Record<GridColorKey, string>> = {
  headerBackground: 'header-bg',
  headerText: 'header-text',
  lines: 'lines',
  text: 'text',
  number: 'number',
  timestamp: 'timestamp',
  boolean: 'boolean',
  null: 'null',
};

/** Todas las variables que puede escribir la cuadrícula, para poder retirarlas. */
export const GRID_VARIABLES: readonly string[] = [
  ...Object.values(GRID_VARIABLE).map((name) => `--dr-grid-${name}`),
  '--dr-grid-boolean-tint',
  '--dr-grid-boolean-line',
  '--dr-grid-header-type-opacity',
  '--dr-grid-font-size',
  '--dr-grid-font',
  '--dr-grid-stripe',
];

/**
 * El acento entero a partir de un solo color.
 *
 * Son cuatro tonos, no uno: el elegido, uno con más presencia para iconos y
 * texto, uno apagado para el fondo de los botones y el violeta que acompaña al
 * degradado de la marca. En claro, «más presencia» es menos luz y no más, porque
 * lo que hace legible un icono sobre blanco es oscurecerlo.
 */
function accentVariables(appearance: Appearance): Record<string, string> {
  const accent = appearance.accent ? parseHex(appearance.accent) : null;

  if (!accent) {
    return {};
  }

  const light = appearance.theme === 'light';
  const bright = light ? shift(accent, { l: -12, s: 0.85 }) : shift(accent, { l: 10 });
  const deep = shift(accent, { l: -8, s: 0.9 });
  const alt = shift(accent, { h: 30, s: 1.02 });

  return {
    '--dr-accent-rgb': toRgbComponents(accent),
    '--dr-accent-bright-rgb': toRgbComponents(bright),
    '--dr-accent-deep-rgb': toRgbComponents(deep),
    '--dr-accent-alt-rgb': toRgbComponents(alt),
    '--dr-accent-gradient': `linear-gradient(140deg, ${toHex(accent)}, ${toHex(alt)})`,
    // Lo que va encima del acento se decide midiendo, no suponiendo: un acento
    // amarillo con letras blancas es ilegible, y es de los colores que la gente
    // elige.
    '--dr-text-on-accent': readableOn(accent),
  };
}

/** Blanco o casi negro, el que más contraste dé sobre el color de debajo. */
export function readableOn(background: Rgb): string {
  const white = { r: 255, g: 255, b: 255 };
  const ink = { r: 12, g: 16, b: 24 };

  return contrast(background, white) >= contrast(background, ink) ? '#fff' : toHex(ink);
}

/**
 * Tiñe el decorado con el matiz del color elegido.
 *
 * No se cambia ni una luminosidad: la jerarquía de superficies —qué está por
 * encima de qué— está construida sobre ellas, y moverlas convertiría el ajuste
 * en una forma de romper la interfaz. Solo se mueven el matiz y la saturación,
 * que es lo que se percibe como «de otro color».
 *
 * Un gris deja la escala en cero y devuelve una interfaz neutra, sin color. Es
 * un resultado legítimo y sale solo de elegir un gris.
 */
function tintVariables(appearance: Appearance): Record<string, string> {
  const tint = appearance.tint ? parseHex(appearance.tint) : null;

  if (!tint) {
    return {};
  }

  const { h, s } = rgbToHsl(tint);

  return {
    '--dr-hue': String(Math.round(h)),
    '--dr-sat-scale': (Math.round((s / BASE_TINT_SATURATION) * 100) / 100).toString(),
  };
}

/**
 * El tamaño de la interfaz entera.
 *
 * Se escala todo a la vez y no solo la letra: las barras tienen alturas fijas
 * sacadas del mockup, y agrandar el texto dentro de una barra que no crece
 * termina recortándolo. Con la escala, la ventana se ve como si la pantalla
 * tuviera otra densidad, que es lo que se pide de verdad al querer «más grande».
 */
function scaleVariables(appearance: Appearance): Record<string, string> {
  const scale = clamp(Math.round(appearance.scale), MIN_SCALE, MAX_SCALE);

  return scale === DEFAULT_APPEARANCE.scale ? {} : { '--dr-scale': String(scale / 100) };
}

/** Escala de saturación a la que quedaría un color, para enseñarla antes de aplicar. */
export function tintStrength(hex: string): number {
  const color = parseHex(hex);

  return color ? clamp(rgbToHsl(color).s / BASE_TINT_SATURATION, 0, MAX_SAT_SCALE) : 1;
}

/**
 * Cómo se traduce el ajuste de la imagen a las propiedades de fondo de CSS.
 *
 * El tamaño solo se escribe cuando el encaje no lo decide él solo: `cover` y
 * `contain` calculan el suyo, y darles además un porcentaje sería pedirles dos
 * cosas incompatibles.
 */
export function backgroundStyle(
  background: EditorBackground,
  source: string,
): Record<string, string> {
  const sized = background.fit === 'tile' || background.fit === 'scale';
  const scale = clamp(background.scale, MIN_BACKGROUND_SCALE, MAX_BACKGROUND_SCALE);

  return {
    '--dr-editor-background': `url("${source}")`,
    '--dr-editor-background-size': sized ? `${scale}% auto` : background.fit,
    '--dr-editor-background-repeat': background.fit === 'tile' ? 'repeat' : 'no-repeat',
    '--dr-editor-background-position': `${clamp(background.x, 0, 100)}% ${clamp(background.y, 0, 100)}%`,
    '--dr-editor-background-opacity': String(
      clamp(background.opacity, 0, MAX_BACKGROUND_OPACITY) / 100,
    ),
  };
}
