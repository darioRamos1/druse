import { shortcutLabel } from './shortcut-label';

describe('shortcutLabel', () => {
  it.each([
    ['Win32', 'Ctrl+Shift+Enter'],
    ['Linux x86_64', 'Ctrl+Shift+Enter'],
    ['MacIntel', '⌘+⇧+Enter'],
  ])('muestra los modificadores de %s', (platform, expected) => {
    expect(shortcutLabel('Ctrl+Shift+Enter', platform)).toBe(expected);
    expect(shortcutLabel('F5', platform)).toBe('F5');
  });
});
