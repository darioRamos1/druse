import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ResizeHandle } from './resize-handle';

@Component({
  imports: [ResizeHandle],
  template: ` <app-resize-handle axis="width" [(size)]="width" [min]="100" [max]="400" /> `,
})
class HostComponent {
  readonly width = signal(200);
}

describe('ResizeHandle', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let handle: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    handle = (fixture.nativeElement as HTMLElement).querySelector('app-resize-handle')!;
    await fixture.whenStable();
  });

  it('se anuncia como separador con sus límites', () => {
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('100');
    expect(handle.getAttribute('aria-valuemax')).toBe('400');
    expect(handle.getAttribute('aria-valuenow')).toBe('200');
  });

  it('se ajusta con el teclado', async () => {
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();

    expect(host.width()).toBe(216);

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await fixture.whenStable();

    expect(host.width()).toBe(200);
  });

  it('un arrastre al 125 % convierte la distancia a píxeles CSS', async () => {
    handle.setPointerCapture = vi.fn();
    Object.defineProperty(handle, 'offsetWidth', { value: 5, configurable: true });
    vi.spyOn(handle, 'getBoundingClientRect').mockReturnValue({ width: 6.25 } as DOMRect);
    handle.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100 }));
    handle.dispatchEvent(new MouseEvent('pointermove', { clientX: 150 }));
    await fixture.whenStable();
    expect(host.width()).toBe(240);
  });

  it('no baja del mínimo por muchas veces que se pulse', async () => {
    for (let i = 0; i < 20; i++) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    }
    await fixture.whenStable();

    expect(host.width()).toBe(100);
  });

  it('no supera el máximo', async () => {
    for (let i = 0; i < 20; i++) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    }
    await fixture.whenStable();

    expect(host.width()).toBe(400);
  });

  it('ignora las teclas del otro eje', async () => {
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await fixture.whenStable();

    expect(host.width()).toBe(200);
  });
});
