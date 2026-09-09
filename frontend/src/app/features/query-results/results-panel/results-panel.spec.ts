import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ResultsPanel } from './results-panel';

describe('ResultsPanel', () => {
  let fixture: ComponentFixture<ResultsPanel>;
  let element: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({ imports: [ResultsPanel] }).compileComponents();

    fixture = TestBed.createComponent(ResultsPanel);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('la primera sesión ofrece conectar y abrir SQL como acciones separadas', () => {
    const connect = vi.fn();
    const open = vi.fn();
    fixture.componentInstance.createConnection.subscribe(connect);
    fixture.componentInstance.openSql.subscribe(open);
    fixture.componentRef.setInput('firstSession', true);
    fixture.detectChanges();
    const actions = element.querySelectorAll<HTMLButtonElement>('.welcome button');
    actions[0].click();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    actions[1].click();
    expect(open).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('running', true);
    fixture.detectChanges();
    expect(element.querySelector('.welcome')).toBeNull();
  });

  it('muestra actividad, tiempo y cancelación mientras se ejecuta', () => {
    fixture.componentRef.setInput('running', true);
    fixture.componentRef.setInput('timeoutSeconds', 30);
    fixture.detectChanges();

    expect(element.querySelector('.query-progress')).not.toBeNull();
    expect(element.textContent).toContain('Ejecutando consulta');
    expect(element.textContent).toContain('Límite configurado: 30 s');
    expect(element.querySelector('.bar')?.classList).toContain('is-indeterminate');
    expect(element.querySelector<HTMLButtonElement>('.cancel')).not.toBeNull();
  });

  it('avisa cuando la consulta tarda más de lo habitual', () => {
    fixture.componentRef.setInput('running', true);
    fixture.detectChanges();

    vi.advanceTimersByTime(10_250);
    fixture.detectChanges();

    expect(element.textContent).toContain('sigue procesando');
    expect(element.textContent).toContain('más de lo habitual');
    expect(element.querySelector('.elapsed')?.textContent).toContain('10 s');
  });

  it('emite una sola cancelación y refleja que ya fue solicitada', () => {
    let requests = 0;
    fixture.componentInstance.cancelQuery.subscribe(() => requests++);
    fixture.componentRef.setInput('running', true);
    fixture.detectChanges();

    element.querySelector<HTMLButtonElement>('.cancel')?.click();
    expect(requests).toBe(1);

    fixture.componentRef.setInput('canceling', true);
    fixture.detectChanges();

    expect(element.textContent).toContain('Cancelando consulta');
    expect(element.textContent).toContain('La cancelación ya fue enviada');
    expect(element.querySelector('.cancel')).toBeNull();
  });

  it('vuelve al contenido normal al terminar', () => {
    fixture.componentRef.setInput('running', true);
    fixture.detectChanges();
    fixture.componentRef.setInput('running', false);
    fixture.detectChanges();

    expect(element.querySelector('.query-progress')).toBeNull();
    expect(element.textContent).toContain('Los resultados aparecerán aquí');
  });

  /**
   * El botón de copiar depende de lo que haya seleccionado en la cuadrícula.
   *
   * La selección vive dentro de `ResultsGrid` —nace y muere con cada resultado—
   * y el panel se la pregunta. Estas pruebas cubren esa unión, que es lo único
   * que el panel pone de su parte.
   */
  describe('copiar la selección', () => {
    const resultSet = {
      durationMs: 4,
      totalRows: 2,
      truncated: false,
      columns: [
        { name: 'id', dataType: 'int8', kind: 'number' as const, width: 80 },
        { name: 'pais', dataType: 'text', kind: 'text' as const, width: null },
      ],
      rows: [
        { number: 1, values: ['1', 'MX'] },
        { number: 2, values: ['2', 'ES'] },
      ],
    };

    function copyButton(): HTMLButtonElement {
      return [...element.querySelectorAll<HTMLButtonElement>('.tool-button')].find((button) =>
        button.textContent?.includes('Copiar como'),
      )!;
    }

    beforeEach(() => {
      fixture.componentRef.setInput('resultSet', resultSet);
      fixture.detectChanges();
    });

    function filtersButton(): HTMLButtonElement {
      return Array.from(element.querySelectorAll<HTMLButtonElement>('.tool-button')).find(
        (button) => button.textContent?.includes('Filtros'),
      )!;
    }

    function filter(term: string): void {
      const input = element.querySelector<HTMLInputElement>('[aria-label="Filtrar pais"]')!;
      input.value = term;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('cuenta las coincidencias locales y mantiene el aviso al ocultar los campos', () => {
      filtersButton().click();
      fixture.detectChanges();
      filter('mx');
      expect(element.querySelector('.filter-scope')?.textContent).toContain(
        '1 de 2 filas cargadas',
      );
      expect(element.querySelector('.pager__range')?.textContent).toContain('1 de 2 cargadas');
      filtersButton().click();
      fixture.detectChanges();
      expect(element.querySelector('.filters__input')).toBeNull();
      expect(element.querySelector('.filter-scope')?.textContent).toContain(
        'no se aplican al exportar',
      );
      element.querySelector<HTMLButtonElement>('.filter-scope button')!.click();
      fixture.detectChanges();
      expect(element.querySelectorAll('app-results-grid .row')).toHaveLength(2);
      expect(element.querySelector('.filter-scope')).toBeNull();
    });

    it('un filtro sin coincidencias muestra cero y una nueva ejecución limpia su alcance', () => {
      filtersButton().click();
      fixture.detectChanges();
      filter('ninguno');
      expect(element.querySelector('.filter-scope')?.textContent).toContain(
        '0 de 2 filas cargadas',
      );
      fixture.componentRef.setInput('resultSet', { ...resultSet });
      fixture.detectChanges();
      fixture.detectChanges();
      expect(element.querySelector('.filter-scope')?.textContent).toContain(
        'Filtra sobre las 2 filas cargadas',
      );
      expect(element.querySelector<HTMLInputElement>('[aria-label="Filtrar pais"]')?.value).toBe(
        '',
      );
    });

    it('el atajo abre Exportar aunque Copiar esté deshabilitado y solo exporta al elegir formato', () => {
      const exported = vi.fn();
      fixture.componentInstance.exportAs.subscribe(exported);
      expect(copyButton().disabled).toBe(true);
      fixture.componentInstance.openExportMenu();
      fixture.detectChanges();
      expect(element.querySelector('.export--copy [role="menu"]')).toBeNull();
      expect(element.querySelector('.export__scope')?.textContent).toContain(
        'Se volverá a ejecutar el SQL',
      );
      expect(exported).not.toHaveBeenCalled();
      element.querySelector<HTMLButtonElement>('.export--query [role="menuitem"]')!.click();
      expect(exported).toHaveBeenCalledExactlyOnceWith('csv');
    });

    it('las flechas recorren Exportar, Escape restaura foco y pulsar fuera lo cierra', () => {
      const trigger = element.querySelector<HTMLButtonElement>('.export--query .tool-button')!;
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      fixture.detectChanges();
      const options = element.querySelectorAll<HTMLButtonElement>(
        '.export--query [role="menuitem"]',
      );
      expect(document.activeElement).toBe(options[0]);
      options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      expect(document.activeElement).toBe(options[1]);
      options[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(document.activeElement).toBe(trigger);
      expect(element.querySelector('[role="menu"]')).toBeNull();
      trigger.click();
      fixture.detectChanges();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      fixture.detectChanges();
      expect(element.querySelector('[role="menu"]')).toBeNull();
    });

    it('los controles usan el conjunto elegido incluso sin el input de resultado único', () => {
      fixture.componentRef.setInput('resultSet', null);
      fixture.componentRef.setInput('result', {
        executionId: 'multi',
        state: 'succeeded',
        resultSets: [resultSet, { ...resultSet, rows: [] }],
        messages: [],
        durationMs: 4,
      });
      fixture.detectChanges();
      expect(filtersButton().disabled).toBe(false);
      element.querySelectorAll<HTMLButtonElement>('.sets__tab')[1].click();
      filtersButton().click();
      fixture.detectChanges();
      expect(element.querySelector('.filter-scope')?.textContent).toContain('0 filas cargadas');
    });

    it('no se puede pulsar mientras no hay nada seleccionado', () => {
      expect(copyButton().disabled).toBe(true);
      expect(copyButton().title).toContain('Selecciona columnas o celdas');
    });

    it('se habilita al seleccionar una columna y dice cuánto se lleva', () => {
      element
        .querySelectorAll<HTMLElement>('.cell--head')[1]
        .dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();

      expect(copyButton().disabled).toBe(false);
      // Importa decirlo: una columna se lleva todas las filas, no las visibles.
      expect(copyButton().textContent).toContain('1 columna × 2 filas');
    });

    it('el menú copia con el formato elegido', async () => {
      const copied: string[] = [];
      fixture.componentInstance.copied.subscribe((text) => copied.push(text));

      Object.assign(navigator, {
        clipboard: { writeText: (text: string) => Promise.resolve(text) },
      });

      element
        .querySelectorAll<HTMLElement>('.cell--head')[1]
        .dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();

      copyButton().click();
      fixture.detectChanges();

      const options = [...element.querySelectorAll<HTMLButtonElement>('.export__option')];
      options.find((option) => option.textContent?.includes('IN'))?.click();
      await vi.waitFor(() => expect(copied.length).toBe(1));

      expect(copied[0]).toBe("pais IN ('MX', 'ES')");
    });
  });
});
