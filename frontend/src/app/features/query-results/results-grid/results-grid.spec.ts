import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ResultSet } from '../../../shared/models/workspace';
import { ResultsGrid } from './results-grid';

const resultSet: ResultSet = {
  durationMs: 12,
  totalRows: 3,
  truncated: false,
  columns: [
    { name: 'id', dataType: 'int8', kind: 'number', width: 80 },
    { name: 'email', dataType: 'text', kind: 'text', width: 200 },
    { name: 'is_active', dataType: 'bool', kind: 'boolean', width: null },
  ],
  rows: [
    { number: 1, values: ['1', 'ana@example.com', 'true'] },
    { number: 2, values: ['2', null, 'false'] },
    { number: 3, values: ['3', 'luis@otro.com', 'true'] },
  ],
};

describe('ResultsGrid', () => {
  let fixture: ComponentFixture<ResultsGrid>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ResultsGrid] }).compileComponents();

    fixture = TestBed.createComponent(ResultsGrid);
    fixture.componentRef.setInput('resultSet', resultSet);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('muestra el nombre y el tipo de cada columna', () => {
    const headers = element.querySelectorAll('.cell--head');

    expect(headers.length).toBe(3);
    expect(headers[0].textContent).toContain('id');
    expect(headers[0].textContent).toContain('int8');
    expect(headers[2].textContent).toContain('bool');
  });

  it('distingue los nulos de la cadena vacía', () => {
    const nulls = element.querySelectorAll('.null');

    expect(nulls.length).toBe(1);
    expect(nulls[0].textContent?.trim()).toBe('NULL');
  });

  it('reserva la última columna para el espacio sobrante', () => {
    const header = element.querySelector<HTMLElement>('.head');

    // 44px del número de fila, los anchos declarados y 1fr al final.
    expect(header?.style.gridTemplateColumns).toBe('44px 80px 200px 1fr');
  });

  /**
   * La cabecera tiene que desplazarse con sus columnas.
   *
   * Fuera del contenedor con scroll, moverse a la derecha desplazaba las filas y
   * dejaba los títulos quietos, así que cada uno acababa sobre la columna
   * equivocada. Dentro, `sticky` con solo `top` se queda al bajar y acompaña al
   * ir a los lados.
   */
  it('mantiene cabecera y filtros dentro del área que se desplaza', async () => {
    fixture.componentRef.setInput('showFilters', true);
    await fixture.whenStable();

    const scrollable = element.querySelector<HTMLElement>('.body');

    expect(scrollable?.querySelector('.head')).not.toBeNull();
    expect(scrollable?.querySelector('.filters')).not.toBeNull();
  });

  it('pinta una fila por resultado y las numera', () => {
    const numbers = [...element.querySelectorAll('.cell--number')].map((cell) =>
      cell.textContent?.trim(),
    );

    expect(numbers).toEqual(['1', '2', '3']);
  });

  it('avisa cuando la consulta no devuelve filas', async () => {
    fixture.componentRef.setInput('resultSet', { ...resultSet, rows: [], totalRows: 0 });
    await fixture.whenStable();

    expect(element.querySelector('.empty')?.textContent).toContain('no devolvió filas');
  });

  describe('filtros locales', () => {
    beforeEach(async () => {
      fixture.componentRef.setInput('showFilters', true);
      await fixture.whenStable();
    });

    it('la fila de filtros solo aparece cuando se pide', async () => {
      expect(element.querySelectorAll('.filters__input').length).toBe(3);

      fixture.componentRef.setInput('showFilters', false);
      await fixture.whenStable();

      expect(element.querySelectorAll('.filters__input').length).toBe(0);
    });

    it('filtra las filas por el texto de una columna', async () => {
      const input = element.querySelectorAll<HTMLInputElement>('.filters__input')[1];

      input.value = 'ana';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(element.querySelectorAll('.row').length).toBe(1);
    });

    it('el filtro no distingue mayúsculas', async () => {
      const input = element.querySelectorAll<HTMLInputElement>('.filters__input')[1];

      input.value = 'ANA';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(element.querySelectorAll('.row').length).toBe(1);
    });

    it('combina los filtros de varias columnas', async () => {
      const inputs = element.querySelectorAll<HTMLInputElement>('.filters__input');

      inputs[1].value = '.com';
      inputs[1].dispatchEvent(new Event('input'));
      inputs[2].value = 'true';
      inputs[2].dispatchEvent(new Event('input'));
      await fixture.whenStable();

      // Solo las activas con correo: la fila del nulo queda fuera.
      expect(element.querySelectorAll('.row').length).toBe(2);
    });

    it('avisa cuando ninguna fila coincide', async () => {
      const input = element.querySelectorAll<HTMLInputElement>('.filters__input')[1];

      input.value = 'no-existe';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      // Distinto de «no devolvió filas»: aquí hay datos, los esconde el filtro.
      expect(element.querySelector('.empty')?.textContent).toContain('coincide con los filtros');
    });
  });

  describe('copiar', () => {
    let copied: string[];

    beforeEach(() => {
      copied = [];
      fixture.componentInstance.copied.subscribe((text) => copied.push(text));

      Object.assign(navigator, {
        clipboard: { writeText: (text: string) => Promise.resolve(text) },
      });
    });

    it('copia una celda al hacer doble clic', async () => {
      const cell = element.querySelectorAll<HTMLElement>('.cell--value')[1];

      cell.dispatchEvent(new MouseEvent('dblclick'));
      await fixture.whenStable();

      expect(copied).toEqual(['ana@example.com']);
    });

    it('copia la fila entera separada por tabuladores', async () => {
      const number = element.querySelectorAll<HTMLElement>('.cell--number')[0];

      number.dispatchEvent(new MouseEvent('dblclick'));
      await fixture.whenStable();

      // Tabuladores para poder pegarlo en una hoja de cálculo.
      expect(copied).toEqual(['1\tana@example.com\ttrue']);
    });

    it('copia los encabezados', async () => {
      element.querySelector<HTMLButtonElement>('.copy-all')?.click();
      await fixture.whenStable();

      expect(copied).toEqual(['id\temail\tis_active']);
    });

    it('un nulo se copia como texto vacío', async () => {
      const cell = element.querySelectorAll<HTMLElement>('.cell--value')[4];

      cell.dispatchEvent(new MouseEvent('dblclick'));
      await fixture.whenStable();

      expect(copied).toEqual(['']);
    });
  });
});
