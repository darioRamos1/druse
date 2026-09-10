import { Shortcut, shortcutFor } from './shortcuts';

function pulsar(key: string, modificadores: Partial<KeyboardEventInit> = {}): Shortcut | null {
  return shortcutFor(new KeyboardEvent('keydown', { key, ...modificadores }));
}

describe('shortcutFor', () => {
  it('la paleta se abre con Ctrl+K y con Cmd+K', () => {
    expect(pulsar('k', { ctrlKey: true })).toEqual({ kind: 'palette' });
    expect(pulsar('K', { metaKey: true })).toEqual({ kind: 'palette' });
  });

  it('F1 abre la hoja de atajos', () => {
    expect(pulsar('F1')).toEqual({ kind: 'shortcuts' });
  });

  it('Ctrl o Cmd con Shift+E enfoca el explorador sin aceptar Alt', () => {
    expect(pulsar('E', { ctrlKey: true, shiftKey: true })).toEqual({ kind: 'focus-explorer' });
    expect(pulsar('e', { metaKey: true, shiftKey: true })).toEqual({ kind: 'focus-explorer' });
    expect(pulsar('e', { ctrlKey: true, shiftKey: true, altKey: true })).toBeNull();
  });

  describe('pestañas', () => {
    it('Alt y un número van a esa pestaña, contando desde cero', () => {
      expect(pulsar('1', { altKey: true })).toEqual({ kind: 'tab', index: 0 });
      expect(pulsar('8', { altKey: true })).toEqual({ kind: 'tab', index: 7 });
    });

    /** Con muchas abiertas, «la última» es una posición que se sabe sin contar. */
    it('Alt+9 va a la última, no a la novena', () => {
      expect(pulsar('9', { altKey: true })).toEqual({ kind: 'tab-last' });
    });

    it('Alt y las flechas se mueven de una en una', () => {
      expect(pulsar('ArrowRight', { altKey: true })).toEqual({ kind: 'tab-next' });
      expect(pulsar('ArrowLeft', { altKey: true })).toEqual({ kind: 'tab-previous' });
    });

    it('Ctrl+F4 cierra la pestaña', () => {
      expect(pulsar('F4', { ctrlKey: true })).toEqual({ kind: 'tab-close' });
    });

    /**
     * En varios teclados `Ctrl+Alt+1` es como se escribe un carácter. Sin
     * comprobar los modificadores enteros, escribirlo cambiaría de pestaña.
     */
    it('Ctrl+Alt y un número no es cambiar de pestaña', () => {
      expect(pulsar('1', { altKey: true, ctrlKey: true })).toBeNull();
    });

    it('Alt+Shift y un número tampoco', () => {
      expect(pulsar('2', { altKey: true, shiftKey: true })).toBeNull();
    });
  });

  it('el foco salta a los resultados y vuelve al editor', () => {
    expect(pulsar('r', { ctrlKey: true, shiftKey: true })).toEqual({ kind: 'focus-results' });
    expect(pulsar('Escape')).toEqual({ kind: 'focus-editor' });
  });

  it('F5 repite la última ejecución y Ctrl+Shift+X exporta', () => {
    expect(pulsar('F5')).toEqual({ kind: 'run-again' });
    expect(pulsar('x', { ctrlKey: true, shiftKey: true })).toEqual({ kind: 'export' });
  });

  it('escribir una letra cualquiera no pide nada', () => {
    expect(pulsar('a')).toBeNull();
    expect(pulsar('Enter')).toBeNull();
    expect(pulsar('r', { ctrlKey: true })).toBeNull();
  });
});
