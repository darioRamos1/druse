import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { CellEdit, ResultColumn, ResultRow, ResultSet } from '../../../shared/models/workspace';
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
  readonly compact = input(false);

  /**
   * Se puede editar aquí.
   *
   * Lo decide quien conoce el origen del resultado, no la cuadrícula: hace falta
   * que las filas vengan de una tabla concreta y que su clave primaria esté
   * entre las columnas. Sobre el resultado de un JOIN no hay nada que editar.
   */
  readonly editable = input(false);

  /** Cambios pendientes, para pintarlos aunque el componente se recree. */
  readonly pendingEdits = input<readonly CellEdit[]>([]);

  /** Filas señaladas para borrar, por su número. */
  readonly selectedRows = input<readonly number[]>([]);

  readonly copied = output<string>();
  readonly rowToggled = output<number>();
  readonly copyFailed = output<void>();
  readonly cellEdited = output<CellEdit>();

  protected isRowSelected(row: number): boolean {
    return this.selectedRows().includes(row);
  }

  /** Celda que se está escribiendo ahora mismo. */
  protected readonly editing = signal<CellPosition | null>(null);

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

  /** Empieza a editar una celda, si aquí se puede. */
  protected startEditing(row: number, column: number): void {
    if (this.editable()) {
      this.editing.set({ row, column });
    }
  }

  protected isEditing(row: number, column: number): boolean {
    const editing = this.editing();

    return editing?.row === row && editing.column === column;
  }

  /** Valor pendiente de una celda, si el usuario ya la tocó. */
  protected pendingValue(row: number, columnIndex: number): string | null | undefined {
    const column = this.resultSet().columns[columnIndex]?.name;

    return this.pendingEdits().find((edit) => edit.row === row && edit.column === column)?.value;
  }

  protected isDirty(row: number, columnIndex: number): boolean {
    return this.pendingValue(row, columnIndex) !== undefined;
  }

  /**
   * Con qué control se edita una celda.
   *
   * El tipo lo dice la columna, pero solo se usa si el valor **actual** encaja
   * en él: un control de fecha que recibe algo que no sabe leer lo vacía sin
   * avisar, y aquí eso sería borrar un dato al entrar a mirarlo.
   */
  protected editorType(column: ResultColumn, value: string | null): string {
    const nativo: Readonly<Record<string, string>> = {
      date: 'date',
      time: 'time',
      datetime: 'datetime-local',
      datetimeOffset: 'datetime-local',
      integer: 'number',
      decimal: 'number',
    };

    const tipo = nativo[column.inputKind ?? 'text'];

    if (!tipo || value === null) {
      return 'text';
    }

    const encaja: Readonly<Record<string, RegExp>> = {
      date: /^\d{4}-\d{2}-\d{2}$/,
      time: /^\d{2}:\d{2}(:\d{2})?$/,
      'datetime-local': /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,
      number: /^-?\d*[.]?\d+([eE][-+]?\d+)?$/,
    };

    return encaja[tipo].test(value.trim()) ? tipo : 'text';
  }

  /** Lo que hay que mostrar: el cambio pendiente si lo hay, o el valor original. */
  protected shownValue(row: ResultRow, columnIndex: number): string | null {
    const pending = this.pendingValue(row.number, columnIndex);

    return pending === undefined ? row.values[columnIndex] : pending;
  }

  /**
   * Termina la edición de una celda.
   *
   * Un campo vacío se guarda como cadena vacía, no como NULL: son cosas
   * distintas y confundirlas al escribir sería la peor forma de descubrirlo.
   * Para poner NULL se escribe la palabra, que es lo que la cuadrícula muestra.
   */
  protected commitEdit(row: ResultRow, columnIndex: number, event: Event): void {
    this.editing.set(null);

    const escrito = (event.target as HTMLInputElement).value;
    const column = this.resultSet().columns[columnIndex];
    const value = escrito === 'NULL' ? null : escrito;

    if (value === row.values[columnIndex]) {
      return;
    }

    this.cellEdited.emit({ row: row.number, column: column.name, value });
  }

  protected cancelEdit(): void {
    this.editing.set(null);
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
    await this.copy(
      this.resultSet()
        .columns.map((column) => column.name)
        .join('\t'),
    );
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
