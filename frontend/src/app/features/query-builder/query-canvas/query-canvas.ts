import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { KnownColumn } from '../../../shared/models/workspace';
import { JoinType } from '../../query-editor/sql-language/sql-writer';
import { CanvasLayout } from '../query-model';
import {
  BOX_WIDTH,
  CanvasBox,
  CanvasLink,
  ColumnEnd,
  Connection,
  MAX_ROWS,
  Point,
  boxHeight,
  connectionFor,
  placeBoxes,
  rowY,
  surfaceSize,
  visibleRows,
  wireEnds,
  wirePath,
} from './query-canvas-layout';

/** Una caja ya colocada, con las filas que enseña. */
interface PlacedBox extends CanvasBox {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly rows: readonly KnownColumn[];
  readonly hidden: number;
  readonly linked: ReadonlySet<string>;
}

interface DrawnLink extends CanvasLink {
  readonly path: string;
  readonly mid: Point;
  readonly broken: boolean;
}

/** Arrastre en curso: una caja que se mueve o una columna que se lleva a otra. */
type Drag =
  | {
      readonly kind: 'box';
      readonly key: string;
      readonly pointer: number;
      readonly offset: Point;
      readonly moved: boolean;
    }
  | {
      readonly kind: 'wire';
      readonly from: ColumnEnd;
      readonly pointer: number;
      readonly start: Point;
      readonly origin: Point;
      readonly moved: boolean;
    }
  | {
      /** Una columna que se lleva a un estante, fuera del lienzo. */
      readonly kind: 'field';
      readonly from: ColumnEnd;
      readonly pointer: number;
      readonly origin: Point;
      readonly moved: boolean;
    };

/** Una columna soltada sobre un estante (`data-shelf`). */
export interface FieldDrop extends ColumnEnd {
  readonly shelf: string;
}

/** Cuánto hay que mover el puntero para que un clic pase a ser un arrastre. */
const DRAG_THRESHOLD = 4;

/**
 * El lienzo del compositor: cada tabla es una caja y cada cruce, una línea.
 *
 * No guarda la consulta. Recibe las cajas y las líneas del compositor y le
 * devuelve lo que se pidió —marcar una columna, unir dos, cambiar el tipo de
 * cruce, mover una caja—; el compositor lo aplica a su modelo, que es el mismo
 * que edita el formulario.
 *
 * Todo lo que se hace arrastrando tiene camino de teclado: el enganche de cada
 * columna es un botón que abre la lista de columnas con las que cruzarla.
 */
@Component({
  selector: 'app-query-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './query-canvas.html',
  styleUrl: './query-canvas.scss',
})
export class QueryCanvas {
  readonly boxes = input.required<readonly CanvasBox[]>();
  readonly links = input.required<readonly CanvasLink[]>();
  readonly joinTypes = input.required<readonly JoinType[]>();
  /** Con GROUP BY las columnas salen de los grupos: marcar aquí no haría nada. */
  readonly grouped = input(false);
  readonly layout = input<CanvasLayout | undefined>(undefined);

  readonly toggleColumn = output<ColumnEnd>();
  readonly connect = output<Connection>();
  readonly joinType = output<{ readonly joinId: number; readonly type: JoinType }>();
  readonly removeJoin = output<number>();
  readonly layoutChange = output<CanvasLayout>();
  /** Se empezó o se terminó de llevar una columna a los estantes. */
  readonly fieldDrag = output<boolean>();
  readonly fieldDrop = output<FieldDrop>();

  /** La pastilla que sigue al puntero mientras se lleva una columna a un estante. */
  protected readonly carried = computed(() => {
    const drag = this._drag();
    const client = this._client();
    return drag?.kind === 'field' && drag.moved && client
      ? { column: drag.from.column, x: client.x, y: client.y }
      : null;
  });

  /** Posición del puntero en la ventana: la pastilla sale del lienzo hacia los estantes. */
  private readonly _client = signal<Point | null>(null);

  protected readonly boxWidth = BOX_WIDTH;
  protected readonly maxRows = MAX_ROWS;

  private readonly _surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  private readonly _menu = viewChild<ElementRef<HTMLElement>>('menu');

  /** Al abrir el menú, el foco va a su primera opción: si no, el teclado no llega. */
  private readonly focusMenu = effect(() => {
    const menu = this._menu()?.nativeElement;
    menu?.querySelector<HTMLButtonElement>('button[data-target]')?.focus();
  });

  /** Búsqueda de columnas de cada caja, por clave. */
  protected readonly searches = signal<Readonly<Record<string, string>>>({});

  /** Posición de la caja que se está arrastrando, antes de guardarla. */
  private readonly _moving = signal<{ readonly key: string; readonly at: Point } | null>(null);

  private readonly _drag = signal<Drag | null>(null);
  private readonly _pointer = signal<Point | null>(null);

  /** La columna cuyo menú «Cruzar con…» está abierto. */
  protected readonly menu = signal<ColumnEnd | null>(null);

  protected readonly placed = computed<readonly PlacedBox[]>(() => {
    const links = this.links();
    const searches = this.searches();
    const shaped = this.boxes().map((box) => {
      const linked = new Set<string>();

      for (const link of links) {
        if (link.key === box.key) linked.add(link.rightColumn);
        if (link.leftKey === box.key) linked.add(link.leftColumn);
      }

      const { rows, hidden } = visibleRows(box, linked, searches[box.key] ?? '');
      return { ...box, rows, hidden, linked, height: boxHeight(box, rows.length, hidden) };
    });

    const moving = this._moving();
    const saved = { ...(this.layout() ?? {}) };

    if (moving) {
      saved[moving.key] = moving.at;
    }

    const positions = placeBoxes(shaped, saved);

    return shaped.map((box) => ({ ...box, ...positions.get(box.key)! }));
  });

  protected readonly size = computed(() => {
    const placed = this.placed();
    return surfaceSize(
      new Map(placed.map((box) => [box.key, { x: box.x, y: box.y }])),
      new Map(placed.map((box) => [box.key, box.height])),
    );
  });

  protected readonly drawn = computed<readonly DrawnLink[]>(() => {
    const byKey = new Map(this.placed().map((box) => [box.key, box]));

    return this.links().flatMap((link) => {
      const from = byKey.get(link.leftKey);
      const to = byKey.get(link.key);

      if (!from || !to) {
        return [];
      }

      const { start, end, bend } = wireEnds(
        from,
        rowY(from, from.rows, link.leftColumn),
        to,
        rowY(to, to.rows, link.rightColumn),
      );

      return [
        {
          ...link,
          path: wirePath(start, end, bend),
          mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
          // Una columna que la tabla ya no tiene: el cruce existe, pero su
          // condición no se puede escribir. Se pinta para que se vea y se corrija.
          broken:
            !from.loading &&
            !to.loading &&
            (!from.columns.some((column) => column.name === link.leftColumn) ||
              !to.columns.some((column) => column.name === link.rightColumn)),
        },
      ];
    });
  });

  /** La línea que sigue al puntero mientras se arrastra una columna. */
  protected readonly ghost = computed(() => {
    const drag = this._drag();
    const pointer = this._pointer();

    return drag?.kind === 'wire' && drag.moved && pointer
      ? wirePath(drag.start, pointer, pointer.x >= drag.start.x ? 1 : -1)
      : null;
  });

  /** Columnas de las demás cajas, para el menú «Cruzar con…». */
  protected readonly targets = computed(() => {
    const open = this.menu();

    return open
      ? this.boxes()
          .filter((box) => box.key !== open.key && box.columns.length > 0)
          .map((box) => ({ box, columns: box.columns }))
      : [];
  });

  protected isChosen(box: CanvasBox, column: string): boolean {
    return box.chosen.includes(column);
  }

  protected setSearch(key: string, value: string): void {
    this.searches.update((current) => ({ ...current, [key]: value }));
  }

  // ── Arrastre ─────────────────────────────────────────────────────────────

  private point(event: PointerEvent): Point {
    const rect = this._surface().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  protected startBox(event: PointerEvent, box: PlacedBox): void {
    if (event.button !== 0 || (event.target as Element).closest('button, select, input')) {
      return;
    }

    const at = this.point(event);
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this._drag.set({
      kind: 'box',
      key: box.key,
      pointer: event.pointerId,
      offset: { x: at.x - box.x, y: at.y - box.y },
      moved: false,
    });
  }

  protected startWire(event: PointerEvent, box: PlacedBox, column: string): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const origin = this.point(event);
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this._drag.set({
      kind: 'wire',
      from: { key: box.key, column },
      pointer: event.pointerId,
      start: { x: box.x + BOX_WIDTH, y: rowY(box, box.rows, column) },
      origin,
      moved: false,
    });
  }

  protected move(event: PointerEvent): void {
    const drag = this._drag();

    if (!drag || drag.pointer !== event.pointerId) {
      return;
    }

    const at = this.point(event);

    if (drag.kind === 'box') {
      const x = Math.max(0, Math.round(at.x - drag.offset.x));
      const y = Math.max(0, Math.round(at.y - drag.offset.y));
      this._moving.set({ key: drag.key, at: { x, y } });
      if (!drag.moved) this._drag.set({ ...drag, moved: true });
      return;
    }

    this._pointer.set(at);
    this._client.set({ x: event.clientX, y: event.clientY });

    if (drag.kind === 'field' && drag.moved) {
      this.scrollNearEdge(event.clientY);
    }
    if (!drag.moved && Math.hypot(at.x - drag.origin.x, at.y - drag.origin.y) >= DRAG_THRESHOLD) {
      this._drag.set({ ...drag, moved: true });
      if (drag.kind === 'field') this.fieldDrag.emit(true);
    }
  }

  /**
   * Desplaza el panel que contiene el lienzo cuando el puntero se acerca a su
   * borde.
   *
   * Los estantes quedan debajo del lienzo y, en una ventana normal, fuera de la
   * vista: sin esto, llevar una columna a «Filtros» o a «Orden» obligaría a
   * soltarla, desplazarse y no tener ya nada que soltar.
   */
  private scrollNearEdge(clientY: number): void {
    const scroller = this.scroller();

    if (!scroller) {
      return;
    }

    const rect = scroller.getBoundingClientRect();
    const edge = 48;

    if (clientY > rect.bottom - edge) {
      scroller.scrollTop += Math.ceil((clientY - (rect.bottom - edge)) / 3);
    } else if (clientY < rect.top + edge) {
      scroller.scrollTop -= Math.ceil((rect.top + edge - clientY) / 3);
    }
  }

  /** El primer antepasado que se desplaza en vertical: el cuerpo del diálogo. */
  private scroller(): HTMLElement | null {
    let element = this._surface().nativeElement.parentElement?.parentElement ?? null;

    while (element) {
      const overflow = getComputedStyle(element).overflowY;
      if (
        (overflow === 'auto' || overflow === 'scroll') &&
        element.scrollHeight > element.clientHeight
      ) {
        return element;
      }
      element = element.parentElement;
    }

    return null;
  }

  /**
   * Coge una columna por su nombre para llevarla a un estante.
   *
   * El nombre y no la casilla: la casilla marca, y un arrastre que empieza en
   * ella marcaría la columna sin querer.
   */
  protected startField(event: PointerEvent, box: PlacedBox, column: string): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this._drag.set({
      kind: 'field',
      from: { key: box.key, column },
      pointer: event.pointerId,
      origin: this.point(event),
      moved: false,
    });
  }

  protected end(event: PointerEvent): void {
    const drag = this._drag();

    if (!drag || drag.pointer !== event.pointerId) {
      return;
    }

    this._drag.set(null);
    this._pointer.set(null);
    this._client.set(null);

    if (drag.kind === 'field') {
      if (!drag.moved) {
        return;
      }

      this.fieldDrag.emit(false);
      const shelf = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-shelf]');

      if (shelf) {
        this.fieldDrop.emit({ ...drag.from, shelf: shelf.dataset['shelf']! });
      }
      return;
    }

    if (drag.kind === 'box') {
      const moving = this._moving();
      this._moving.set(null);

      if (drag.moved && moving) {
        this.layoutChange.emit(this.currentLayout(moving));
      }
      return;
    }

    // Soltar sin haberse movido es un clic: abre el menú, que es el camino de
    // teclado y también el de quien no quiere arrastrar.
    if (!drag.moved) {
      this.menu.set(drag.from);
      return;
    }

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-box][data-column]');

    if (target) {
      this.join(drag.from, { key: target.dataset['box']!, column: target.dataset['column']! });
    }
  }

  /** Todas las posiciones de ahora, para que mover una caja no recoloque las otras. */
  private currentLayout(moving: { key: string; at: Point }): CanvasLayout {
    const layout: Record<string, Point> = {};

    for (const box of this.placed()) {
      layout[box.key] = box.key === moving.key ? moving.at : { x: box.x, y: box.y };
    }

    return layout;
  }

  // ── Menú «Cruzar con…» ──────────────────────────────────────────────────

  protected openMenu(box: CanvasBox, column: string, event: Event): void {
    event.preventDefault();
    this.menu.set({ key: box.key, column });
  }

  protected closeMenu(event?: Event): void {
    // Escape no puede llegar al diálogo: cerraría el compositor entero.
    event?.stopPropagation();
    this.menu.set(null);
  }

  protected join(from: ColumnEnd, to: ColumnEnd): void {
    const connection = connectionFor(this.boxes(), from, to);
    this.menu.set(null);

    if (connection) {
      this.connect.emit(connection);
    }
  }

  protected menuLabel(): string {
    return this.menu()?.column ?? '';
  }

  protected menuBox(): PlacedBox | undefined {
    const open = this.menu();
    return open ? this.placed().find((box) => box.key === open.key) : undefined;
  }

  protected menuTop(): number {
    const open = this.menu();
    const box = this.menuBox();
    return open && box ? rowY(box, box.rows, open.column) + 14 : 0;
  }
}
