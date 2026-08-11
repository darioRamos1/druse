import type * as MonacoApi from 'monaco-editor';

export const DRUSE_THEME_NAME = 'druse-dark';

/**
 * Tema de Monaco derivado del mockup (docs/mockups/druse-main.html).
 *
 * Los colores se repiten aquí en lugar de leerse de las variables CSS porque
 * Monaco necesita valores literales al registrar el tema, antes de que exista
 * ningún elemento del que resolver `var()`. Si cambia la paleta hay que tocar
 * los dos sitios: `_tokens.scss` y este archivo.
 */
export const DRUSE_THEME: MonacoApi.editor.IStandaloneThemeData = {
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
};
