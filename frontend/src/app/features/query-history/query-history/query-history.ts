import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

import { QueryHistoryEntry } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';

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
  imports: [Icon],
  templateUrl: './query-history.html',
  styleUrl: './query-history.scss',
})
export class QueryHistory {
  readonly entries = input<readonly QueryHistoryEntry[]>([]);

  readonly search = output<string>();
  readonly clear = output<void>();
  readonly reuse = output<QueryHistoryEntry>();

  protected readonly term = signal('');

  /**
   * Filtra el historial.
   *
   * La búsqueda la resuelve el servidor, que es quien tiene todas las entradas:
   * filtrar en el cliente solo alcanzaría a las que ya se hubieran traído.
   */
  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;

    this.term.set(value);
    this.search.emit(value);
  }

  /** Fecha corta y legible; la absoluta va en el atributo `title`. */
  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString('es', {
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
}
