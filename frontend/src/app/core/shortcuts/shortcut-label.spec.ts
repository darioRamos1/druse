import { editorShortcutLabel, shortcutLabel } from './shortcut-label';

describe('shortcutLabel', () => {
  it.each([
    ['Win32', 'Ctrl+Shift+Enter'],
    ['Linux x86_64', 'Ctrl+Shift+Enter'],
    ['MacIntel', '⌘+⇧+Enter'],
  ])('muestra los modificadores de %s', (platform, expected) => {
    expect(shortcutLabel('Ctrl+Shift+Enter', platform)).toBe(expected);
    expect(shortcutLabel('F5', platform)).toBe('F5');
  });

  it('respeta las combinaciones propias de Monaco en cada sistema', () => {
    expect(editorShortcutLabel('replace', 'MacIntel')).toBe('⌘+⌥+F');
    expect(editorShortcutLabel('replace', 'Win32')).toBe('Ctrl+H');
    expect(editorShortcutLabel('cursor-above', 'Linux x86_64')).toBe('Shift+Alt+↑');
    expect(editorShortcutLabel('copy-line-down', 'Linux x86_64')).toBe('Ctrl+Shift+Alt+↓');
    expect(editorShortcutLabel('copy-line-down', 'MacIntel')).toBe('⇧+⌥+↓');
  });
});
