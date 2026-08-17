import type * as MonacoApi from 'monaco-editor';

import { ThemeName } from '../../../core/theme/theme.service';

/** Cómo se llama cada tema dentro de Monaco. */
export const DRUSE_THEME_NAMES: Readonly<Record<ThemeName, string>> = {
  dark: 'druse-dark',
  light: 'druse-light',
};

/**
 * Temas de Monaco, uno por paleta de la aplicación.
 *
 * Los colores se repiten aquí en lugar de leerse de las variables CSS porque
 * Monaco necesita valores literales al registrar el tema, antes de que exista
 * ningún elemento del que resolver `var()`. Si cambia la paleta hay que tocar
 * los dos sitios: `_tokens.scss` y este archivo.
 *
 * El claro no es el oscuro con los colores dados la vuelta. Sobre blanco, el
 * verde y el naranja del oscuro deslumbran y las palabras reservadas pierden
 * peso, así que la sintaxis conserva los mismos papeles —violeta para las
 * reservadas, verde para los literales de texto, naranja para los números— con
 * tonos bastante más profundos.
 */
export const DRUSE_THEMES: Readonly<Record<ThemeName, MonacoApi.editor.IStandaloneThemeData>> = {
  dark: {
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
      'editor.background': '#0B0D11',
      'editor.foreground': '#DCE3F0',
      'editorLineNumber.foreground': '#3F485C',
      'editorLineNumber.activeForeground': '#6C8BFF',
      'editorCursor.foreground': '#6C8BFF',
      'editor.selectionBackground': '#6C8BFF3D',
      'editor.inactiveSelectionBackground': '#6C8BFF1F',
      'editor.lineHighlightBackground': '#6C8BFF12',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#171E2B',
      'editorIndentGuide.activeBackground1': '#2A3348',
      'editorWidget.background': '#141A26',
      'editorWidget.border': '#2A3348',
      'editorSuggestWidget.background': '#141A26',
      'editorSuggestWidget.border': '#2A3348',
      'editorSuggestWidget.selectedBackground': '#6C8BFF29',
      'editorSuggestWidget.highlightForeground': '#9FB0FF',
      'editorHoverWidget.background': '#141A26',
      'editorHoverWidget.border': '#2A3348',
      'scrollbarSlider.background': '#1E253480',
      'scrollbarSlider.hoverBackground': '#2A3348B3',
      'scrollbarSlider.activeBackground': '#2A3348',
      'minimap.background': '#0A0C11',
      'editorGutter.background': '#0B0D11',
      'editorOverviewRuler.border': '#151B26',
    },
  },
  light: {
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
      'editor.background': '#FFFFFF',
      'editor.foreground': '#1C2432',
      'editorLineNumber.foreground': '#A4ABB9',
      'editorLineNumber.activeForeground': '#4A67E8',
      'editorCursor.foreground': '#4A67E8',
      'editor.selectionBackground': '#4A67E838',
      'editor.inactiveSelectionBackground': '#4A67E81F',
      'editor.lineHighlightBackground': '#4A67E80F',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#E4E8F0',
      'editorIndentGuide.activeBackground1': '#B9C2D4',
      'editorWidget.background': '#FFFFFF',
      'editorWidget.border': '#D2D8E4',
      'editorSuggestWidget.background': '#FFFFFF',
      'editorSuggestWidget.border': '#D2D8E4',
      'editorSuggestWidget.selectedBackground': '#4A67E824',
      'editorSuggestWidget.highlightForeground': '#2F49C9',
      'editorHoverWidget.background': '#FFFFFF',
      'editorHoverWidget.border': '#D2D8E4',
      'scrollbarSlider.background': '#93A2C455',
      'scrollbarSlider.hoverBackground': '#93A2C488',
      'scrollbarSlider.activeBackground': '#93A2C4',
      'minimap.background': '#FAFBFD',
      'editorGutter.background': '#FFFFFF',
      'editorOverviewRuler.border': '#EAEDF4',
    },
  },
};
