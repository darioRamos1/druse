import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { QueryHistoryEntry, QueryHistoryFilter } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { formatDate as formatLocaleDate } from '../../../core/i18n/locale-format';

/**
 * Historial de consultas ejecutadas.
 *
 * Vive aparte del panel que lo contiene porque es una vista con entidad propia:
 * su filtro, su lista y sus acciones no tienen nada que ver con la cuadrícula de
 * resultados.
 */
@Component({
  selector: 'app-query-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  templateUrl: './query-history.html',
  styleUrl: './query-history.scss',
})
export class QueryHistory {
  readonly entries = input<readonly QueryHistoryEntry[]>([]);

  readonly filter = input<QueryHistoryFilter>({});
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly hasMore = input(false);
  readonly search = output<QueryHistoryFilter>();
  readonly more = output<void>();
  readonly retry = output<void>();
  readonly clear = output<void>();
  readonly reuse = output<QueryHistoryEntry>();
  protected readonly filterCount = computed(() => {
    const filter = this.filter();
    return [filter.connection, filter.database, filter.from, filter.until, filter.succeeded].filter(
      (value) => value !== undefined && value !== '',
    ).length;
  });

  /**
   * Filtra el historial.
   *
   * La búsqueda la resuelve el servidor, que es quien tiene todas las entradas:
   * filtrar en el cliente solo alcanzaría a las que ya se hubieran traído.
   */
  protected onSearch(
    event: Event,
    key: 'search' | 'connection' | 'database' | 'from' | 'until' | 'succeeded' = 'search',
  ): void {
    const value = (event.target as HTMLInputElement).value;
    this.search.emit({
      ...this.filter(),
      [key]:
        key === 'succeeded' ? (value === '' ? undefined : value === 'true') : value || undefined,
    });
  }

  /** Fecha corta y legible; la absoluta va en el atributo `title`. */
  protected formatDate(iso: string): string {
    return formatLocaleDate(iso, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Una línea del SQL, para que la lista no se descuadre. */
  protected summarize(sql: string): string {
    const collapsed = sql.replace(/\s+/g, ' ').trim();

    return collapsed.length > 120 ? `${collapsed.slice(0, 120)}…` : collapsed;
  }
}
