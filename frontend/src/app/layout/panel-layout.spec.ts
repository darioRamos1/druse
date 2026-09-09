import { resultPanelLayout } from './panel-layout';

describe('Distribución de resultados', () => {
  it('reserva más espacio para escribir al iniciar en una ventana pequeña', () => {
    expect(resultPanelLayout(450, null).height).toBe(171);
    expect(resultPanelLayout(900, null).height).toBe(322);
  });

  it('limita el arrastre para conservar al menos 160 px de editor cuando caben', () => {
    const layout = resultPanelLayout(450, 700);
    expect(layout.height).toBe(290);
    expect(450 - layout.height).toBe(160);
  });

  it('recupera el tamaño elegido cuando la ventana vuelve a tener espacio', () => {
    expect(resultPanelLayout(450, 400).height).toBe(290);
    expect(resultPanelLayout(800, 400).height).toBe(400);
  });

  it('las ventanas muy bajas no desbordan por los mínimos de los paneles', () => {
    for (const space of [0, 80, 180, 260]) {
      const layout = resultPanelLayout(space, 700);
      expect(layout.height).toBeGreaterThanOrEqual(0);
      expect(layout.height).toBeLessThanOrEqual(space);
      expect(layout.min).toBeLessThanOrEqual(layout.max);
    }
  });
});
