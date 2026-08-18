import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OperationProgress } from './operation-progress';

describe('OperationProgress', () => {
  let fixture: ComponentFixture<OperationProgress>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OperationProgress] }).compileComponents();

    fixture = TestBed.createComponent(OperationProgress);
    element = fixture.nativeElement as HTMLElement;
  });

  /** Deja las entradas puestas y pinta. */
  function pintar(inputs: Record<string, unknown>): void {
    for (const [nombre, valor] of Object.entries(inputs)) {
      fixture.componentRef.setInput(nombre, valor);
    }

    fixture.detectChanges();
  }

  function barras(): HTMLElement[] {
    return [...element.querySelectorAll<HTMLElement>('.bar')];
  }

  it('enseña el paso y el objeto en curso, no solo un porcentaje', () => {
    pintar({ step: 'Escribiendo datos', subject: 'public.pedidos', done: 3, total: 10 });

    expect(element.querySelector('.step')?.textContent).toContain('Escribiendo datos');
    expect(element.querySelector('.subject')?.textContent).toContain('public.pedidos');
  });

  it('el avance global se anuncia en la barra accesible', () => {
    pintar({ overall: 0.42, done: 42, total: 100 });

    expect(barras()[0].getAttribute('aria-valuenow')).toBe('42');
    expect(barras()[0].classList).not.toContain('is-indeterminate');
  });

  it('sin total conocido la barra va indeterminada en vez de inventarse un tanto', () => {
    pintar({ overall: null });

    expect(barras()[0].classList).toContain('is-indeterminate');
    expect(barras()[0].getAttribute('aria-valuenow')).toBeNull();
  });

  it('un avance fuera de rango se recorta en lugar de desbordar la barra', () => {
    pintar({ overall: 1.4 });

    expect(barras()[0].getAttribute('aria-valuenow')).toBe('100');

    pintar({ overall: -0.2 });

    expect(barras()[0].getAttribute('aria-valuenow')).toBe('0');
  });

  it('las filas llevan la virgulilla que avisa de que el total es una estimación', () => {
    pintar({ rowsDone: 1500, rowsEstimated: 12000 });

    expect(element.querySelector('.rows')?.textContent).toContain('de ~12.000 filas');
  });

  /**
   * El caso que justifica la segunda barra: una tabla sin estimación fiable
   * escribiendo filas. Ni se enseña un porcentaje falso ni se deja el hueco.
   */
  it('escribiendo sin estimación se cuenta lo escrito y la barra del objeto recorre', () => {
    pintar({ rowsDone: 800_000, rowsEstimated: null });

    expect(element.querySelector('.rows')?.textContent).toContain('800.000 filas escritas');
    expect(barras()).toHaveLength(2);
    expect(barras()[1].classList).toContain('is-indeterminate');
  });

  it('sin filas todavía no aparece la barra del objeto', () => {
    pintar({ rowsDone: 0, rowsEstimated: null, done: 1, total: 4 });

    expect(barras()).toHaveLength(1);
    expect(element.querySelector('.numbers')?.textContent).toContain('1 de 4 objetos');
  });

  it('el tiempo pasa de segundos a minutos cuando toca', () => {
    pintar({ elapsedMs: 45_000 });

    expect(element.querySelector('.elapsed')?.textContent).toContain('45 s');

    pintar({ elapsedMs: 185_000 });

    expect(element.querySelector('.elapsed')?.textContent).toContain('3 min 5 s');
  });

  it('cancelar avisa a quien lo alojó, y se puede quitar', () => {
    const avisos: number[] = [];

    fixture.componentInstance.cancelRequested.subscribe(() => avisos.push(1));
    pintar({ cancellable: true });

    element.querySelector<HTMLButtonElement>('.cancel')?.click();

    expect(avisos).toHaveLength(1);

    pintar({ cancellable: false });

    expect(element.querySelector('.cancel')).toBeNull();
  });
});
