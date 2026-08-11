import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ResultSet } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';

/** Ancho de la columna del número de fila. */
const ROW_NUMBER_WIDTH = 44;

/**
 * Cuadrícula de resultados.
 *
 * Implementación de la Fase 1: una rejilla CSS con las pocas filas simuladas del
 * mockup. No virtualiza ni permite redimensionar columnas.
 *
 * Está aislada del panel que la contiene precisamente para poder sustituirla
 * cuando se decida la cuadrícula definitiva (bitácora D-08) sin tocar las
 * pestañas, la barra de acciones ni el pie.
 */
@Component({
  selector: 'app-results-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './results-grid.html',
  styleUrl: './results-grid.scss',
})
export class ResultsGrid {
  readonly resultSet = input.required<ResultSet>();

  /**
   * Plantilla de columnas de la rejilla. La última lleva `1fr` para absorber el
   * espacio sobrante, igual que en el mockup.
   */
  protected readonly gridTemplate = computed(() => {
    const columns = this.resultSet().columns.map((column) =>
      column.width === null ? '1fr' : `${column.width}px`,
    );

    return [`${ROW_NUMBER_WIDTH}px`, ...columns].join(' ');
  });
}
