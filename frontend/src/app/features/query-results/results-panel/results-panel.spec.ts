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
