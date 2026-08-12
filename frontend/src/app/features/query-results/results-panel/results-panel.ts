import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { QueryHistoryEntry, QueryResult, ResultSet } from '../../../shared/models/workspace';
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
  readonly history = input<readonly QueryHistoryEntry[]>([]);
  readonly pageSize = input(500);

  readonly refreshHistory = output<void>();
  readonly searchHistory = output<string>();
  readonly clearHistory = output<void>();
  readonly reuseQuery = output<string>();

  protected readonly activeTab = signal<ResultsTab>('results');
  protected readonly historySearch = signal('');

  /** Abre la pestaña indicada y refresca el historial al entrar en él. */
  protected select(tab: ResultsTab): void {
    this.activeTab.set(tab);

    if (tab === 'history') {
      this.refreshHistory.emit();
    }
  }

  /**
   * Filtra el historial.
   *
   * La búsqueda la resuelve el servidor, que es quien tiene todas las entradas:
   * filtrar en el cliente solo alcanzaría a las que ya se hubieran traído.
   */
  protected onSearch(event: Event): void {
    const term = (event.target as HTMLInputElement).value;

    this.historySearch.set(term);
    this.searchHistory.emit(term);
  }

  /** Fecha corta y legible; la absoluta va en el atributo `title`. */
  protected formatDate(iso: string): string {
    const date = new Date(iso);

    return date.toLocaleString('es', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Una línea del SQL, para que la lista no se descuadre. */
  protected summarize(sql: string): string {
    const collapsed = sql.replace(/\s+/g, ' ').trim();

    return collapsed.length > 120 ? `${collapsed.slice(0, 120)}…` : collapsed;
  }

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
}
