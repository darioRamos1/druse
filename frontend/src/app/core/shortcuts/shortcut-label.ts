/** Etiqueta de los atajos registrados con CtrlCmd en Monaco y el shell. */
export function shortcutLabel(
  shortcut: string,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform)
    ? shortcut.replace(/\bCtrl\b/g, '⌘').replace(/\bShift\b/g, '⇧')
    : shortcut;
}
