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

  it('ofrece comentar y descomentar las líneas seleccionadas', () => {
    let emitted = 0;
    fixture.componentRef.instance.toggleLineComment.subscribe(() => emitted++);

    [...element().querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent?.includes('Comentar'))
      ?.click();

    expect(emitted).toBe(1);
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

      options()
        .find((option) => option.textContent?.trim() === 'Tabular')
        ?.click();

      expect(cambios).toEqual([{ style: 'tabular' }]);
    });

    /**
     * El ancho y la sangría se ajustan juntos: cerrar el menú en cada clic
     * obligaría a abrirlo una vez por opción.
     */
    it('el menú sigue abierto tras elegir, para poder ajustar varias cosas', () => {
      openMenu();

      options()
        .find((option) => option.textContent?.trim() === '120')
        ?.click();
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

      element().querySelectorAll<HTMLButtonElement>('.context__option')[1]?.click();
      fixture.detectChanges();

      expect(elegidas).toEqual(['ventas_pruebas']);
      expect(element().querySelector('.context__menu')).toBeNull();
    });

    it('sin conexión no hay nada que elegir', () => {
      fixture.componentRef.setInput('databases', []);
      fixture.detectChanges();

      expect(element().querySelector<HTMLButtonElement>('.context .chip')?.disabled).toBe(true);
    });

    /** Un menú que se queda abierto tapando el editor no es un menú. */
    it('se cierra al pulsar fuera de la barra', () => {
      openChooser();
      expect(element().querySelector('.context__menu')).not.toBeNull();

      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      fixture.detectChanges();

      expect(element().querySelector('.context__menu')).toBeNull();
    });

    it('abrir uno cierra el otro, para que no se tapen', () => {
      openChooser();
      element().querySelector<HTMLButtonElement>('.btn--caret')?.click();
      fixture.detectChanges();

      expect(element().querySelector('.context__menu')).toBeNull();
      expect(element().querySelector('.format__menu')).not.toBeNull();
    });
  });

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('selección y documento completo mantienen acciones independientes', () => {
    const document = vi.fn();
    const selection = vi.fn();
    fixture.componentInstance.execute.subscribe(document);
    fixture.componentInstance.executeSelection.subscribe(selection);
    fixture.componentRef.setInput('hasSelection', true);
    fixture.detectChanges();
    const current = element().querySelector<HTMLButtonElement>('.current')!;
    expect(current.getAttribute('aria-label')).toBe('Ejecutar selección');
    current.click();
    expect(selection).toHaveBeenCalledTimes(1);
    expect(document).not.toHaveBeenCalled();
    element().querySelector<HTMLButtonElement>('.run')!.click();
    expect(document).toHaveBeenCalledTimes(1);
  });

  it('permite ajustar ambos límites sin ejecutar SQL y devuelve el foco con Escape', () => {
    const rows = vi.fn();
    const timeout = vi.fn();
    const execute = vi.fn();
    fixture.componentInstance.maxRowsChange.subscribe(rows);
    fixture.componentInstance.timeoutChange.subscribe(timeout);
    fixture.componentInstance.execute.subscribe(execute);
    const trigger = element().querySelector<HTMLButtonElement>('.limits > .chip')!;
    trigger.click();
    fixture.detectChanges();
    const fields = element().querySelectorAll<HTMLSelectElement>('.limits select');
    expect(fields[0].value).toBe('500');
    expect(fields[1].value).toBe('30');
    fields[0].value = '1000';
    fields[0].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    fields[1].value = '60';
    fields[1].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(rows).toHaveBeenCalledWith(1000);
    expect(timeout).toHaveBeenCalledWith(60);
    expect(execute).not.toHaveBeenCalled();
    expect(element().querySelector('.limits__menu')).not.toBeNull();
    fields[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(element().querySelector('.limits__menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('ofrece cancelar solo durante la ejecución y espera al cancelar', () => {
    const cancel = () =>
      element().querySelector<HTMLButtonElement>('[title="Cancela la consulta en curso"]');
    expect(cancel()).toBeNull();
    fixture.componentRef.setInput('running', true);
    fixture.detectChanges();
    expect(cancel()?.disabled).toBe(false);
    fixture.componentRef.setInput('canceling', true);
    fixture.detectChanges();
    expect(cancel()?.disabled).toBe(true);
    expect(cancel()?.textContent).toContain('Cancelando');
  });

  /**
   * Cambiar de conexión sin salir de la pestaña: el caso de mirar algo en
   * desarrollo y repetirlo en preproducción sin pegar el SQL en otro sitio.
   */
  describe('conexión de la pestaña', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('databases', ['ventas']);
      fixture.componentRef.setInput('database', 'ventas');
      fixture.componentRef.setInput('connectionId', 'dev');
      fixture.componentRef.setInput('connections', [
        { id: 'dev', name: 'Desarrollo', environment: 'development', open: true, readOnly: false },
        { id: 'pre', name: 'Preproducción', environment: 'staging', open: false, readOnly: false },
        { id: 'prod', name: 'Producción', environment: 'production', open: true, readOnly: true },
      ]);
      fixture.detectChanges();
    });

    function openChooser(): void {
      element().querySelector<HTMLButtonElement>('.context .chip')?.click();
      fixture.detectChanges();
    }

    function connectionOptions(): HTMLButtonElement[] {
      return [...element().querySelectorAll<HTMLButtonElement>('.context__option')].slice(0, 3);
    }

    it('el chip dice en qué conexión está, no solo la base', () => {
      expect(element().querySelector('.chip')?.textContent).toContain('Desarrollo');
    });

    /** Entre dos bases llamadas igual, el entorno es lo único que las distingue. */
    it('lista las conexiones con su entorno y marca la de la pestaña', () => {
      openChooser();

      const opciones = connectionOptions();

      expect(opciones[0].textContent).toContain('Desarrollo');
      expect(opciones[0].classList).toContain('is-selected');
      expect(opciones[1].textContent).toContain('staging');
      expect(opciones[1].textContent).toContain('sin abrir');
      expect(opciones[2].textContent).toContain('solo lectura');
    });

    it('elegir otra conexión la emite y cierra el menú', () => {
      const elegidas: string[] = [];

      fixture.componentRef.instance.connectionChange.subscribe((id) => elegidas.push(id));

      openChooser();
      connectionOptions()[1].click();
      fixture.detectChanges();

      expect(elegidas).toEqual(['pre']);
      expect(element().querySelector('.context__menu')).toBeNull();
    });

    /** Volver a elegir la que ya está no debe reabrir sesión ni tirar el resultado. */
    it('elegir la que ya está no emite nada', () => {
      const elegidas: string[] = [];

      fixture.componentRef.instance.connectionChange.subscribe((id) => elegidas.push(id));

      openChooser();
      connectionOptions()[0].click();
      fixture.detectChanges();

      expect(elegidas).toEqual([]);
    });

    /** Producción se ve sin abrir el menú: es lo que frena el clic por costumbre. */
    it('avisa en el propio chip cuando la conexión es de producción', () => {
      fixture.componentRef.setInput('connectionId', 'prod');
      fixture.detectChanges();

      expect(element().querySelector('.chip')?.classList).toContain('chip--warn');
    });
  });
});
