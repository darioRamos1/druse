import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { FileSaveService } from '../../../core/files/file-save.service';
import { DEFAULT_APPEARANCE } from '../../../core/theme/appearance';
import { ThemeService } from '../../../core/theme/theme.service';
import { UpdateService } from '../../../core/update/update.service';
import { SettingsDialog } from './settings-dialog';

describe('SettingsDialog', () => {
  let fixture: ComponentFixture<SettingsDialog>;
  let element: HTMLElement;
  const appearance = signal(DEFAULT_APPEARANCE);
  const save = vi.fn(async () => ({ saved: true, path: 'prueba.zip' }));

  /**
   * El estado del actualizador, movible desde cada prueba.
   *
   * Hace falta porque la casilla de búsqueda automática solo existe donde la
   * distribución puede actualizarse, y eso —en la aplicación de verdad— solo
   * ocurre en una copia instalada: ni el navegador ni el barrido llegan ahí.
   */
  const updateInfo = signal({ version: '1.0', variantLabel: 'Prueba', updatesEnabled: false });
  const autoCheck = signal<boolean | null>(null);
  const updateState = signal('disabled');

  beforeEach(async () => {
    appearance.set(DEFAULT_APPEARANCE);
    updateInfo.set({ version: '1.0', variantLabel: 'Prueba', updatesEnabled: false });
    autoCheck.set(null);
    updateState.set('disabled');
    save.mockClear();
    await TestBed.configureTestingModule({
      imports: [SettingsDialog],
      providers: [
        {
          provide: ThemeService,
          useValue: {
            appearance,
            theme: computed(() => appearance().theme),
            update: async (patch: object) => appearance.update((value) => ({ ...value, ...patch })),
          },
        },
        {
          provide: UpdateService,
          useValue: {
            initialize: async () => undefined,
            info: updateInfo,
            state: updateState,
            autoCheck,
          },
        },
        {
          provide: ApplicationGateway,
          useValue: { getDiagnostics: () => of(new Blob(['prueba'])) },
        },
        { provide: FileSaveService, useValue: { save } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SettingsDialog);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  function tab(name: string): HTMLButtonElement {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (item) => item.textContent?.trim() === name,
    )!;
  }

  it('abre Apariencia y oculta del recorrido las otras secciones', () => {
    expect(tab('Apariencia').getAttribute('aria-selected')).toBe('true');
    expect(element.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    expect(element.querySelector('#settings-panel-editor')?.hasAttribute('hidden')).toBe(true);
    expect(element.querySelector('#settings-panel-about')?.hasAttribute('hidden')).toBe(true);
  });

  it('las flechas e Inicio/Fin cambian de sección y llevan el foco a su pestaña', () => {
    tab('Apariencia').focus();
    tab('Apariencia').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();
    expect(document.activeElement).toBe(tab('Editor'));
    expect(tab('Editor').tabIndex).toBe(0);
    expect(tab('Apariencia').tabIndex).toBe(-1);
    tab('Editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(tab('Acerca de'));
    tab('Acerca de').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(tab('Apariencia'));
  });

  it('cambiar de sección conserva el tamaño de letra elegido', () => {
    tab('Editor').click();
    fixture.detectChanges();
    const size = Array.from(
      element.querySelectorAll<HTMLButtonElement>('#settings-panel-editor .choice__item'),
    ).find((button) => button.textContent?.trim() === '16')!;
    size.click();
    tab('Apariencia').click();
    tab('Editor').click();
    fixture.detectChanges();
    expect(size.getAttribute('aria-pressed')).toBe('true');
    expect(appearance().editorFontSize).toBe(16);
  });

  /** Lo que enseña la pestaña cuando la copia sí puede actualizarse sola. */
  function casillaDeActualizaciones(): HTMLInputElement | null {
    return element.querySelector<HTMLInputElement>('#settings-panel-about .checkbox input');
  }

  it('sin poder actualizarse, no ofrece una casilla que no haría nada', () => {
    tab('Acerca de').click();
    fixture.detectChanges();

    expect(casillaDeActualizaciones()).toBeNull();
  });

  it('mientras nadie haya elegido, la casilla aparece sin marcar', () => {
    updateInfo.set({ version: '1.0', variantLabel: 'Prueba', updatesEnabled: true });
    updateState.set('undecided');
    tab('Acerca de').click();
    fixture.detectChanges();

    expect(casillaDeActualizaciones()?.checked).toBe(false);
    expect(element.querySelector('#settings-panel-about')?.textContent).toContain(
      'Druse no ha consultado nada',
    );
  });

  it('marcarla avisa al área de trabajo, que es quien lo recuerda', () => {
    updateInfo.set({ version: '1.0', variantLabel: 'Prueba', updatesEnabled: true });
    tab('Acerca de').click();
    fixture.detectChanges();

    const elegido: boolean[] = [];
    fixture.componentInstance.autoUpdateCheckChange.subscribe((value) => elegido.push(value));

    const casilla = casillaDeActualizaciones()!;
    casilla.checked = true;
    casilla.dispatchEvent(new Event('change'));

    expect(elegido).toEqual([true]);
  });

  it('lo ya autorizado se enseña marcado', () => {
    updateInfo.set({ version: '1.0', variantLabel: 'Prueba', updatesEnabled: true });
    autoCheck.set(true);
    updateState.set('current');
    tab('Acerca de').click();
    fixture.detectChanges();

    expect(casillaDeActualizaciones()?.checked).toBe(true);
  });

  it('Acerca de mantiene accesible el diagnóstico y confirma dónde se guardó', async () => {
    tab('Acerca de').click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.diagnostics button')!.click();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledOnce();
    expect(element.querySelector('#settings-panel-about')?.textContent).toContain(
      'Guardado en prueba.zip',
    );
  });
});
