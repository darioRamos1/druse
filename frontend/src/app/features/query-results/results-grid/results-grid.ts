import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { CellEdit, ResultColumn, ResultRow, ResultSet } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { fitColumnWidth, MIN_COLUMN_WIDTH } from '../../../core/application-gateway/column-widths';
import { CopyFormat, CopySelection, formatSelection } from './copy-formats';

/** Ancho de la columna del número de fila. */
const ROW_NUMBER_WIDTH = 44;

/** Filas añadidas al DOM en cada bloque. */
const ROW_PAGE_SIZE = 500;

/** Celda que se está editando, por número de fila y columna. */
interface CellPosition {
  readonly row: number;
  readonly column: number;
}

/**
 * Extremo de una selección de celdas.
 *
 * La fila va por **posición entre las filas visibles**, no por su número: con un
 * filtro puesto los números dejan de ser consecutivos, y un rango apoyado en
 * ellos se llevaría filas que el filtro esconde.
 */
interface CellAnchor {
  readonly row: number;
  readonly column: number;
}

/** Dónde se abrió el menú contextual, en coordenadas de la ventana. */
interface MenuPosition {
  readonly top: number;
  readonly left: number;
}

/**
 * Cuadrícula de resultados.
 *
 * Rejilla CSS con renderizado progresivo: el resultado completo sigue disponible
 * para exportar, pero el DOM solo recibe bloques manejables de filas.
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

  /**
   * La selección de celdas: dónde empezó y hasta dónde llega.
   *
   * Dos extremos y no una lista de celdas: lo que se puede seleccionar aquí es
   * siempre un rectángulo, y guardar las esquinas evita recorrer —y recordar—
   * un resultado que puede tener cientos de miles de filas.
   */
  protected readonly anchor = signal<CellAnchor | null>(null);
  protected readonly focus = signal<CellAnchor | null>(null);

  /**
   * Columnas enteras seleccionadas, por índice.
   *
   * Es otro modo de selección, y los tres se excluyen: al pulsar una cabecera se
   * olvidan el rango de celdas y las filas, y así con cada uno. Mezclarlos
   * dejaría una selección que no se puede dibujar ni explicar.
   */
  protected readonly selectedColumns = signal<readonly number[]>([]);

  /**
   * Filas enteras seleccionadas, por **posición entre las filas visibles**.
   *
   * Por posición y no por número de fila, por lo mismo que el rango de celdas:
   * con un filtro puesto los números dejan de ser consecutivos, y un tramo
   * apoyado en ellos se llevaría filas que el filtro esconde.
   *
   * No confundir con el input `selectedRows`, que son las filas señaladas para
   * borrar y van por número: aquello marca, esto copia.
   */
  protected readonly chosenRows = signal<readonly number[]>([]);

  protected readonly menu = signal<MenuPosition | null>(null);

  protected readonly visibleLimit = signal(ROW_PAGE_SIZE);

  /** La última cabecera pulsada, para que Mayúsculas sepa desde dónde extender. */
  private lastColumn: number | null = null;

  /** Lo mismo para las filas: desde dónde extiende Mayúsculas. */
  private lastRow: number | null = null;

  /**
   * Qué se está barriendo con el botón pulsado, si es que se barre algo.
   *
   * Un solo campo y no un booleano por modo: el arrastre empieza en un sitio
   * —una celda o un número de fila— y lo que se recorra después no puede cambiar
   * de idea a mitad de camino.
   */
  private dragMode: 'cells' | 'rows' | null = null;

  /**
   * Anchos que el usuario ha ajustado, por nombre de columna.
   *
   * Por nombre y no por posición: al reejecutar la consulta llega un resultado
   * nuevo, y lo que el usuario quiere recuperar es el ancho de *esa* columna.
   */
  protected readonly customWidths = signal<Readonly<Record<string, number>>>({});

  /** Se está arrastrando el borde de una cabecera. */
  private resizing: { column: number; startX: number; startWidth: number } | null = null;

  protected readonly isResizing = signal(false);

  private readonly host = inject(ElementRef<HTMLElement>);

  /**
   * Lleva el teclado a la cuadrícula.
   *
   * Se enfoca una celda y no el contenedor: las flechas, el copiado y la
   * edición cuelgan de la celda, así que enfocar el marco dejaría el foco en un
   * sitio donde no funciona nada. Si ya había una celda seleccionada se vuelve a
   * ella; si no, a la primera.
   */
  focusGrid(): void {
    const element = this.host.nativeElement as HTMLElement;
    const seleccionada = element.querySelector<HTMLElement>('.cell--value.is-selected');

    (seleccionada ?? element.querySelector<HTMLElement>('.cell--value'))?.focus();
  }

  /**
   * Qué columnas trae el resultado, en orden.
   *
   * Es lo que distingue «la misma consulta otra vez» de «otra consulta»: mientras
   * las columnas sean las mismas, los anchos ajustados a mano siguen valiendo.
   */
  private readonly columnSignature = computed(() =>
    this.resultSet()
      .columns.map((column) => column.name)
      .join('\u0000'),
  );

  private lastSignature: string | null = null;

  private readonly resetLocalState = effect(() => {
    // Se lee el resultado entero y no solo su firma: la firma no cambia cuando
    // se reejecuta la misma consulta, y entonces esto no volvería a correr y el
    // filtro y la selección de la ejecución anterior seguirían puestos sobre
    // filas que ya no son las mismas.
    this.resultSet();

    const signature = this.columnSignature();

    this.filters.set({});
    this.clearSelection();
    this.editing.set(null);
    this.menu.set(null);
    this.visibleLimit.set(ROW_PAGE_SIZE);

    // Los anchos son lo único que sobrevive a una ejecución: volver a lanzar la
    // consulta que acabas de ensanchar y encontrarla otra vez estrecha sería
    // pedir el mismo trabajo dos veces. Cambian las columnas, se olvidan.
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.customWidths.set({});
    }
  });

  /**
   * Plantilla de columnas de la rejilla. La última lleva `1fr` para absorber el
   * espacio sobrante, igual que en el mockup.
   */
  protected readonly gridTemplate = computed(() => {
    const custom = this.customWidths();

    const columns = this.resultSet().columns.map((column) => {
      const ajustado = custom[column.name];

      if (ajustado !== undefined) {
        return `${ajustado}px`;
      }

      return column.width === null ? '1fr' : `${column.width}px`;
    });

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

  protected readonly renderedRows = computed(() =>
    this.visibleRows().slice(0, this.visibleLimit()),
  );

  protected readonly remainingRows = computed(() =>
    Math.max(0, this.visibleRows().length - this.renderedRows().length),
  );

  protected onFilter(columnIndex: number, event: Event): void {
    const term = (event.target as HTMLInputElement).value;

    this.filters.update((current) => ({ ...current, [columnIndex]: term }));
    this.visibleLimit.set(ROW_PAGE_SIZE);
  }

  protected showMore(): void {
    this.visibleLimit.update((current) => current + ROW_PAGE_SIZE);
  }

  /**
   * Empieza una selección de celdas donde se pulsó.
   *
   * Con Mayúsculas no se empieza: se estira la que ya había hasta aquí, que es
   * como se coge un bloque largo sin arrastrar por media pantalla.
   */
  protected beginCellSelection(row: number, column: number, event: MouseEvent): void {
    // El botón derecho no selecciona: abre el menú sobre lo que ya estuviera
    // marcado, igual que en una hoja de cálculo.
    if (event.button === 2) {
      return;
    }

    this.selectedColumns.set([]);
    this.chosenRows.set([]);
    this.lastColumn = null;
    this.lastRow = null;

    if (event.shiftKey && this.anchor()) {
      this.focus.set({ row, column });
    } else {
      this.anchor.set({ row, column });
      this.focus.set({ row, column });
    }

    this.dragMode = 'cells';
  }

  /** Estira la selección mientras el ratón barre celdas con el botón pulsado. */
  protected extendCellSelection(row: number, column: number, event: MouseEvent): void {
    // `buttons` y no `button`: en un `mouseenter` este último no dice nada, y sin
    // comprobarlo la selección seguiría al puntero después de soltar.
    if (this.dragMode !== 'cells' || event.buttons !== 1) {
      return;
    }

    this.focus.set({ row, column });
  }

  /**
   * Selecciona una columna entera desde su cabecera.
   *
   * Control añade o quita una suelta y Mayúsculas coge el tramo entre la última
   * y esta, que es lo que hace cualquier lista con selección múltiple.
   */
  protected selectColumn(column: number, event: MouseEvent): void {
    this.anchor.set(null);
    this.focus.set(null);
    this.chosenRows.set([]);
    this.lastRow = null;

    if (event.shiftKey && this.lastColumn !== null) {
      const from = Math.min(this.lastColumn, column);
      const to = Math.max(this.lastColumn, column);

      this.selectedColumns.set(Array.from({ length: to - from + 1 }, (_, i) => from + i));

      return;
    }

    if (event.ctrlKey || event.metaKey) {
      this.selectedColumns.update((current) =>
        current.includes(column)
          ? current.filter((index) => index !== column)
          : [...current, column].sort((a, b) => a - b),
      );
      this.lastColumn = column;

      return;
    }

    this.selectedColumns.set([column]);
    this.lastColumn = column;
  }

  /**
   * Empieza a seleccionar filas enteras desde su número.
   *
   * Es el gesto simétrico al de las cabeceras, y hace lo mismo que cualquier
   * lista con selección múltiple: Control añade o quita una suelta, Mayúsculas
   * coge el tramo desde la última, y arrastrar barre las que se van pisando.
   */
  protected beginRowSelection(row: number, event: MouseEvent): void {
    // El botón derecho no selecciona: abre el menú sobre lo que ya hubiera.
    if (event.button === 2) {
      return;
    }

    // Empezar a barrer filas con el botón pulsado exige que el arrastre no
    // seleccione texto por debajo, que es lo que haría el navegador por su
    // cuenta en cuanto el puntero saliera de la celda.
    event.preventDefault();

    this.anchor.set(null);
    this.focus.set(null);
    this.selectedColumns.set([]);
    this.lastColumn = null;

    if (event.shiftKey && this.lastRow !== null) {
      const from = Math.min(this.lastRow, row);
      const to = Math.max(this.lastRow, row);

      this.chosenRows.set(Array.from({ length: to - from + 1 }, (_, i) => from + i));
      this.dragMode = 'rows';

      return;
    }

    if (event.ctrlKey || event.metaKey) {
      this.chosenRows.update((current) =>
        current.includes(row)
          ? current.filter((index) => index !== row)
          : [...current, row].sort((a, b) => a - b),
      );
      this.lastRow = row;

      // Con Control se va picando de una en una; barrer desde aquí se llevaría
      // por delante justo lo que se está componiendo a mano.
      return;
    }

    this.chosenRows.set([row]);
    this.lastRow = row;
    this.dragMode = 'rows';
  }

  /** Estira la selección de filas mientras el ratón las barre. */
  protected extendRowSelection(row: number, event: MouseEvent): void {
    // `buttons` y no `button`, igual que en las celdas: en un `mouseenter` el
    // segundo no dice nada y la selección seguiría al puntero tras soltar.
    if (this.dragMode !== 'rows' || event.buttons !== 1 || this.lastRow === null) {
      return;
    }

    const from = Math.min(this.lastRow, row);
    const to = Math.max(this.lastRow, row);

    this.chosenRows.set(Array.from({ length: to - from + 1 }, (_, i) => from + i));
  }

  protected isRowChosen(row: number): boolean {
    return this.chosenRows().includes(row);
  }

  /**
   * Empieza a arrastrar el borde derecho de una cabecera.
   *
   * Se para el evento antes de que suba: el mismo botón sobre la cabecera
   * selecciona la columna, y quien viene a ensancharla no está pidiendo eso.
   */
  protected beginResize(column: number, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    this.resizing = { column, startX: event.clientX, startWidth: this.renderedWidth(column) };
    this.isResizing.set(true);
  }

  @HostListener('document:mousemove', ['$event'])
  protected onResizeMove(event: MouseEvent): void {
    if (!this.resizing) {
      return;
    }

    this.setWidth(
      this.resizing.column,
      this.resizing.startWidth + (event.clientX - this.resizing.startX),
    );
  }

  /**
   * Ajusta la columna a lo más largo que haya en ella.
   *
   * Mira las filas que están pintadas y el título, y se queda con el mayor. No
   * lee las que aún no han entrado al DOM: lo que se pide con este gesto es ver
   * lo que hay delante, y recorrer cien mil filas para eso costaría más que el
   * problema que resuelve.
   */
  protected autoFit(column: number, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const definition = this.resultSet().columns[column];

    if (!definition) {
      return;
    }

    const values = this.renderedRows().map((row) => this.shownValue(row, column));

    this.setWidth(column, fitColumnWidth(definition, values));
  }

  /** Se suelta el botón en cualquier parte: el barrido termina donde quedó. */
  @HostListener('document:mouseup')
  protected endDrag(): void {
    this.dragMode = null;
    this.resizing = null;
    this.isResizing.set(false);
  }

  private setWidth(column: number, width: number): void {
    const name = this.resultSet().columns[column]?.name;

    if (name === undefined) {
      return;
    }

    this.customWidths.update((current) => ({
      ...current,
      [name]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)),
    }));
  }

  /**
   * Lo que mide ahora mismo la cabecera en pantalla.
   *
   * Se pregunta al DOM en vez de mirar el ancho declarado porque la última
   * columna no tiene ninguno: se estira para absorber el espacio sobrante, y
   * empezar a arrastrarla desde un número inventado la haría saltar.
   */
  private renderedWidth(column: number): number {
    const heads = (this.host.nativeElement as HTMLElement).querySelectorAll('.cell--head');
    const head = heads[column] as HTMLElement | undefined;
    const medido = head?.getBoundingClientRect().width ?? 0;

    if (medido > 0) {
      return medido;
    }

    // Sin nada que medir —la cabecera todavía no está pintada— vale lo último
    // que se ajustó, y en su defecto lo que el reparto inicial le dio.
    const definition = this.resultSet().columns[column];

    return (
      (definition && this.customWidths()[definition.name]) ?? definition?.width ?? MIN_COLUMN_WIDTH
    );
  }

  private clearSelection(): void {
    this.anchor.set(null);
    this.focus.set(null);
    this.selectedColumns.set([]);
    this.chosenRows.set([]);
    this.lastColumn = null;
    this.lastRow = null;
    this.dragMode = null;
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

  /** Rectángulo seleccionado, ya con las esquinas ordenadas. */
  private readonly bounds = computed(() => {
    const anchor = this.anchor();
    const focus = this.focus() ?? anchor;

    if (!anchor || !focus) {
      return null;
    }

    return {
      top: Math.min(anchor.row, focus.row),
      bottom: Math.max(anchor.row, focus.row),
      left: Math.min(anchor.column, focus.column),
      right: Math.max(anchor.column, focus.column),
    };
  });

  /** Hay algo que copiar. Lo consulta también la barra del panel. */
  readonly hasSelection = computed(
    () =>
      this.selectedColumns().length > 0 || this.chosenRows().length > 0 || this.bounds() !== null,
  );

  /**
   * Cuánto hay cogido, para decirlo en el menú.
   *
   * Importa porque seleccionar una columna se lleva **todas** las filas que pasan
   * el filtro, no solo las que están pintadas: sin verlo escrito, quien copia una
   * columna de un resultado de cien mil filas no sabe qué acaba de coger.
   */
  readonly selectionLabel = computed(() => {
    const selection = this.selectionShape();

    if (!selection) {
      return '';
    }

    const columnas = selection.columns === 1 ? '1 columna' : `${selection.columns} columnas`;
    const filas = selection.rows === 1 ? '1 fila' : `${selection.rows.toLocaleString('es')} filas`;

    return `${columnas} × ${filas}`;
  });

  private readonly selectionShape = computed(() => {
    const chosen = this.selectedColumns();

    if (chosen.length > 0) {
      return { columns: chosen.length, rows: this.visibleRows().length };
    }

    const filas = this.chosenRows();

    if (filas.length > 0) {
      return { columns: this.resultSet().columns.length, rows: filas.length };
    }

    const bounds = this.bounds();

    return bounds
      ? { columns: bounds.right - bounds.left + 1, rows: bounds.bottom - bounds.top + 1 }
      : null;
  });

  protected isColumnSelected(column: number): boolean {
    return this.selectedColumns().includes(column);
  }

  protected isSelected(row: number, column: number): boolean {
    if (this.selectedColumns().length > 0) {
      return this.selectedColumns().includes(column);
    }

    if (this.chosenRows().length > 0) {
      return this.chosenRows().includes(row);
    }

    const bounds = this.bounds();

    return (
      !!bounds &&
      row >= bounds.top &&
      row <= bounds.bottom &&
      column >= bounds.left &&
      column <= bounds.right
    );
  }

  /**
   * Abre el menú de copia donde se pulsó.
   *
   * Si el clic cae fuera de lo seleccionado, primero se selecciona eso: pedir
   * «copiar» sobre una celda que no está marcada tiene que copiar esa celda, no
   * lo que quedó marcado hace un rato en otra parte de la cuadrícula.
   */
  protected openMenu(event: MouseEvent, row: number | null, column: number): void {
    event.preventDefault();

    if (row === null) {
      if (!this.isColumnSelected(column)) {
        this.selectColumn(column, event);
      }
    } else if (!this.isSelected(row, column)) {
      this.selectedColumns.set([]);
      this.chosenRows.set([]);
      this.anchor.set({ row, column });
      this.focus.set({ row, column });
    }

    this.menu.set({ top: event.clientY, left: event.clientX });
  }

  /**
   * Abre el menú desde el número de fila.
   *
   * Si la fila no estaba cogida, se coge sola: pedir «copiar» sobre una fila que
   * no está marcada tiene que copiar esa fila, no lo que quedó marcado antes en
   * otra parte, que es la misma regla que sigue el menú de las celdas.
   */
  protected openRowMenu(event: MouseEvent, row: number): void {
    event.preventDefault();

    if (!this.isRowChosen(row)) {
      this.anchor.set(null);
      this.focus.set(null);
      this.selectedColumns.set([]);
      this.chosenRows.set([row]);
      this.lastRow = row;
    }

    this.menu.set({ top: event.clientY, left: event.clientX });
  }

  /**
   * Cualquier clic o Escape cierra el menú.
   *
   * El de una opción del menú también, y no hay carrera: el botón atiende su
   * propio clic antes de que el evento llegue al documento.
   */
  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  protected closeMenu(): void {
    this.menu.set(null);
  }

  /**
   * Copia lo seleccionado con el formato pedido.
   *
   * Público porque el mismo trabajo se pide desde dos sitios: el menú de aquí y
   * el botón de la barra del panel, que no tiene forma de saber qué hay cogido.
   */
  async copyAs(format: CopyFormat): Promise<void> {
    const selection = this.currentSelection();

    if (!selection) {
      return;
    }

    await this.copy(formatSelection(selection, format));
  }

  /**
   * Lo seleccionado, tal como se ve.
   *
   * Sale de `visibleRows` y no de las filas pintadas: una columna seleccionada se
   * lleva todo lo que pasa el filtro, aunque el DOM solo tenga las primeras
   * quinientas. Y de `shownValue`, para que un cambio sin guardar se copie como
   * se está viendo y no como estaba en la base.
   */
  private currentSelection(): CopySelection | null {
    const columns = this.resultSet().columns;
    const rows = this.visibleRows();
    const chosen = this.selectedColumns();

    if (chosen.length > 0) {
      const indices = [...chosen].sort((a, b) => a - b);

      return {
        columns: indices.map((index) => columns[index]),
        rows: rows.map((row) => indices.map((index) => this.shownValue(row, index))),
      };
    }

    const filas = this.chosenRows();

    if (filas.length > 0) {
      // Todas las columnas, y solo las filas cogidas: es el simétrico exacto de
      // seleccionar columnas, que se lleva todas las filas del filtro.
      return {
        columns: [...columns],
        rows: filas
          .filter((index) => index < rows.length)
          .map((index) => columns.map((_, i) => this.shownValue(rows[index], i))),
      };
    }

    const bounds = this.bounds();

    if (!bounds) {
      return null;
    }

    const indices = Array.from(
      { length: bounds.right - bounds.left + 1 },
      (_, offset) => bounds.left + offset,
    );

    return {
      columns: indices.map((index) => columns[index]),
      rows: rows
        .slice(bounds.top, bounds.bottom + 1)
        .map((row) => indices.map((index) => this.shownValue(row, index))),
    };
  }

  /**
   * Lo que hace Ctrl+C.
   *
   * Una sola celda se copia tal cual, sin encabezado, que es la costumbre de
   * siempre y lo que espera quien va a pegarla en un mensaje. En cuanto hay más
   * de una, sale con tabuladores y con los nombres arriba, listo para una hoja.
   */
  protected async copyShortcut(row: ResultRow, columnIndex: number): Promise<void> {
    const selection = this.currentSelection();

    if (!selection || (selection.columns.length === 1 && selection.rows.length === 1)) {
      await this.copyCell(row, columnIndex);

      return;
    }

    await this.copyAs('excel');
  }

  /** Copia el valor de una celda. */
  protected async copyCell(row: ResultRow, columnIndex: number): Promise<void> {
    await this.copy(this.shownValue(row, columnIndex) ?? '');
  }

  /** Copia una fila entera, separada por tabuladores para pegarla en una hoja. */
  protected async copyRow(row: ResultRow): Promise<void> {
    await this.copy(
      this.resultSet()
        .columns.map((_, index) => this.shownValue(row, index) ?? '')
        .join('\t'),
    );
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
