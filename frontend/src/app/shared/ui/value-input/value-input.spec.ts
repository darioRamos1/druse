import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InputKind } from '../../models/workspace';
import { ValueInput } from './value-input';

async function create(
  kind: InputKind,
  value = '',
): Promise<ComponentFixture<ValueInput>> {
  const fixture = TestBed.createComponent(ValueInput);

  fixture.componentRef.setInput('kind', kind);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('dataType', kind);
  fixture.detectChanges();

  return fixture;
}

function field(fixture: ComponentFixture<ValueInput>): HTMLInputElement {
  return fixture.nativeElement.querySelector('.field, .check input') as HTMLInputElement;
}

describe('ValueInput', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ValueInput] }).compileComponents();
  });

  it('una fecha se pide con un calendario', async () => {
    const fixture = await create('date');

    expect(field(fixture).type).toBe('date');
  });

  it('una marca de tiempo pide fecha y hora', async () => {
    const fixture = await create('datetime');

    expect(field(fixture).type).toBe('datetime-local');
  });

  it('un texto sigue siendo un campo de texto, sin botón de por medio', async () => {
    const fixture = await create('text');

    expect(field(fixture).type).toBe('text');
    expect(fixture.nativeElement.querySelector('.toggle')).toBeNull();
  });

  it('un booleano se marca en lugar de escribirse', async () => {
    const fixture = await create('boolean', 'true');
    const casilla = field(fixture);

    expect(casilla.type).toBe('checkbox');
    expect(casilla.checked).toBe(true);
  });

  it('marcar la casilla emite el valor que entiende el motor', async () => {
    const fixture = await create('boolean', 'false');
    const emitidos: string[] = [];

    fixture.componentInstance.valueChange.subscribe((value) => emitidos.push(value));

    const casilla = field(fixture);
    casilla.checked = true;
    casilla.dispatchEvent(new Event('change'));

    expect(emitidos).toEqual(['true']);
  });

  /**
   * Lo que evita que ayudar se convierta en estorbar: un valor no siempre es un
   * dato, y un calendario no sabe escribir `CURRENT_TIMESTAMP`.
   */
  it('se puede volver a texto libre para escribir una expresión', async () => {
    const fixture = await create('date');

    (fixture.nativeElement.querySelector('.toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(field(fixture).type).toBe('text');
  });

  /**
   * Un control de fecha que recibe algo que no sabe leer lo vacía sin avisar, y
   * eso sería borrar un valor al entrar a mirarlo.
   */
  it('un valor que el control no entiende se enseña como texto', async () => {
    const fixture = await create('date', 'CURRENT_DATE');

    expect(field(fixture).type).toBe('text');
    expect(field(fixture).value).toBe('CURRENT_DATE');
  });

  it('la fecha con hora en formato SQL llega al control con su T', async () => {
    const fixture = await create('datetime', '2026-08-16 10:30:00');

    // El control normaliza a minutos: lo que importa es que lo entiende, y no
    // que lo vacíe por culpa del espacio con el que SQL separa fecha y hora.
    expect(field(fixture).type).toBe('datetime-local');
    expect(field(fixture).value).toMatch(/^2026-08-16T10:30/);
  });

  /** Sin `step`, el selector se queda en minutos y la hora exacta no se puede elegir. */
  it('la fecha y hora deja elegir también los segundos', async () => {
    const fixture = await create('datetime');

    expect(field(fixture).getAttribute('step')).toBe('1');
  });

  it('una hora suelta también llega al segundo', async () => {
    const fixture = await create('time');

    expect(field(fixture).type).toBe('time');
    expect(field(fixture).getAttribute('step')).toBe('1');
  });

  it('un decimal admite cifras, no solo enteros', async () => {
    const fixture = await create('decimal');

    expect(field(fixture).getAttribute('step')).toBe('any');
  });

  it('un entero se pide con teclado numérico', async () => {
    const fixture = await create('integer', '42');

    expect(field(fixture).type).toBe('number');
  });

  it('escribir emite lo escrito', async () => {
    const fixture = await create('text');
    const emitidos: string[] = [];

    fixture.componentInstance.valueChange.subscribe((value) => emitidos.push(value));

    const input = field(fixture);
    input.value = 'Ana';
    input.dispatchEvent(new Event('input'));

    expect(emitidos).toEqual(['Ana']);
  });
});
