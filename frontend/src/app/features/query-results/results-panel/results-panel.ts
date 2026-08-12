import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { ExportFormat } from '../../../core/application-gateway/application-gateway';
import { QueryHistoryEntry, QueryResult, ResultSet } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { QueryHistory } from '../../query-history/query-history/query-history';
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
  imports: [Icon, ResultsGrid, QueryHistory],
  templateUrl: './results-panel.html',
  styleUrl: './results-panel.scss',
})
export class ResultsPanel {
  readonly resultSet = input<ResultSet | null>(null);
  readonly result = input<QueryResult | null>(null);
  readonly history = input<readonly QueryHistoryEntry[]>([]);
  readonly pageSize = input(500);

  readonly exporting = input(false);

  readonly refreshHistory = output<void>();
  readonly searchHistory = output<string>();
  readonly clearHistory = output<void>();
  readonly reuseQuery = output<string>();
  readonly exportAs = output<ExportFormat>();
  readonly copied = output<string>();
  readonly copyFailed = output<void>();

  protected readonly activeTab = signal<ResultsTab>('results');
  protected readonly exportOpen = signal(false);
  protected readonly showFilters = signal(false);

  /** Índice del conjunto de resultados visible, si la consulta devolvió varios. */
  protected readonly activeSetIndex = signal(0);

  protected readonly resultSets = computed(() => this.result()?.resultSets ?? []);

  /**
   * Conjunto que se está mostrando.
   *
   * `resultSet` sigue existiendo para quien solo tenga uno; si hay varios manda
   * el que el usuario haya elegido.
   */
  protected readonly currentSet = computed(() => {
    const sets = this.resultSets();

    return sets.length > 0
      ? (sets[Math.min(this.activeSetIndex(), sets.length - 1)] ?? null)
      : this.resultSet();
  });

  protected toggleExport(): void {
    this.exportOpen.update((open) => !open);
  }

  protected chooseExport(format: ExportFormat): void {
    this.exportOpen.set(false);
    this.exportAs.emit(format);
  }

  protected toggleFilters(): void {
    this.showFilters.update((visible) => !visible);
  }

  protected selectSet(index: number): void {
    this.activeSetIndex.set(index);
  }

  /** Abre la pestaña indicada y refresca el historial al entrar en él. */
  protected select(tab: ResultsTab): void {
    this.activeTab.set(tab);

    if (tab === 'history') {
      this.refreshHistory.emit();
    }
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
