import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ResultSet } from '../../../shared/models/workspace';
import { ResultsGrid } from './results-grid';

const resultSet: ResultSet = {
  durationMs: 12,
  totalRows: 2,
  columns: [
    { name: 'id', dataType: 'int8', kind: 'number', width: 80 },
    { name: 'email', dataType: 'text', kind: 'text', width: 200 },
    { name: 'is_active', dataType: 'bool', kind: 'boolean', width: null },
  ],
  rows: [
    { number: 1, values: ['1', 'ana@example.com', 'true'] },
    { number: 2, values: ['2', null, 'false'] },
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

  it('pinta una fila por resultado y las numera', () => {
    const numbers = [...element.querySelectorAll('.cell--number')].map((cell) =>
      cell.textContent?.trim(),
    );

    expect(numbers).toEqual(['1', '2']);
  });

  it('avisa cuando la consulta no devuelve filas', async () => {
    fixture.componentRef.setInput('resultSet', { ...resultSet, rows: [], totalRows: 0 });
    await fixture.whenStable();

    expect(element.querySelector('.empty')?.textContent).toContain('no devolvió filas');
  });
});
