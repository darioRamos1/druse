import type * as MonacoApi from 'monaco-editor';

import { ThemeName } from '../../../core/theme/appearance';
import { parseHex, shift, toHex } from '../../../core/theme/color';

/** Cómo se llama cada tema dentro de Monaco. */
export const DRUSE_THEME_NAMES: Readonly<Record<ThemeName, string>> = {
  dark: 'druse-dark',
  light: 'druse-light',
};

/**
 * El acento de cada paleta, para cuando el usuario no ha elegido ninguno.
 *
 * Se repite aquí, como el resto de colores del editor, porque Monaco necesita
 * valores literales al registrar el tema, antes de que exista ningún elemento
 * del que resolver `var()`.
 */
const DEFAULT_ACCENT: Readonly<Record<ThemeName, string>> = {
  dark: '#6c8bff',
  light: '#4a67e8',
};

/**
 * Temas de Monaco, uno por paleta de la aplicación.
 *
 * El claro no es el oscuro con los colores dados la vuelta. Sobre blanco, el
 * verde y el naranja del oscuro deslumbran y las palabras reservadas pierden
 * peso, así que la sintaxis conserva los mismos papeles —violeta para las
 * reservadas, verde para los literales de texto, naranja para los números— con
 * tonos bastante más profundos.
 *
 * **El fondo va transparente a propósito.** El color de debajo lo pone el
 * contenedor con `--dr-surface-base`, que es exactamente el mismo, y así el
 * editor puede enseñar una imagen detrás sin volver a registrar el tema cada vez
 * que se pone o se quita.
 */
export function druseTheme(
  theme: ThemeName,
  accent: string | null,
): MonacoApi.editor.IStandaloneThemeData {
  const base = theme === 'light' ? LIGHT : DARK;
  const chosen = parseHex(accent ?? '') ?? parseHex(DEFAULT_ACCENT[theme])!;

  // Sobre el fondo del editor, el acento pleno solo se ve bien en el cursor y en
  // la numeración; para pintar zonas —la selección, la línea actual— hace falta
  // el mismo color muy diluido, y ahí el alfa va en el propio color.
  const hex = toHex(chosen);
  const soft = toHex(shift(chosen, theme === 'light' ? { l: -6 } : { l: 6 }));

  return {
    ...base,
    colors: {
      ...base.colors,
      'editorLineNumber.activeForeground': hex,
      'editorCursor.foreground': hex,
      'editor.selectionBackground': `${hex}3D`,
      'editor.inactiveSelectionBackground': `${hex}1F`,
      'editor.lineHighlightBackground': `${hex}12`,
      'editorSuggestWidget.selectedBackground': `${hex}29`,
      'editorSuggestWidget.highlightForeground': soft,
    },
  };
}

const DARK: MonacoApi.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    // Palabras reservadas: violeta, como SELECT / FROM / WHERE en el mockup.
    { token: 'keyword', foreground: 'A78BFA', fontStyle: 'bold' },
    { token: 'keyword.sql', foreground: 'A78BFA', fontStyle: 'bold' },
    { token: 'operator.sql', foreground: '66728A' },
    { token: 'delimiter', foreground: '66728A' },
    { token: 'delimiter.parenthesis', foreground: '66728A' },
    // Identificadores y alias.
    { token: 'identifier', foreground: 'DCE3F0' },
    { token: 'identifier.quote', foreground: '7FE3A8' },
    // Literales.
    { token: 'string', foreground: '7FE3A8' },
    { token: 'string.sql', foreground: '7FE3A8' },
    { token: 'number', foreground: 'F2B36B' },
    { token: 'predefined', foreground: 'F2B36B' },
    { token: 'comment', foreground: '3F485C', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#00000000',
    'editor.foreground': '#DCE3F0',
    'editorLineNumber.foreground': '#3F485C',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#171E2B',
    'editorIndentGuide.activeBackground1': '#2A3348',
    'editorWidget.background': '#141A26',
    'editorWidget.border': '#2A3348',
    'editorSuggestWidget.background': '#141A26',
    'editorSuggestWidget.border': '#2A3348',
    'editorHoverWidget.background': '#141A26',
    'editorHoverWidget.border': '#2A3348',
    'scrollbarSlider.background': '#1E253480',
    'scrollbarSlider.hoverBackground': '#2A3348B3',
    'scrollbarSlider.activeBackground': '#2A3348',
    'minimap.background': '#00000000',
    'editorGutter.background': '#00000000',
    'editorOverviewRuler.border': '#151B26',
  },
};

const LIGHT: MonacoApi.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '6D47E0', fontStyle: 'bold' },
    { token: 'keyword.sql', foreground: '6D47E0', fontStyle: 'bold' },
    { token: 'operator.sql', foreground: '7B8496' },
    { token: 'delimiter', foreground: '7B8496' },
    { token: 'delimiter.parenthesis', foreground: '7B8496' },
    { token: 'identifier', foreground: '1C2432' },
    { token: 'identifier.quote', foreground: '0F7A55' },
    { token: 'string', foreground: '0F7A55' },
    { token: 'string.sql', foreground: '0F7A55' },
    { token: 'number', foreground: 'A85D06' },
    { token: 'predefined', foreground: 'A85D06' },
    { token: 'comment', foreground: '8B93A4', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#00000000',
    'editor.foreground': '#1C2432',
    'editorLineNumber.foreground': '#A4ABB9',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#E4E8F0',
    'editorIndentGuide.activeBackground1': '#B9C2D4',
    'editorWidget.background': '#FFFFFF',
    'editorWidget.border': '#D2D8E4',
    'editorSuggestWidget.background': '#FFFFFF',
    'editorSuggestWidget.border': '#D2D8E4',
    'editorHoverWidget.background': '#FFFFFF',
    'editorHoverWidget.border': '#D2D8E4',
    'scrollbarSlider.background': '#93A2C455',
    'scrollbarSlider.hoverBackground': '#93A2C488',
    'scrollbarSlider.activeBackground': '#93A2C4',
    'minimap.background': '#00000000',
    'editorGutter.background': '#00000000',
    'editorOverviewRuler.border': '#EAEDF4',
  },
};
