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

import {
  DatabaseObject,
  SchemaGraph,
  SuggestedRelation,
} from '../../../shared/models/workspace';
import {
  BOX,
  DetailLevel,
  DiagramBox,
  DiagramLink,
  layoutDiagram,
  neighbours,
  tableKey,
} from '../diagram-layout';
import { toDbml, toMermaid } from '../diagram-export';

/**
 * Escapa lo que no puede ir suelto dentro de un SVG.
 *
 * Un nombre de tabla con `&` deja el archivo sin abrir, y el visor no dice por
 * qué: solo enseña una página en blanco.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
 * Dibuja lo que el catálogo dice y, aparte, lo que Druse supone por el nombre de
 * las columnas. Las dos cosas no se pueden confundir: trazo, color y leyenda las
 * separan, y el interruptor de la barra apaga las supuestas.
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

  /**
   * Alguien quiere convertir una suposición en una clave foránea de verdad.
   *
   * El lienzo no la crea: pide que se abra el `ALTER TABLE`. Ninguna suposición
   * de Druse llega a la base sin que alguien lea el SQL.
   */
  readonly acceptSuggestion = output<SuggestedRelation>();

  /**
   * Descartar una suposición: en este diagrama, esa no era.
   *
   * Es lo que hace que la segunda pasada por un esquema sea más limpia que la
   * primera. El lienzo solo lo pide; quien decide qué se recuerda es el panel,
   * que es quien guarda.
   */
  readonly dismissSuggestion = output<SuggestedRelation>();

  /** Volver a mirar las que se descartaron. */
  readonly restoreDismissed = output<void>();

  /** Cuántas suposiciones se descartaron en este diagrama. */
  readonly dismissedCount = input(0);

  /**
   * Quitar una tabla del lienzo.
   *
   * **No la borra.** Deja de dibujarse, y por eso la palabra del menú es
   * «Quitar del diagrama»: borrar de verdad sigue estando en el explorador, con
   * su confirmación.
   */
  readonly removeTable = output<string>();

  /** Ver los datos de una tabla, que es el otro «y esto qué tiene dentro». */
  readonly openData = output<DatabaseObject>();

  /** Un archivo listo para guardar, con el nombre que debería llevar. */
  readonly exported = output<{ name: string; blob: Blob }>();

  /** Texto listo para copiar, con lo que hay que decirle al usuario. */
  readonly copied = output<{ text: string; label: string }>();

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

    return layoutDiagram(
      this.graph().tables,
      this.level(),
      fixed,
      this._viewport(),
      this.graph().suggestions ?? [],
    );
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

  /**
   * Las sugerencias que tocan a la tabla marcada, para poder aceptarlas.
   *
   * Se listan solo con una tabla marcada: en un esquema entero serían decenas y
   * la barra no es sitio para una lista.
   */
  protected readonly pending = computed<readonly SuggestedRelation[]>(() => {
    const selected = this.selected();

    if (selected === null || !this.showSuggested()) {
      return [];
    }

    return (this.graph().suggestions ?? []).filter((suggestion) => {
      const from = tableKey({ schema: suggestion.fromSchema, name: suggestion.fromTable });
      const to = tableKey({ schema: suggestion.toSchema, name: suggestion.toTable });

      return from === selected || to === selected;
    });
  });

  protected accept(suggestion: SuggestedRelation): void {
    this.acceptSuggestion.emit(suggestion);
  }

  protected dismiss(suggestion: SuggestedRelation): void {
    this.dismissSuggestion.emit(suggestion);
  }

  /** El menú de exportar está abierto. */
  protected readonly exportOpen = signal(false);

  protected toggleExport(): void {
    this.exportOpen.update((open) => !open);
  }

  /**
   * El diagrama como texto, para pegarlo en un `README` o versionarlo.
   *
   * Las relaciones supuestas van **comentadas**: un archivo que las presente
   * como claves foráneas es peor que no exportarlo, porque quien lo lea no tiene
   * forma de saber cuáles comprueba el motor.
   */
  protected exportText(format: 'mermaid' | 'dbml'): void {
    this.exportOpen.set(false);

    const options = { includeSuggested: this.showSuggested() };
    const text = format === 'mermaid'
      ? toMermaid(this.graph(), options)
      : toDbml(this.graph(), options);

    this.copied.emit({
      text,
      label: format === 'mermaid' ? 'Mermaid' : 'DBML',
    });
  }

  /**
   * El lienzo como SVG.
   *
   * Se serializa el `<svg>` de las relaciones junto con las cajas, que son HTML:
   * las cajas se vuelcan a `<foreignObject>`… **no**. Se dibujan como `<text>` y
   * `<rect>` calculados aquí, que es lo único que sobrevive fuera del navegador.
   */
  protected exportSvg(): void {
    this.exportOpen.set(false);

    const svg = this.buildSvg();

    this.exported.emit({
      name: 'diagrama.svg',
      blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
    });
  }

  /** El mismo SVG rasterizado, para pegarlo donde no admiten vectores. */
  protected async exportPng(): Promise<void> {
    this.exportOpen.set(false);

    const svg = this.buildSvg();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));

    try {
      const image = new Image();

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('No se pudo dibujar el diagrama.'));
        image.src = url;
      });

      // Al doble de escala: un PNG a tamaño natural se ve borroso en cuanto
      // alguien lo amplía en una presentación.
      const canvas = document.createElement('canvas');
      canvas.width = this.width() * 2;
      canvas.height = this.height() * 2;

      const context = canvas.getContext('2d');

      if (context === null) {
        return;
      }

      context.scale(2, 2);
      context.drawImage(image, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

      if (blob !== null) {
        this.exported.emit({ name: 'diagrama.png', blob });
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Dibuja el lienzo entero como un SVG que se sostiene solo.
   *
   * No se copia el DOM: las cajas son `div`, y un `<foreignObject>` con HTML
   * dentro no sobrevive a la conversión a PNG ni se abre bien fuera del
   * navegador. Se redibujan como rectángulos y texto, que es lo que el formato
   * garantiza.
   */
  private buildSvg(): string {
    const width = this.width();
    const height = this.height();
    const style = getComputedStyle(this._canvas()?.nativeElement ?? document.body);

    const color = (token: string, fallback: string) =>
      style.getPropertyValue(token).trim() || fallback;

    const background = color('--dr-surface-base', '#0e1413');
    const border = color('--dr-border', '#26312e');
    const header = color('--dr-surface-grid-header', '#1b2523');
    const panel = color('--dr-surface-panel', '#151d1b');
    const text = color('--dr-text', '#e6edea');
    const soft = color('--dr-text-tertiary', '#7c8a85');
    const accent = color('--dr-accent', '#6c8bff');
    const warning = color('--dr-warning', '#f5bf4f');

    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
        `viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" fill="${background}"/>`,
      `<g font-family="JetBrains Mono, Consolas, monospace">`,
    ];

    for (const link of this.links()) {
      const stroke = link.kind === 'suggested' ? warning : accent;
      const dash = link.kind === 'suggested' ? ' stroke-dasharray="6 5"' : '';

      parts.push(
        `<path d="${link.path}" fill="none" stroke="${stroke}" stroke-width="1.5"${dash}/>`,
        `<path d="${link.feet}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`,
        `<path d="${link.bar}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`,
      );

      if (link.optional) {
        parts.push(
          `<circle cx="${link.dotX}" cy="${link.dotY}" r="3.5" fill="${background}" ` +
            `stroke="${stroke}" stroke-width="1.5"/>`,
        );
      }
    }

    for (const box of this.boxes()) {
      parts.push(
        `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" ` +
          `fill="${panel}" stroke="${border}"/>`,
        `<path d="M ${box.x} ${box.y + BOX.header} h ${box.width}" stroke="${border}"/>`,
        `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${BOX.header}" ` +
          `fill="${header}" opacity="0.6"/>`,
        `<text x="${box.x + 10}" y="${box.y + 19}" fill="${text}" font-size="12" ` +
          `font-weight="500">${escapeXml(box.table.name)}</text>`,
      );

      box.columns.forEach((column, index) => {
        const y = box.y + BOX.header + index * BOX.row + 14;
        const mark = column.isPrimaryKey ? 'PK' : column.isForeignKey ? 'FK' : '';

        parts.push(
          `<text x="${box.x + 10}" y="${y}" fill="${column.isPrimaryKey ? warning : soft}" ` +
            `font-size="8.5">${mark}</text>`,
          `<text x="${box.x + 30}" y="${y}" fill="${text}" font-size="11">` +
            `${escapeXml(column.name)}</text>`,
          `<text x="${box.x + box.width - 10}" y="${y}" fill="${soft}" font-size="10" ` +
            `text-anchor="end">${escapeXml(column.dataType)}</text>`,
        );
      });
    }

    parts.push('</g>', '</svg>');

    return parts.join('\n');
  }

  /** Qué tabla tiene el menú abierto, o ninguna. */
  protected readonly menuFor = signal<string | null>(null);

  protected openMenu(event: MouseEvent, box: PaintedBox): void {
    event.preventDefault();
    event.stopPropagation();

    this.menuFor.update((current) => (current === box.key ? null : box.key));
  }

  protected closeMenu(): void {
    this.menuFor.set(null);
  }

  protected menuBox(): PaintedBox | null {
    const key = this.menuFor();

    return key === null ? null : (this.boxes().find((box) => box.key === key) ?? null);
  }

  protected removeFromDiagram(box: PaintedBox): void {
    this.closeMenu();
    this.removeTable.emit(box.key);
  }

  protected showData(box: PaintedBox): void {
    this.closeMenu();
    this.openData.emit(box.table);
  }

  protected design(box: PaintedBox): void {
    this.closeMenu();
    this.openTable.emit(box.table);
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
