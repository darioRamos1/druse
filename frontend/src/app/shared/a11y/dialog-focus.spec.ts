import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DialogFocus } from './dialog-focus';

/**
 * Un diálogo cualquiera con lo que tienen todos: un botón de cerrar, un campo y
 * dos botones al pie. Fuera de él, el botón que lo abre.
 */
@Component({
  selector: 'app-anfitrion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogFocus],
  template: `
    <button type="button" id="abrir" (click)="abierto.set(true)">Abrir</button>

    @if (abierto()) {
      <div class="backdrop">
        <div class="dialog">
          <button type="button" id="cerrar">×</button>
          <input id="nombre" />
          <button type="button" id="aceptar">Aceptar</button>
        </div>
      </div>
    }
  `,
})
class Anfitrion {
  readonly abierto = signal(false);
}

describe('DialogFocus', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let element: HTMLElement;

  function id<T extends HTMLElement>(name: string): T {
    return element.querySelector<T>(`#${name}`)!;
  }

  async function abrir(): Promise<void> {
    id('abrir').focus();
    id('abrir').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Anfitrion] }).compileComponents();

    fixture = TestBed.createComponent(Anfitrion);
    element = fixture.nativeElement as HTMLElement;

    // El foco solo se mueve de verdad si el componente está en el documento.
    document.body.appendChild(element);
    fixture.detectChanges();
  });

  afterEach(() => element.remove());

  /**
   * Sin esto el diálogo se abre delante y el teclado sigue moviéndose por lo que
   * tapa: quien navega sin ratón no tiene forma de saber que hay algo abierto.
   */
  it('al abrirse, el foco entra en el diálogo', async () => {
    await abrir();

    expect(document.activeElement).toBe(id('cerrar'));
  });

  it('Tab en el último control vuelve al primero', async () => {
    await abrir();

    id('aceptar').focus();

    const evento = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

    id('aceptar').dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(id('cerrar'));
  });

  it('Shift+Tab en el primero va al último', async () => {
    await abrir();

    const evento = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    id('cerrar').dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(id('aceptar'));
  });

  /**
   * Cerrar sin devolver el foco lo deja en el cuerpo del documento, y hay que
   * recorrer la aplicación entera para volver al botón que se acababa de pulsar.
   */
  it('al cerrarse, el foco vuelve a lo que lo abrió', async () => {
    await abrir();

    fixture.componentInstance.abierto.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(id('abrir'));
  });

  /**
   * Y no se le quita el foco a quien ya lo movió a otro control: devolverlo
   * entonces sería robarlo.
   *
   * Distinto de que el foco se pierda —eso pasa siempre al quitar el nodo del
   * diálogo, y ahí sí hay que devolverlo—.
   */
  it('si el foco se movió a otro control, al cerrar no se toca', async () => {
    await abrir();

    const fuera = document.createElement('button');

    document.body.appendChild(fuera);
    fuera.focus();

    fixture.componentInstance.abierto.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(fuera);

    fuera.remove();
  });
});
