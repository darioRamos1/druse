import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { ResultSet } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { ResultsGrid } from '../results-grid/results-grid';

type ResultsTab = 'results' | 'messages' | 'plan' | 'history';

/**
 * Panel inferior: resultados, mensajes, plan de ejecución e historial.
 *
 * Solo se ocupa de las pestañas, las acciones y el pie. La presentación de las
 * filas vive en `ResultsGrid`.
 */
@Component({
  selector: 'app-results-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ResultsGrid],
  templateUrl: './results-panel.html',
  styleUrl: './results-panel.scss',
})
export class ResultsPanel {
  readonly resultSet = input.required<ResultSet>();
  readonly pageSize = input(100);

  protected readonly activeTab = signal<ResultsTab>('results');

  protected readonly hasFilters = computed(() =>
    this.resultSet().columns.some((column) => !!column.filter),
  );

  protected readonly rangeLabel = computed(() => {
    const { rows, totalRows } = this.resultSet();

    if (rows.length === 0) {
      return 'Sin filas';
    }

    return `1–${rows.length} de ${totalRows.toLocaleString('es')}`;
  });

  protected select(tab: ResultsTab): void {
    this.activeTab.set(tab);
  }
}
