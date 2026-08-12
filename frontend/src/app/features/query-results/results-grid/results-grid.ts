import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { ResultRow, ResultSet } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';

/** Ancho de la columna del número de fila. */
const ROW_NUMBER_WIDTH = 44;

/** Celda seleccionada, por fila y columna. */
interface CellPosition {
  readonly row: number;
  readonly column: number;
}

/**
 * Cuadrícula de resultados.
 *
 * Rejilla CSS sin virtualizar. Con el límite de 500 filas del ejecutor se
 * comporta bien; si algún día se sube ese tope habrá que virtualizar, y por eso
 * está aislada del panel que la contiene (bitácora D-08).
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
  readonly showFilters = input(false);

  readonly copied = output<string>();
  readonly copyFailed = output<void>();

  /** Filtro escrito por el usuario en cada columna, por índice. */
  protected readonly filters = signal<Readonly<Record<number, string>>>({});

  protected readonly selected = signal<CellPosition | null>(null);

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

  /**
   * Filas que quedan tras aplicar los filtros.
   *
   * El filtrado es local y sobre el texto ya formateado: filtra lo que se ve, no
   * lo que hay en la base. Para acotar de verdad el resultado está el `WHERE` de
   * la consulta, que es lo que el usuario espera de una herramienta SQL.
   */
  protected readonly visibleRows = computed<readonly ResultRow[]>(() => {
    const active = Object.entries(this.filters()).filter(([, term]) => term.trim().length > 0);

    if (active.length === 0) {
      return this.resultSet().rows;
    }

    return this.resultSet().rows.filter((row) =>
      active.every(([index, term]) =>
        (row.values[Number(index)] ?? '').toLowerCase().includes(term.trim().toLowerCase()),
      ),
    );
  });

  protected readonly filtered = computed(
    () => this.visibleRows().length !== this.resultSet().rows.length,
  );

  protected onFilter(columnIndex: number, event: Event): void {
    const term = (event.target as HTMLInputElement).value;

    this.filters.update((current) => ({ ...current, [columnIndex]: term }));
  }

  protected select(row: number, column: number): void {
    this.selected.set({ row, column });
  }

  protected isSelected(row: number, column: number): boolean {
    const selected = this.selected();

    return selected?.row === row && selected.column === column;
  }

  /** Copia el valor de una celda. */
  protected async copyCell(row: ResultRow, columnIndex: number): Promise<void> {
    await this.copy(row.values[columnIndex] ?? '');
  }

  /** Copia una fila entera, separada por tabuladores para pegarla en una hoja. */
  protected async copyRow(row: ResultRow): Promise<void> {
    await this.copy(row.values.map((value) => value ?? '').join('\t'));
  }

  /** Copia los nombres de las columnas. */
  protected async copyHeaders(): Promise<void> {
    await this.copy(this.resultSet().columns.map((column) => column.name).join('\t'));
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.emit(text);
    } catch {
      // El portapapeles puede estar bloqueado por permisos del navegador.
      this.copyFailed.emit();
    }
  }
}
