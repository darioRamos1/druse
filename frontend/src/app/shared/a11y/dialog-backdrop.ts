import { Directive, ElementRef, HostListener, inject, input, output } from '@angular/core';

/**
 * El velo de un diálogo: qué pasa al pulsar fuera.
 *
 * Antes cualquier `click` en el velo cerraba, y eso hace daño donde más duele: un
 * roce del ratón a medio asistente —tres pasos de selección, la ruta escrita, el
 * mapeo de columnas— y todo desaparece sin preguntar. Es la clase de error que se
 * comete una vez y se recuerda siempre.
 *
 * Ahora hay dos comportamientos, y cada diálogo elige el suyo con
 * <see cref="closeOnClick" />:
 *
 * - **Por omisión no cierra.** Es lo que llevan los que tienen trabajo dentro:
 *   se sale con Escape, con Cancelar o con la ×, que son gestos que nadie hace
 *   sin querer. Al pulsar fuera, el diálogo da una sacudida breve: sin esa
 *   señal, quien lo intenta cree que la aplicación se ha quedado colgada.
 * - **Con `closeOnClick`, cierra** —los ligeros: preferencias, la hoja de
 *   atajos, el diagrama—, pero solo si **el gesto entero ocurrió en el velo**.
 *   Empezar a arrastrar dentro del diálogo para seleccionar texto y soltar fuera
 *   ya no lo cierra, que es el otro accidente clásico.
 */
@Directive({
  selector: '.backdrop',
})
export class DialogBackdrop {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Si pulsar fuera cierra el diálogo.
   *
   * Por omisión **no**: se elige lo seguro, y quien quiera lo contrario lo dice.
   */
  readonly closeOnClick = input(false);

  /** Se pidió cerrar desde el velo, con el gesto entero hecho ahí. */
  readonly dismiss = output<void>();

  /** Si el gesto empezó en el propio velo y no dentro del diálogo. */
  private _startedOnBackdrop = false;

  @HostListener('pointerdown', ['$event'])
  protected onPointerDown(event: PointerEvent): void {
    this._startedOnBackdrop = event.target === this._host.nativeElement;
  }

  @HostListener('click', ['$event'])
  protected onClick(event: MouseEvent): void {
    const onBackdrop = event.target === this._host.nativeElement && this._startedOnBackdrop;

    this._startedOnBackdrop = false;

    if (!onBackdrop) {
      return;
    }

    if (this.closeOnClick()) {
      this.dismiss.emit();

      return;
    }

    this.nudge();
  }

  /**
   * Una sacudida corta del diálogo: «sigo aquí, y no me cierro así».
   *
   * La clase se quita al terminar la animación para que pueda repetirse. Si el
   * navegador no llega a avisar —una pestaña en segundo plano—, un plazo la
   * retira igual: una clase pegada dejaría el diálogo sin poder sacudirse nunca
   * más.
   */
  private nudge(): void {
    const dialog = this._host.nativeElement.parentElement?.querySelector('.dialog');

    if (!(dialog instanceof HTMLElement) || dialog.classList.contains('is-nudging')) {
      return;
    }

    dialog.classList.add('is-nudging');

    const quitar = () => dialog.classList.remove('is-nudging');

    dialog.addEventListener('animationend', quitar, { once: true });
    setTimeout(quitar, 600);
  }
}
