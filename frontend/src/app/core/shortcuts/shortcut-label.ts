/** Etiqueta de los atajos registrados con CtrlCmd en Monaco y el shell. */
export function shortcutLabel(
  shortcut: string,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform)
    ? shortcut
        .replace(/\bCtrl\b/g, '⌘')
        .replace(/\bShift\b/g, '⇧')
        .replace(/\bAlt\b/g, '⌥')
    : shortcut;
}

export type EditorShortcut = 'replace' | 'cursor-above' | 'copy-line-down';

/** Excepciones registradas por Monaco en find, multicursor y linesOperations. */
export function editorShortcutLabel(
  action: EditorShortcut,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
): string {
  const mac = /Mac|iPhone|iPad|iPod/i.test(platform);
  const linux = /Linux/i.test(platform);
  const keys = {
    replace: mac ? 'Ctrl+Alt+F' : 'Ctrl+H',
    'cursor-above': linux ? 'Shift+Alt+↑' : 'Ctrl+Alt+↑',
    'copy-line-down': linux ? 'Ctrl+Shift+Alt+↓' : 'Shift+Alt+↓',
  };
  return shortcutLabel(keys[action], platform);
}
