import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditorToolbar } from './editor-toolbar';

describe('EditorToolbar', () => {
  let fixture: ComponentFixture<EditorToolbar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EditorToolbar] }).compileComponents();

    fixture = TestBed.createComponent(EditorToolbar);
    fixture.componentRef.setInput('context', 'ventas · public');
    fixture.componentRef.setInput('canExecute', true);
    fixture.detectChanges();
  });

  function open(scope = 'Preproducción', ddlIsReversible = true): void {
    fixture.componentRef.setInput('transactionOpen', true);
    fixture.componentRef.setInput('transactionScope', scope);
    fixture.componentRef.setInput('transactionDdlIsReversible', ddlIsReversible);
    fixture.detectChanges();
  }

  /**
   * El autocommit es lo normal: al modo manual se entra a propósito, y confirmar
   * o deshacer no significa nada mientras no haya una transacción abierta.
   */
  it('sin transacción abierta solo ofrece iniciarla', () => {
    expect(element().textContent).toContain('Iniciar transacción');
    expect(element().querySelector('.btn--commit')).toBeNull();
    expect(element().querySelector('.btn--rollback')).toBeNull();
  });

  it('sin conexión no deja iniciar ninguna', () => {
    fixture.componentRef.setInput('canExecute', false);
    fixture.detectChanges();

    const boton = [...element().querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      item.textContent?.includes('Iniciar transacción'),
    );

    expect(boton?.disabled).toBe(true);
  });

  /** El indicador dice a qué conexión afecta, que es lo que no se puede adivinar. */
  it('con transacción abierta enseña la conexión afectada y los dos botones', () => {
    open();

    expect(element().querySelector('.tx')?.textContent).toContain('Preproducción');
    expect(element().querySelector('.btn--commit')).not.toBeNull();
    expect(element().querySelector('.btn--rollback')).not.toBeNull();
    expect(element().textContent).not.toContain('Iniciar transacción');
  });

  it('avisa en el indicador cuando el motor no deshace el DDL', () => {
    open('MySQL local', false);

    expect(element().querySelector('.tx')?.getAttribute('title')).toContain(
      'queda hecho aunque pulses Rollback',
    );
  });

  it('mientras la operación está en curso, los botones esperan', () => {
    open();
    fixture.componentRef.setInput('transactionBusy', true);
    fixture.detectChanges();

    expect(element().querySelector<HTMLButtonElement>('.btn--commit')?.disabled).toBe(true);
    expect(element().querySelector<HTMLButtonElement>('.btn--rollback')?.disabled).toBe(true);
  });

  it('emite la intención de cada botón', () => {
    const emitidos: string[] = [];

    fixture.componentRef.instance.beginTransaction.subscribe(() => emitidos.push('begin'));
    fixture.componentRef.instance.commit.subscribe(() => emitidos.push('commit'));
    fixture.componentRef.instance.rollback.subscribe(() => emitidos.push('rollback'));

    [...element().querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent?.includes('Iniciar transacción'))
      ?.click();

    open();
    element().querySelector<HTMLButtonElement>('.btn--commit')?.click();
    element().querySelector<HTMLButtonElement>('.btn--rollback')?.click();

    expect(emitidos).toEqual(['begin', 'commit', 'rollback']);
  });

  describe('opciones de formateo', () => {
    function openMenu(): void {
      element().querySelector<HTMLButtonElement>('.btn--caret')?.click();
      fixture.detectChanges();
    }

    function options(): HTMLButtonElement[] {
      return [...element().querySelectorAll<HTMLButtonElement>('.format__option')];
    }

    /**
     * Formatear es la acción; elegir cómo, una configuración que se toca una
     * vez. Esconder la primera detrás de la segunda encarecería lo frecuente.
     */
    it('el menú está detrás de la flecha, no en el botón de formatear', () => {
      expect(element().querySelector('.format__menu')).toBeNull();

      element().querySelector<HTMLButtonElement>('.btn--split')?.click();
      fixture.detectChanges();

      expect(element().querySelector('.format__menu')).toBeNull();

      openMenu();

      expect(element().querySelector('.format__menu')).not.toBeNull();
    });

    it('marca lo que está en uso', () => {
      fixture.componentRef.setInput('formatSettings', {
        style: 'tabular',
        expressionWidth: 120,
        keywordCase: 'lower',
        indent: 'tabs',
      });
      openMenu();

      const elegidas = options()
        .filter((option) => option.classList.contains('is-selected'))
        .map((option) => option.textContent?.trim());

      expect(elegidas).toEqual(['Tabular', '120', 'minúsculas', 'Tabulaciones']);
    });

    it('emite solo el ajuste que se tocó', () => {
      const cambios: Partial<Record<string, unknown>>[] = [];

      fixture.componentRef.instance.formatSettingsChange.subscribe((change) =>
        cambios.push(change),
      );
      openMenu();

      options().find((option) => option.textContent?.trim() === 'Tabular')?.click();

      expect(cambios).toEqual([{ style: 'tabular' }]);
    });

    /**
     * El ancho y la sangría se ajustan juntos: cerrar el menú en cada clic
     * obligaría a abrirlo una vez por opción.
     */
    it('el menú sigue abierto tras elegir, para poder ajustar varias cosas', () => {
      openMenu();

      options().find((option) => option.textContent?.trim() === '120')?.click();
      fixture.detectChanges();

      expect(element().querySelector('.format__menu')).not.toBeNull();
    });
  });

  describe('base de la pestaña', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('databases', ['ventas', 'ventas_pruebas', 'auditoria']);
      fixture.componentRef.setInput('database', 'ventas');
      fixture.detectChanges();
    });

    function openChooser(): void {
      element().querySelector<HTMLButtonElement>('.context .chip')?.click();
      fixture.detectChanges();
    }

    it('ofrece las bases de la conexión y marca la que está en uso', () => {
      openChooser();

      const opciones = [...element().querySelectorAll<HTMLButtonElement>('.context__option')];

      expect(opciones.map((option) => option.textContent?.trim())).toEqual([
        'ventas',
        'ventas_pruebas',
        'auditoria',
      ]);
      expect(opciones[0].classList).toContain('is-selected');
    });

    /** Es lo que evita abrir un script por base. */
    it('elegir una base la emite y cierra el desplegable', () => {
      const elegidas: string[] = [];

      fixture.componentRef.instance.databaseChange.subscribe((name) => elegidas.push(name));
      openChooser();

      element()
        .querySelectorAll<HTMLButtonElement>('.context__option')[1]
        ?.click();
      fixture.detectChanges();

      expect(elegidas).toEqual(['ventas_pruebas']);
      expect(element().querySelector('.context__menu')).toBeNull();
    });

    it('sin conexión no hay nada que elegir', () => {
      fixture.componentRef.setInput('databases', []);
      fixture.detectChanges();

      expect(element().querySelector<HTMLButtonElement>('.context .chip')?.disabled).toBe(true);
    });
  });

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
});
