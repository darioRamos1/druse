import {
  Directive,
  ElementRef,
  HostListener,
  OnDestroy,
  afterNextRender,
  inject,
} from '@angular/core';

/** Lo que el navegador considera enfocable dentro de un diálogo. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * El foco entra en el diálogo, se queda dentro y vuelve a donde estaba.
 *
 * Sin esto, un diálogo es una trampa al revés: se abre delante y el foco sigue en
 * la página de detrás, así que **el teclado sigue moviéndose por lo que el
 * diálogo tapa**. Con `Tab` se recorren los botones de la barra superior sin
 * verlos, y quien navega sin ratón —o con lector de pantalla— no tiene forma de
 * saber que hay algo abierto.
 *
 * Las tres partes son una sola cosa y por eso van juntas:
 *
 * - **Entrar**: al abrirse, el foco va al primer control del diálogo.
 * - **Quedarse**: `Tab` en el último vuelve al primero, y `Shift+Tab` en el
 *   primero va al último.
 * - **Volver**: al cerrarse, el foco regresa a lo que lo abrió. Sin esta parte,
 *   cerrar un diálogo deja el foco en el cuerpo del documento y hay que recorrer
 *   la aplicación entera para volver al botón que se acababa de pulsar.
 *
 * Se aplica por la clase que ya comparten todos los diálogos, así que no hay nada
 * que añadir a la plantilla: basta con importarla en el componente. Escape lo
 * trata cada diálogo por su cuenta —cierra el suyo, que es lo que sabe hacer— y
 * aquí no se toca.
 */
@Directive({
  selector: '.dialog',
})
export class DialogFocus implements OnDestroy {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Quién tenía el foco antes de abrirse.
   *
   * Se guarda al construirse y no al renderizar: para entonces el foco ya podría
   * haberse movido.
   */
  private readonly _opener = typeof document === 'undefined' ? null : document.activeElement;

  constructor() {
    afterNextRender(() => this.focusFirst());
  }

  ngOnDestroy(): void {
    const active = document.activeElement;

    // El foco se devuelve si estaba dentro del diálogo o si **se ha quedado sin
    // sitio**: al quitar el nodo, el navegador lo manda al cuerpo del documento
    // antes de que llegue este momento, y ese es justo el caso que hay que
    // arreglar. Lo que no se toca es un foco que el usuario ya movió a otro
    // control de la página: devolverlo entonces sería quitárselo.
    const perdido = active === null || active === document.body;
    const dentro = this._host.nativeElement.contains(active);

    if (!perdido && !dentro) {
      return;
    }

    if (this._opener instanceof HTMLElement && this._opener.isConnected) {
      this._opener.focus();
    }
  }

  /**
   * `Tab` da la vuelta dentro del diálogo en lugar de salirse.
   *
   * Se mira al pulsar y no al abrir: los diálogos de Druse son asistentes con
   * pasos, y lo que se puede enfocar cambia según el paso.
   */
  @HostListener('keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }

    const focusables = this.focusables();

    if (focusables.length === 0) {
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();

      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }

  /**
   * El primer control del diálogo, y si no hay ninguno, el diálogo mismo.
   *
   * Lo segundo importa: un diálogo que solo enseña algo —un resumen, un aviso—
   * también tiene que recibir el foco, o el lector de pantalla seguirá leyendo lo
   * que hay detrás.
   */
  private focusFirst(): void {
    const dialog = this._host.nativeElement;
    const [first] = this.focusables();

    if (first) {
      first.focus();

      return;
    }

    dialog.tabIndex = -1;
    dialog.focus();
  }

  /**
   * Lo enfocable que además está visible: un paso oculto no cuenta.
   *
   * Se mira lo que **dice el estilo** y no `offsetParent`, que sería lo obvio:
   * `offsetParent` depende de que haya un diseño calculado, y en las pruebas de
   * componente no lo hay, así que allí no habría nada enfocable nunca. Lo que se
   * quiere excluir —un paso del asistente que está en el DOM pero apagado— se ve
   * igual de bien así.
   */
  private focusables(): HTMLElement[] {
    return [...this._host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => {
        if (element.closest('[hidden]')) {
          return false;
        }

        const style = getComputedStyle(element);

        return style.display !== 'none' && style.visibility !== 'hidden';
      },
    );
  }
}
