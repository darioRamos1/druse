import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DialogBackdrop } from './dialog-backdrop';

/** Un diálogo con su velo, como los de verdad: hermanos dentro del host. */
@Component({
  selector: 'app-anfitrion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogBackdrop],
  template: `
    <div class="backdrop" [closeOnClick]="ligero()" (dismiss)="cerrado.set(true)"></div>
    <div class="dialog">
      <input id="nombre" />
    </div>
  `,
})
class Anfitrion {
  readonly ligero = signal(false);
  readonly cerrado = signal(false);
}

describe('DialogBackdrop', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let element: HTMLElement;

  function velo(): HTMLElement {
    return element.querySelector<HTMLElement>('.backdrop')!;
  }

  function dialogo(): HTMLElement {
    return element.querySelector<HTMLElement>('.dialog')!;
  }

  /** Un gesto completo: se pulsa y se suelta en el mismo sitio. */
  function pulsar(sobre: HTMLElement): void {
    sobre.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    sobre.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Anfitrion] }).compileComponents();

    fixture = TestBed.createComponent(Anfitrion);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  /**
   * El caso que motiva todo esto: un roce del ratón a media faena borraba el
   * asistente entero sin preguntar.
   */
  it('por omisión, pulsar fuera no cierra', () => {
    pulsar(velo());

    expect(fixture.componentInstance.cerrado()).toBe(false);
  });

  /**
   * Pero se dice que sigue ahí: sin señal, quien lo intenta cree que la
   * aplicación se ha quedado colgada y lo vuelve a intentar más fuerte.
   */
  it('al pulsar fuera, el diálogo se sacude', () => {
    pulsar(velo());

    expect(dialogo().classList.contains('is-nudging')).toBe(true);
  });

  it('los diálogos ligeros sí se cierran al pulsar fuera', () => {
    fixture.componentInstance.ligero.set(true);
    fixture.detectChanges();

    pulsar(velo());

    expect(fixture.componentInstance.cerrado()).toBe(true);
  });

  /**
   * El otro accidente clásico: arrastrar dentro del diálogo para seleccionar
   * texto y soltar fuera. El gesto empezó dentro, así que no cierra ni en los
   * ligeros.
   */
  it('un gesto que empieza dentro del diálogo no cierra al soltar fuera', () => {
    fixture.componentInstance.ligero.set(true);
    fixture.detectChanges();

    dialogo().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    velo().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.cerrado()).toBe(false);
  });

  /**
   * Y pulsar dentro nunca cierra, que es lo que se hace todo el rato: escribir,
   * elegir, marcar casillas.
   */
  it('pulsar dentro del diálogo no hace nada', () => {
    fixture.componentInstance.ligero.set(true);
    fixture.detectChanges();

    pulsar(element.querySelector<HTMLElement>('#nombre')!);

    expect(fixture.componentInstance.cerrado()).toBe(false);
    expect(dialogo().classList.contains('is-nudging')).toBe(false);
  });
});
