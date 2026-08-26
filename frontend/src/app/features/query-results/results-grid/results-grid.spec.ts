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

  it('añade resultados grandes al DOM en bloques manejables', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      number: index + 1,
      values: [String(index + 1), `persona${index + 1}@example.com`, 'true'],
    }));
    fixture.componentRef.setInput('resultSet', { ...resultSet, rows, totalRows: rows.length });
    await fixture.whenStable();

    expect(element.querySelectorAll('.row').length).toBe(500);
    expect(element.querySelector('.more')?.textContent).toContain('Mostrando 500 de 501');

    element.querySelector<HTMLButtonElement>('.more button')?.click();
    await fixture.whenStable();

    expect(element.querySelectorAll('.row').length).toBe(501);
  });

  it('pone la elipsis en un elemento que puede encogerse dentro de la celda', () => {
    const text = element.querySelector<HTMLElement>('.cell__text');
    const style = getComputedStyle(text!);

    expect(style.minWidth).toBe('0px');
    expect(style.overflow).toBe('hidden');
    expect(style.textOverflow).toBe('ellipsis');
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

    it('copia el valor pendiente que se muestra en una celda editada', async () => {
      fixture.componentRef.setInput('pendingEdits', [
        { row: 1, column: 'email', value: 'nuevo@example.com' },
      ]);
      await fixture.whenStable();

      const cell = element.querySelectorAll<HTMLElement>('.cell--value')[1];
      cell.dispatchEvent(new MouseEvent('dblclick'));
      await fixture.whenStable();

      expect(copied).toEqual(['nuevo@example.com']);
    });
  });

  describe('seleccionar y copiar con formato', () => {
    let copied: string[];

    /** Celda por posición, que es como se leen en la rejilla. */
    function cell(row: number, column: number): HTMLElement {
      return element.querySelectorAll<HTMLElement>('.cell--value')[row * 3 + column];
    }

    function header(column: number): HTMLElement {
      return element.querySelectorAll<HTMLElement>('.cell--head')[column];
    }

    function selectedCount(): number {
      return element.querySelectorAll('.cell--value.is-selected').length;
    }

    beforeEach(() => {
      copied = [];
      fixture.componentInstance.copied.subscribe((text) => copied.push(text));

      Object.assign(navigator, {
        clipboard: { writeText: (text: string) => Promise.resolve(text) },
      });
    });

    it('la cabecera selecciona la columna entera', async () => {
      header(1).dispatchEvent(new MouseEvent('click'));
      await fixture.whenStable();

      // Una celda por fila, y ninguna de las otras dos columnas.
      expect(selectedCount()).toBe(3);
      expect(header(1).classList.contains('is-selected')).toBe(true);
    });

    it('control añade y quita columnas sueltas', async () => {
      header(0).dispatchEvent(new MouseEvent('click'));
      header(2).dispatchEvent(new MouseEvent('click', { ctrlKey: true }));
      await fixture.whenStable();

      expect(selectedCount()).toBe(6);

      header(2).dispatchEvent(new MouseEvent('click', { ctrlKey: true }));
      await fixture.whenStable();

      expect(selectedCount()).toBe(3);
    });

    it('mayúsculas coge el tramo entre dos cabeceras', async () => {
      header(0).dispatchEvent(new MouseEvent('click'));
      header(2).dispatchEvent(new MouseEvent('click', { shiftKey: true }));
      await fixture.whenStable();

      expect(selectedCount()).toBe(9);
    });

    it('arrastrar por las celdas coge un rectángulo', async () => {
      cell(0, 0).dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      cell(1, 1).dispatchEvent(new MouseEvent('mouseenter', { buttons: 1 }));
      await fixture.whenStable();

      // Dos filas por dos columnas: la esquina de llegada entra en la selección.
      expect(selectedCount()).toBe(4);
    });

    it('el rectángulo deja de crecer al soltar el botón', async () => {
      cell(0, 0).dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup'));
      cell(2, 2).dispatchEvent(new MouseEvent('mouseenter', { buttons: 1 }));
      await fixture.whenStable();

      expect(selectedCount()).toBe(1);
    });

    it('mayúsculas estira la selección hasta la celda pulsada', async () => {
      cell(0, 0).dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup'));
      cell(2, 1).dispatchEvent(new MouseEvent('mousedown', { button: 0, shiftKey: true }));
      await fixture.whenStable();

      expect(selectedCount()).toBe(6);
    });

    it('copia una columna como condición IN', async () => {
      header(0).dispatchEvent(new MouseEvent('click'));
      await fixture.whenStable();

      await fixture.componentInstance.copyAs('where-in');

      // Columna numérica: sin comillas y sin repetir el nombre en cada valor.
      expect(copied).toEqual(['id IN (1, 2, 3)']);
    });

    it('copia dos columnas para una hoja de cálculo', async () => {
      header(0).dispatchEvent(new MouseEvent('click'));
      header(1).dispatchEvent(new MouseEvent('click', { ctrlKey: true }));
      await fixture.whenStable();

      await fixture.componentInstance.copyAs('excel');

      expect(copied).toEqual(['id\temail\n1\tana@example.com\n2\t\n3\tluis@otro.com']);
    });

    it('una columna se lleva las filas que el filtro deja, no las de la pantalla', async () => {
      fixture.componentRef.setInput('showFilters', true);
      await fixture.whenStable();

      const input = element.querySelectorAll<HTMLInputElement>('.filters__input')[1];
      input.value = '.com';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      header(1).dispatchEvent(new MouseEvent('click'));
      await fixture.whenStable();

      await fixture.componentInstance.copyAs('where-in');

      // La fila del nulo queda fuera porque el filtro ya la había quitado.
      expect(copied).toEqual(["email IN ('ana@example.com', 'luis@otro.com')"]);
    });

    it('copia el rectángulo seleccionado y no la columna entera', async () => {
      cell(0, 1).dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      cell(1, 1).dispatchEvent(new MouseEvent('mouseenter', { buttons: 1 }));
      await fixture.whenStable();

      await fixture.componentInstance.copyAs('where-in');

      // El nulo de la segunda fila sale aparte: dentro del IN no lo encontraría.
      expect(copied).toEqual(["(email IN ('ana@example.com') OR email IS NULL)"]);
    });

    it('ctrl+c copia una sola celda sin encabezado', async () => {
      cell(0, 1).dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      await fixture.whenStable();

      cell(0, 1).dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
      await fixture.whenStable();

      expect(copied).toEqual(['ana@example.com']);
    });

    it('ctrl+c sobre un bloque lo copia con los nombres arriba', async () => {
      cell(0, 0).dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      cell(1, 0).dispatchEvent(new MouseEvent('mouseenter', { buttons: 1 }));
      await fixture.whenStable();

      cell(1, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
      await fixture.whenStable();

      expect(copied).toEqual(['id\n1\n2']);
    });

    it('el botón derecho fuera de lo marcado se lleva la selección consigo', async () => {
      header(0).dispatchEvent(new MouseEvent('click'));
      await fixture.whenStable();

      cell(2, 2).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      await fixture.whenStable();

      expect(element.querySelector('.copy-menu')).not.toBeNull();
      // Ya no es la columna: es la celda sobre la que se pulsó.
      expect(selectedCount()).toBe(1);
      expect(cell(2, 2).classList.contains('is-selected')).toBe(true);
    });

    it('el menú se cierra al pulsar en cualquier otro sitio', async () => {
      cell(0, 0).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      await fixture.whenStable();

      document.dispatchEvent(new MouseEvent('click'));
      await fixture.whenStable();

      expect(element.querySelector('.copy-menu')).toBeNull();
    });

    it('un resultado nuevo llega sin nada seleccionado', async () => {
      header(0).dispatchEvent(new MouseEvent('click'));
      await fixture.whenStable();

      expect(fixture.componentInstance.hasSelection()).toBe(true);

      fixture.componentRef.setInput('resultSet', { ...resultSet, totalRows: 3 });
      await fixture.whenStable();

      expect(fixture.componentInstance.hasSelection()).toBe(false);
    });
  });

  describe('ajustar el ancho de las columnas', () => {
    /** El asa que hay en el borde derecho de cada cabecera. */
    function handle(column: number): HTMLElement {
      return element.querySelectorAll<HTMLElement>('.cell__resize')[column];
    }

    /** Los anchos que la rejilla está aplicando ahora mismo. */
    function template(): string {
      return element.querySelector<HTMLElement>('.head')!.style.gridTemplateColumns;
    }

    /** Arrastra el asa de una columna los píxeles indicados. */
    async function arrastrar(column: number, pixeles: number): Promise<void> {
      handle(column).dispatchEvent(new MouseEvent('mousedown', { clientX: 200, bubbles: true }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 + pixeles }));
      document.dispatchEvent(new MouseEvent('mouseup'));
      await fixture.whenStable();
    }

    it('arrastrar el borde cambia el ancho de esa columna', async () => {
      expect(template()).toBe('44px 80px 200px 1fr');

      await arrastrar(0, 60);

      // Solo la primera: las demás se quedan como estaban.
      expect(template()).toBe('44px 140px 200px 1fr');
    });

    it('arrastrar hacia la izquierda estrecha, pero no por debajo del mínimo', async () => {
      await arrastrar(0, -500);

      // 84 px es el mismo suelo que usa el reparto inicial.
      expect(template()).toBe('44px 84px 200px 1fr');
    });

    it('arrastrar el asa no selecciona la columna', async () => {
      await arrastrar(1, 30);

      expect(fixture.componentInstance.hasSelection()).toBe(false);
    });

    it('la última columna deja de estirarse en cuanto se ajusta', async () => {
      await arrastrar(2, 40);

      // Tenía `1fr` para absorber el sobrante; ahora vale lo que se le puso.
      expect(template()).not.toContain('1fr');
    });

    it('el doble clic ajusta la columna a lo que contiene', async () => {
      handle(1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await fixture.whenStable();

      // `ana@example.com` son 15 caracteres de fuente monoespaciada más el aire
      // de la celda: más que el título, así que manda el contenido.
      expect(template()).toBe('44px 80px 134px 1fr');
    });

    it('el doble clic sobre una columna estrecha deja sitio al título', async () => {
      // `is_active` es más largo que `true`, así que aquí manda la cabecera.
      handle(2).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await fixture.whenStable();

      const ancho = Number(template().split(' ')[3].replace('px', ''));

      expect(ancho).toBeGreaterThanOrEqual(84);
      expect(ancho).toBeLessThan(140);
    });

    it('el ancho ajustado sobrevive a volver a ejecutar la misma consulta', async () => {
      await arrastrar(0, 60);

      fixture.componentRef.setInput('resultSet', {
        ...resultSet,
        rows: [{ number: 1, values: ['9', 'otra@example.com', 'false'] }],
      });
      await fixture.whenStable();

      expect(template()).toBe('44px 140px 200px 1fr');
    });

    it('se olvida cuando el resultado trae otras columnas', async () => {
      await arrastrar(0, 60);

      fixture.componentRef.setInput('resultSet', {
        ...resultSet,
        columns: [{ name: 'otra', dataType: 'text', kind: 'text' as const, width: 120 }],
        rows: [{ number: 1, values: ['x'] }],
      });
      await fixture.whenStable();

      expect(template()).toBe('44px 120px');
    });
  });
});
