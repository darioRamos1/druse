/**
 * Cómo formatea el editor, y cómo se recuerda entre arranques.
 *
 * Vive en `core` y no junto al formateador porque el store tiene que leerlo y
 * guardarlo, y **el estado no puede depender de una función de la interfaz**
 * (plan §5). El que sí depende es el formateador, que traduce estos ajustes al
 * dialecto de `sql-formatter`.
 */

/** Cómo se reparte el SQL en líneas. */
export type FormatStyle = 'standard' | 'tabular';

/** Qué hacer con las palabras reservadas. */
export type KeywordCase = 'upper' | 'lower' | 'preserve';

/** Con qué se sangra cada nivel. */
export type IndentKind = 'spaces2' | 'spaces4' | 'tabs';

/**
 * Ajustes de formateo que elige el usuario.
 *
 * Se quedan cortos a propósito: `sql-formatter` admite bastantes más, pero cada
 * opción suelta es una decisión que alguien tiene que tomar sin saber qué hace.
 * Estos cuatro son los que cambian el aspecto de una consulta de un vistazo.
 */
export interface FormatSettings {
  readonly style: FormatStyle;
  /** Ancho a partir del cual se parte una expresión. */
  readonly expressionWidth: number;
  readonly keywordCase: KeywordCase;
  readonly indent: IndentKind;
}

/** Lo que se venía aplicando antes de que esto se pudiera elegir. */
export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  style: 'standard',
  expressionWidth: 80,
  keywordCase: 'upper',
  indent: 'spaces2',
};

/** Anchos ofrecidos. Escribir un número cualquiera no aporta nada aquí. */
export const FORMAT_WIDTHS: readonly number[] = [60, 80, 100, 120];

/** Límites de lo que se acepta al leer un ancho guardado. */
export const MIN_FORMAT_WIDTH = 20;
export const MAX_FORMAT_WIDTH = 200;

export function clampFormatWidth(width: number): number {
  return Math.min(MAX_FORMAT_WIDTH, Math.max(MIN_FORMAT_WIDTH, Math.round(width)));
}

/**
 * Recompone unos ajustes a partir de lo que se guardó.
 *
 * Todo lo que no se reconozca cae en el valor por omisión: las preferencias
 * viven en una base local que sobrevive a las versiones, y un valor que dejó de
 * existir no puede dejar el formateador sin funcionar.
 */
export function parseFormatSettings(raw: Readonly<Record<string, string>>): FormatSettings {
  const width = Number.parseInt(raw['editor.format.width'] ?? '', 10);

  return {
    style: raw['editor.format.style'] === 'tabular' ? 'tabular' : 'standard',
    expressionWidth: Number.isFinite(width)
      ? clampFormatWidth(width)
      : DEFAULT_FORMAT_SETTINGS.expressionWidth,
    keywordCase: keywordCaseOf(raw['editor.format.keywordCase']),
    indent: indentOf(raw['editor.format.indent']),
  };
}

/** Cómo se guarda cada ajuste. Las claves son el contrato con la base local. */
export function formatPreferences(settings: FormatSettings): Readonly<Record<string, string>> {
  return {
    'editor.format.style': settings.style,
    'editor.format.width': String(settings.expressionWidth),
    'editor.format.keywordCase': settings.keywordCase,
    'editor.format.indent': settings.indent,
  };
}

function keywordCaseOf(value: string | undefined): KeywordCase {
  return value === 'lower' || value === 'preserve' ? value : 'upper';
}

function indentOf(value: string | undefined): IndentKind {
  return value === 'spaces4' || value === 'tabs' ? value : 'spaces2';
}
