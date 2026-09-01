import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { DatabaseObject, SchemaGraph } from '../../../shared/models/workspace';
import {
  BOX,
  DetailLevel,
  DiagramBox,
  DiagramLink,
  layoutDiagram,
  neighbours,
  tableKey,
} from '../diagram-layout';

/** Una caja con lo que hace falta para pintarla en el estado en que está. */
interface PaintedBox extends DiagramBox {
  readonly lit: boolean;
  readonly selected: boolean;
}

/** Una relación con su trazo y su intensidad ya resueltos. */
interface PaintedLink extends DiagramLink {
  readonly lit: boolean;
  readonly emphasised: boolean;
  readonly dash: string;
}

/**
 * El lienzo del diagrama entidad-relación.
 *
 * Dibuja lo que el catálogo dice y **nada más**: las relaciones sugeridas por
 * nombre llegan en una fase posterior y ya se distinguen aquí por `kind`, para
 * que el día que entren no haya que tocar el trazo.
 *
 * No guarda nada por su cuenta. Recibe el grafo ya leído y devuelve los gestos
 * hacia arriba: quién quiere abrir el diseñador, qué tabla se ha movido.
 */
@Component({
  selector: 'app-diagram-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diagram-canvas.html',
  styleUrl: './diagram-canvas.scss',
})
export class DiagramCanvas {
  /** Lo leído del catálogo. Se relee al abrir; aquí nunca se guarda. */
  readonly graph = input.required<SchemaGraph>();

  /** Posiciones que el usuario movió a mano, que mandan sobre la colocación. */
  readonly positions = input<ReadonlyMap<string, { x: number; y: number }>>(new Map());

  /** Alguien pide abrir una tabla en el diseñador. */
  readonly openTable = output<DatabaseObject>();

  /** Una tabla cambió de sitio: quien nos monta decide si lo guarda. */
  readonly moved = output<{ key: string; x: number; y: number }>();

  /**
   * Traer al lienzo las tablas que se relacionan con esta.
   *
   * El lienzo no puede resolverlo solo: las tablas **que apuntan a ella** no
   * están en el grafo que tiene: hay que volver a leer el catálogo, y de eso
   * sabe el panel.
   */
  readonly bringNeighbours = output<string>();

  protected readonly level = signal<DetailLevel>('full');
  protected readonly selected = signal<string | null>(null);
  protected readonly showSuggested = signal(true);

  /** Desplazamiento del lienzo, en píxeles. Lo mueve el arrastre del fondo. */
  protected readonly panX = signal(0);
  protected readonly panY = signal(0);

  private readonly _dragged = signal<ReadonlyMap<string, { x: number; y: number }>>(new Map());

  /** Lo que se está arrastrando ahora mismo, o nada. */
  private _drag: {
    key: string | null;
    pointer: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null = null;

  /** El alto de una fila, para que la plantilla no repita el número. */
  protected readonly rowHeight = BOX.row;
  protected readonly headerHeight = BOX.header;

  private readonly _canvas = viewChild<ElementRef<HTMLElement>>('canvas');

  /**
   * Alto útil del lienzo, medido.
   *
   * La colocación lo necesita para saber cuándo pasar a la columna siguiente, y
   * un número fijo aquí sería mentira: el panel ocupa la ventana, y la ventana
   * la mueve el usuario. Con el número puesto a ojo, la última tabla se salía
   * por debajo del borde.
   */
  private readonly _viewport = signal(760);

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const element = this._canvas()?.nativeElement;

      if (!element) {
        return;
      }

      this._viewport.set(element.clientHeight);

      const observer = new ResizeObserver(() => this._viewport.set(element.clientHeight));

      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  private readonly _layout = computed(() => {
    const fixed = new Map(this.positions());

    for (const [key, position] of this._dragged()) {
      fixed.set(key, position);
    }

    return layoutDiagram(this.graph().tables, this.level(), fixed, this._viewport());
  });

  protected readonly width = computed(() => this._layout().width);
  protected readonly height = computed(() => this._layout().height);

  private readonly _visibleLinks = computed(() =>
    this._layout().links.filter((link) => link.kind === 'declared' || this.showSuggested()),
  );

  private readonly _near = computed(() => neighbours(this._visibleLinks(), this.selected()));

  protected readonly boxes = computed<readonly PaintedBox[]>(() => {
    const near = this._near();
    const selected = this.selected();

    return this._layout().boxes.map((box) => ({
      ...box,
      lit: near === null || near.has(box.key),
      selected: box.key === selected,
    }));
  });

  protected readonly links = computed<readonly PaintedLink[]>(() => {
    const near = this._near();
    const selected = this.selected();

    return this._visibleLinks().map((link) => ({
      ...link,
      lit: near === null || (near.has(link.from) && near.has(link.to)),
      emphasised: selected !== null && (link.from === selected || link.to === selected),
      dash: link.kind === 'suggested' ? '6 5' : 'none',
    }));
  });

  /** Cuántas tablas hay, cuántas relaciones y cuántas ya no están. */
  protected readonly summary = computed(() => {
    const declared = this._layout().links.filter((link) => link.kind === 'declared').length;
    const suggested = this._layout().links.length - declared;

    return {
      tables: this._layout().boxes.length,
      declared,
      suggested,
      missing: this.graph().missing.length,
    };
  });

  protected readonly selectionLabel = computed(() => {
    const selected = this.selected();

    if (selected === null) {
      return 'Resaltar vecinas';
    }

    const box = this._layout().boxes.find((entry) => entry.key === selected);

    return box ? `${box.table.name} y sus vecinas` : 'Resaltar vecinas';
  });

  protected readonly levels: readonly { readonly id: DetailLevel; readonly label: string }[] = [
    { id: 'full', label: 'Completo' },
    { id: 'keys', label: 'Claves' },
    { id: 'collapsed', label: 'Plegado' },
  ];

  protected setLevel(level: DetailLevel): void {
    this.level.set(level);
  }

  protected toggleSuggested(): void {
    this.showSuggested.update((value) => !value);
  }

  /** Marcar una tabla la resalta; volver a marcarla apaga el resaltado. */
  protected select(key: string): void {
    this.selected.update((current) => (current === key ? null : key));
  }

  protected clearSelection(): void {
    this.selected.set(null);
  }

  /**
   * Devuelve las tablas a la colocación automática.
   *
   * Colocar es una acción y no un estado: en cuanto alguien mueve una tabla, su
   * posición manda hasta que se pulsa esto.
   */
  protected rearrange(): void {
    this._dragged.set(new Map());
  }

  protected open(box: PaintedBox): void {
    this.openTable.emit(box.table);
  }

  protected bring(): void {
    const selected = this.selected();

    if (selected !== null) {
      this.bringNeighbours.emit(selected);
    }
  }

  protected identify = (_: number, box: PaintedBox): string => box.key;

  protected identifyLink = (_: number, link: PaintedLink): string =>
    `${link.from}|${link.to}|${link.id}`;

  /** Arrastrar una caja la mueve; arrastrar el fondo mueve el lienzo entero. */
  protected startDrag(event: PointerEvent, box: PaintedBox | null): void {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    target?.setPointerCapture?.(event.pointerId);

    this._drag = {
      key: box?.key ?? null,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: box?.x ?? this.panX(),
      originY: box?.y ?? this.panY(),
    };

    event.preventDefault();
  }

  protected onDrag(event: PointerEvent): void {
    const drag = this._drag;

    if (drag === null || drag.pointer !== event.pointerId) {
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (drag.key === null) {
      this.panX.set(drag.originX + dx);
      this.panY.set(drag.originY + dy);
      return;
    }

    const moved = new Map(this._dragged());
    moved.set(drag.key, { x: drag.originX + dx, y: drag.originY + dy });
    this._dragged.set(moved);
  }

  protected endDrag(event: PointerEvent): void {
    const drag = this._drag;

    if (drag === null || drag.pointer !== event.pointerId) {
      return;
    }

    this._drag = null;

    if (drag.key === null) {
      return;
    }

    const position = this._dragged().get(drag.key);

    if (position) {
      this.moved.emit({ key: drag.key, x: position.x, y: position.y });
    }
  }

  /** La clave de un nodo del explorador, para saber si ya está en el lienzo. */
  protected keyOf(table: DatabaseObject): string {
    return tableKey(table);
  }
}
