import { ChangeDetectionStrategy, Component, input, model, signal } from '@angular/core';

/**
 * Tirador para redimensionar un panel adyacente.
 *
 * `axis` indica qué dimensión se ajusta:
 * - `width`: barra vertical, se arrastra en horizontal (panel lateral).
 * - `height`: barra horizontal, se arrastra en vertical (panel de resultados).
 *
 * `direction` indica hacia dónde crece el panel al arrastrar en sentido positivo.
 * El panel de resultados crece hacia arriba, de ahí `inverted`.
 *
 * Usa Pointer Events con captura, así el arrastre no se pierde al salir del
 * elemento ni al pasar por encima del editor.
 */
@Component({
  selector: 'app-resize-handle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: {
    '[class.is-width]': 'axis() === "width"',
    '[class.is-height]': 'axis() === "height"',
    '[class.is-dragging]': 'dragging()',
    '[attr.role]': '"separator"',
    '[attr.aria-orientation]': 'axis() === "width" ? "vertical" : "horizontal"',
    '[attr.aria-valuenow]': 'size()',
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-valuemax]': 'max()',
    '[attr.tabindex]': '0',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'onPointerUp($event)',
    '(keydown)': 'onKeyDown($event)',
  },
  styles: `
    :host {
      position: relative;
      z-index: 5;
      flex: none;
      background: transparent;
      touch-action: none;
      transition: background 120ms ease;
    }

    :host(.is-width) {
      width: 5px;
      margin-inline: -2px;
      cursor: col-resize;
    }

    :host(.is-height) {
      height: 5px;
      margin-block: -2px;
      cursor: row-resize;
    }

    :host(:hover),
    :host(.is-dragging),
    :host(:focus-visible) {
      background: var(--dr-accent);
      outline: none;
    }
  `,
})
export class ResizeHandle {
  /** Dimensión que ajusta este tirador. */
  readonly axis = input.required<'width' | 'height'>();

  /** Tamaño actual del panel en píxeles. Se actualiza durante el arrastre. */
  readonly size = model.required<number>();

  readonly min = input(140);
  readonly max = input(900);

  /** `true` cuando el panel crece al arrastrar hacia el origen (arriba o izquierda). */
  readonly inverted = input(false);

  /** Salto al ajustar con las flechas del teclado. */
  readonly step = input(16);

  protected readonly dragging = signal(false);

  private _origin = 0;
  private _startSize = 0;
  private _dragScale = 1;

  protected onPointerDown(event: PointerEvent): void {
    // Solo el botón principal arrastra.
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    // Pointer Events usa píxeles de pantalla; los tamaños del panel son píxeles CSS.
    const rect = target.getBoundingClientRect();
    this._dragScale =
      (this.axis() === 'width'
        ? rect.width / target.offsetWidth
        : rect.height / target.offsetHeight) || 1;

    this._origin = this.axis() === 'width' ? event.clientX : event.clientY;
    this._startSize = this.size();
    this.dragging.set(true);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    const current = this.axis() === 'width' ? event.clientX : event.clientY;
    const delta = ((current - this._origin) / this._dragScale) * (this.inverted() ? -1 : 1);

    this.apply(this._startSize + delta);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    this.dragging.set(false);
  }

  /** El tirador es accesible por teclado: sin esto no habría forma de ajustarlo. */
  protected onKeyDown(event: KeyboardEvent): void {
    const horizontal = this.axis() === 'width';
    const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const increase = horizontal ? 'ArrowRight' : 'ArrowDown';

    if (event.key !== decrease && event.key !== increase) {
      return;
    }

    event.preventDefault();

    const sign = (event.key === increase ? 1 : -1) * (this.inverted() ? -1 : 1);
    this.apply(this.size() + sign * this.step());
  }

  private apply(candidate: number): void {
    this.size.set(Math.min(this.max(), Math.max(this.min(), Math.round(candidate))));
  }
}
