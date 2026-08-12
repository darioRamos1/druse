import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { QueryResult, ResultSet } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { ResultsGrid } from '../results-grid/results-grid';

type ResultsTab = 'results' | 'messages' | 'history';

/**
 * Panel inferior: resultados, mensajes e historial.
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
  readonly resultSet = input<ResultSet | null>(null);
  readonly result = input<QueryResult | null>(null);
  readonly pageSize = input(500);

  protected readonly activeTab = signal<ResultsTab>('results');

  protected readonly hasFilters = computed(() =>
    (this.resultSet()?.columns ?? []).some((column) => !!column.filter),
  );

  protected readonly rowCount = computed(() => this.resultSet()?.rows.length ?? 0);

  /** Mensajes del servidor más el error, si lo hubo. */
  protected readonly messages = computed(() => {
    const result = this.result();

    if (!result) {
      return [];
    }

    const messages = [...result.messages];

    if (result.error) {
      messages.push({
        text: result.error.code
          ? `${result.error.message} (${result.error.code})`
          : result.error.message,
        severity: 'error' as const,
      });
    }

    return messages;
  });

  protected readonly messageCount = computed(() => this.messages().length);

  protected readonly rangeLabel = computed(() => {
    const set = this.resultSet();

    if (!set || set.rows.length === 0) {
      return 'Sin filas';
    }

    return set.truncated
      ? `1–${set.rows.length} (recortado)`
      : `1–${set.rows.length} de ${set.totalRows.toLocaleString('es')}`;
  });

  protected select(tab: ResultsTab): void {
    this.activeTab.set(tab);
  }
}
