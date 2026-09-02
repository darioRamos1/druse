import { ComponentFixture, TestBed } from '@angular/core/testing';

import { shortcutFor } from '../../core/shortcuts/shortcuts';
import { SHORTCUT_GROUPS, ShortcutsSheet } from './shortcuts-sheet';

describe('ShortcutsSheet', () => {
  let fixture: ComponentFixture<ShortcutsSheet>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ShortcutsSheet] }).compileComponents();

    fixture = TestBed.createComponent(ShortcutsSheet);
    fixture.detectChanges();
  });

  it('enseña los grupos y sus teclas', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Pestañas');
    expect(text).toContain('Ejecutar la consulta entera');
    expect(text).toContain('Poner otro cursor donde se pulse');
  });

  it('reparte los grupos en dos columnas', () => {
    expect(fixture.nativeElement.querySelectorAll('.column')).toHaveLength(2);
  });

  it('se cierra con la cruz', () => {
    let cerrado = 0;
    fixture.componentInstance.closed.subscribe(() => cerrado++);

    fixture.nativeElement.querySelector('.close').click();

    expect(cerrado).toBe(1);
  });

  /**
   * La hoja es documentación, y una documentación que miente es peor que
   * ninguna. Los atajos globales que anuncia se comprueban contra quien los
   * atiende de verdad: si alguien cambia uno y no toca el otro, esto se pone
   * rojo.
   *
   * Los del editor no pasan por aquí —los registra Monaco— y por eso no entran.
   */
  describe('lo que anuncia existe', () => {
    const globales: readonly [string, Partial<KeyboardEventInit>][] = [
      ['F1', {}],
      ['F5', {}],
      ['k', { ctrlKey: true }],
      ['x', { ctrlKey: true, shiftKey: true }],
      ['r', { ctrlKey: true, shiftKey: true }],
      ['F4', { ctrlKey: true }],
      ['1', { altKey: true }],
      ['9', { altKey: true }],
      ['ArrowLeft', { altKey: true }],
      ['ArrowRight', { altKey: true }],
      ['Escape', {}],
    ];

    it.each(globales)('%s responde', (key, modificadores) => {
      expect(shortcutFor(new KeyboardEvent('keydown', { key, ...modificadores }))).not.toBeNull();
    });

    it('cada atajo de la hoja dice qué hace y con qué teclas', () => {
      for (const grupo of SHORTCUT_GROUPS) {
        for (const atajo of grupo.shortcuts) {
          expect(atajo.keys.length).toBeGreaterThan(0);
          expect(atajo.what.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
