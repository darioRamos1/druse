/**
 * Los atajos de la aplicación, en un solo sitio y sin tocar el DOM.
 *
 * Traducir una tecla a una intención es la parte que se equivoca —modificadores
 * cruzados, teclas que el navegador se queda, el mismo Escape queriendo decir
 * tres cosas—, así que vive aquí, como función pura, y se prueba sin montar la
 * ventana entera. Quién puede atender cada intención lo decide el shell, que es
 * el que sabe si hay un diálogo delante.
 */

/** Lo que el usuario ha pedido con el teclado. */
export type Shortcut =
  | { readonly kind: 'palette' }
  | { readonly kind: 'shortcuts' }
  | { readonly kind: 'tab'; readonly index: number }
  | { readonly kind: 'tab-last' }
  | { readonly kind: 'tab-next' }
  | { readonly kind: 'tab-previous' }
  | { readonly kind: 'tab-close' }
  | { readonly kind: 'focus-results' }
  | { readonly kind: 'focus-editor' }
  | { readonly kind: 'run-again' }
  | { readonly kind: 'export' };

/**
 * Qué pidió esta pulsación, si es que pidió algo.
 *
 * **Los modificadores se comprueban enteros**: sin exigir que `alt` esté
 * apagado, `Ctrl+Alt+1` —que en varios teclados es como se escribe un carácter—
 * cambiaría de pestaña mientras alguien escribe.
 */
export function shortcutFor(event: KeyboardEvent): Shortcut | null {
  const mando = event.ctrlKey || event.metaKey;
  const key = event.key;

  if (mando && !event.altKey && !event.shiftKey && key.toLowerCase() === 'k') {
    return { kind: 'palette' };
  }

  // Ayuda: F1 es donde la busca todo el mundo, y no la usa nadie más.
  if (key === 'F1' && !mando && !event.altKey && !event.shiftKey) {
    return { kind: 'shortcuts' };
  }

  /*
   * Las pestañas van con Alt y no con Ctrl a propósito.
   *
   * `Ctrl+Tab`, `Ctrl+W` y `Ctrl+1` son atajos del navegador: no llegan a la
   * página, así que en el navegador el atajo no existiría y en la ventana
   * empaquetada sí. Un atajo que funciona en un sitio y no en otro es peor que
   * no tenerlo.
   */
  if (event.altKey && !mando && !event.shiftKey) {
    if (key === 'ArrowRight') {
      return { kind: 'tab-next' };
    }

    if (key === 'ArrowLeft') {
      return { kind: 'tab-previous' };
    }

    // Alt+9 va a la última, como en los navegadores y en VS Code: con muchas
    // pestañas abiertas, «la última» es una posición que se sabe sin contar.
    if (key === '9') {
      return { kind: 'tab-last' };
    }

    if (key >= '1' && key <= '8') {
      return { kind: 'tab', index: Number(key) - 1 };
    }
  }

  // Cerrar la pestaña: Ctrl+F4, que es lo que usa Windows para «cerrar el
  // documento, no el programa». `Ctrl+W` cerraría el navegador entero.
  if (mando && !event.altKey && !event.shiftKey && key === 'F4') {
    return { kind: 'tab-close' };
  }

  if (mando && event.shiftKey && !event.altKey && key.toLowerCase() === 'r') {
    return { kind: 'focus-results' };
  }

  if (mando && event.shiftKey && !event.altKey && key.toLowerCase() === 'x') {
    return { kind: 'export' };
  }

  // Repetir la última ejecución. F5 en un navegador recarga la página, y aquí
  // recargar sería perder las pestañas abiertas: se atiende y se detiene.
  if (key === 'F5' && !mando && !event.altKey && !event.shiftKey) {
    return { kind: 'run-again' };
  }

  if (key === 'Escape' && !mando && !event.altKey && !event.shiftKey) {
    return { kind: 'focus-editor' };
  }

  return null;
}
