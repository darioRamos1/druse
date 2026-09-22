import {
  DatabaseColumn,
  DatabaseObject,
  SuggestedRelation,
  TableDetail,
} from '../../shared/models/workspace';
import { compareText } from '../../core/i18n/locale-format';

/**
 * Cuánto se enseña de cada tabla.
 *
 * Lo que se necesita con el zoom encima de una tabla no es lo que se necesita
 * mirando ochenta, así que el nivel cambia el alto de la caja y con él la
 * colocación entera.
 */
export type DetailLevel = 'full' | 'keys' | 'collapsed';

/** Medidas de la caja. Salen del diseño y del `_tokens.scss` de la aplicación. */
export const BOX = {
  width: 218,
  header: 30,
  row: 21,
  gapX: 112,
  gapY: 44,
  marginX: 24,
  marginY: 40,
} as const;

/** Una columna tal y como se dibuja dentro de la caja. */
export interface DiagramColumn {
  readonly name: string;
  readonly dataType: string;
  readonly isPrimaryKey: boolean;
  readonly isForeignKey: boolean;
  readonly isNullable: boolean;
}

/** Una tabla colocada en el lienzo. */
export interface DiagramBox {
  /** Esquema y nombre, que es lo que identifica una tabla dentro de una base. */
  readonly key: string;
  readonly table: DatabaseObject;
  readonly columns: readonly DiagramColumn[];
  /** Toda su clave primaria son claves foráneas: une dos tablas y nada más. */
  readonly isBridge: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Una relación entre dos cajas, con el trazo ya resuelto. */
export interface DiagramLink {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly column: string;
  /** Declarada por el motor, o supuesta por Druse (fase D). */
  readonly kind: 'declared' | 'suggested';
  /** Alguna columna de la clave admite nulos: el extremo lleva círculo. */
  readonly optional: boolean;
  /** El camino ortogonal entre las dos cajas. */
  readonly path: string;
  /** Pata de gallo, en el lado de «muchos». */
  readonly feet: string;
  /** Barra perpendicular, en el lado de «uno». */
  readonly bar: string;
  readonly dotX: number;
  readonly dotY: number;
}

/** Lo que hay que dibujar, ya medido. */
export interface DiagramLayout {
  readonly boxes: readonly DiagramBox[];
  readonly links: readonly DiagramLink[];
  readonly width: number;
  readonly height: number;
}

/** Esquema y nombre. Dos tablas del mismo nombre en esquemas distintos son dos. */
export function tableKey(table: { schema?: string; name: string }): string {
  return `${table.schema ?? ''}.${table.name}`;
}

/** Las columnas que se ven en cada nivel de detalle. */
export function visibleColumns(detail: TableDetail, level: DetailLevel): readonly DiagramColumn[] {
  if (level === 'collapsed') {
    return [];
  }

  const foreign = new Set<string>();

  for (const key of detail.structure.foreignKeys) {
    for (const column of key.columns) {
      foreign.add(column.toLowerCase());
    }
  }

  const mapped = detail.columns.map((column: DatabaseColumn) => ({
    name: column.name,
    dataType: column.dataType,
    isPrimaryKey: column.isPrimaryKey === true,
    isForeignKey: foreign.has(column.name.toLowerCase()),
    isNullable: column.isNullable,
  }));

  return level === 'keys'
    ? mapped.filter((column) => column.isPrimaryKey || column.isForeignKey)
    : mapped;
}

/** Toda la clave primaria son claves foráneas: es una tabla puente. */
function isBridge(detail: TableDetail): boolean {
  const primary = detail.structure.primaryKey?.columns ?? [];

  if (primary.length < 2) {
    return false;
  }

  const foreign = new Set<string>();

  for (const key of detail.structure.foreignKeys) {
    for (const column of key.columns) {
      foreign.add(column.toLowerCase());
    }
  }

  return primary.every((column) => foreign.has(column.toLowerCase()));
}

function height(columns: number): number {
  return BOX.header + columns * BOX.row;
}

/**
 * En qué capa va cada tabla.
 *
 * Una tabla que no apunta a nadie es una raíz; las demás van una capa más allá
 * de la más lejana a la que apuntan. Las auto-referencias se ignoran —una tabla
 * no puede estar en una capa posterior a sí misma— y los ciclos se cortan al
 * llegar al número de tablas, que es la profundidad máxima posible: sin ese
 * tope, dos tablas que se apuntan entre sí colgarían la pantalla.
 */
function levels(
  keys: readonly string[],
  parents: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const level = new Map<string, number>(keys.map((key) => [key, 0]));

  for (let pass = 0; pass < keys.length; pass++) {
    let changed = false;

    for (const key of keys) {
      const own = parents.get(key) ?? new Set<string>();
      let deepest = 0;

      for (const parent of own) {
        if (parent === key || !level.has(parent)) {
          continue;
        }

        deepest = Math.max(deepest, (level.get(parent) ?? 0) + 1);
      }

      if (deepest !== level.get(key)) {
        level.set(key, deepest);
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return level;
}

/**
 * Coloca las tablas y resuelve el trazo de cada relación.
 *
 * Es **determinista**: el mismo esquema sale siempre igual. No es un capricho —
 * un diagrama que se recoloca solo en cada apertura no se puede comparar consigo
 * mismo, y quien lo mire no reconocerá lo que vio ayer.
 */
export function layoutDiagram(
  tables: readonly TableDetail[],
  level: DetailLevel,
  positions: ReadonlyMap<string, { x: number; y: number }> = new Map(),
  available = 760,
  suggestions: readonly SuggestedRelation[] = [],
): DiagramLayout {
  const details = new Map<string, TableDetail>();

  for (const detail of tables) {
    details.set(tableKey(detail.table), detail);
  }

  const keys = [...details.keys()].sort(compareText);
  const parents = new Map<string, Set<string>>();

  for (const key of keys) {
    parents.set(key, new Set<string>());
  }

  // Una clave foránea apunta al padre; el destino puede no estar en el lienzo.
  for (const key of keys) {
    const detail = details.get(key);
    if (!detail) {
      continue;
    }

    for (const foreign of detail.structure.foreignKeys) {
      const target = tableKey({
        schema: foreign.referencedSchema ?? detail.table.schema,
        name: foreign.referencedTable,
      });

      if (details.has(target)) {
        parents.get(key)?.add(target);
      }
    }
  }

  const depth = levels(keys, parents);
  const byLevel = new Map<number, string[]>();

  for (const key of keys) {
    const own = depth.get(key) ?? 0;
    const row = byLevel.get(own) ?? [];
    row.push(key);
    byLevel.set(own, row);
  }

  // Dentro de cada capa, el orden lo decide el baricentro de los vecinos ya
  // colocados. Empata por nombre, que es lo que lo hace determinista.
  const order = new Map<string, number>();
  const boxes: DiagramBox[] = [];
  const columnsOf = new Map<string, readonly DiagramColumn[]>();

  for (const key of keys) {
    const detail = details.get(key);
    columnsOf.set(key, detail ? visibleColumns(detail, level) : []);
  }

  const depths = [...byLevel.keys()].sort((a, b) => a - b);

  /**
   * Dónde empieza la capa que se está colocando.
   *
   * No es `capa × ancho` porque **una capa puede ocupar varias columnas**: una
   * base sin claves foráneas declaradas —MyISAM, y tantas heredadas— tiene todas
   * sus tablas en la capa cero, y en una sola columna serían una tira vertical
   * de miles de píxeles. Cuando la capa no cabe de alto, sigue al lado.
   */
  let columnX: number = BOX.marginX;

  for (const own of depths) {
    const row = (byLevel.get(own) ?? []).slice().sort((a, b) => {
      const barycenter = (key: string): number => {
        const own = [...(parents.get(key) ?? [])]
          .map((parent) => order.get(parent))
          .filter((value): value is number => value !== undefined);

        return own.length === 0
          ? Number.POSITIVE_INFINITY
          : own.reduce((total, value) => total + value, 0) / own.length;
      };

      const difference = barycenter(a) - barycenter(b);

      return difference !== 0 && Number.isFinite(difference) ? difference : compareText(a, b);
    });

    let y: number = BOX.marginY;
    let x = columnX;
    let widest = columnX;

    for (const [index, key] of row.entries()) {
      order.set(key, index);

      const columns = columnsOf.get(key) ?? [];
      const detail = details.get(key);
      const box = height(columns.length);
      const fixed = positions.get(key);

      // Salta de columna cuando la que hay no da más de sí, salvo con la
      // primera caja: una tabla más alta que la ventana tiene que empezar
      // igualmente en algún sitio.
      if (y > BOX.marginY && y + box > available) {
        x += BOX.width + BOX.gapX;
        y = BOX.marginY;
      }

      boxes.push({
        key,
        table: detail?.table ?? { id: key, name: key, kind: 'table', hasChildren: false },
        columns,
        isBridge: detail ? isBridge(detail) : false,
        x: fixed?.x ?? x,
        y: fixed?.y ?? y,
        width: BOX.width,
        height: box,
      });

      y += box + BOX.gapY;
      widest = Math.max(widest, x);
    }

    columnX = widest + BOX.width + BOX.gapX;
  }

  const placed = new Map(boxes.map((box) => [box.key, box]));
  const links: DiagramLink[] = [];

  for (const key of keys) {
    const detail = details.get(key);
    const child = placed.get(key);
    if (!detail || !child) {
      continue;
    }

    const nullable = new Set(
      detail.columns
        .filter((column) => column.isNullable)
        .map((column) => column.name.toLowerCase()),
    );

    for (const foreign of detail.structure.foreignKeys) {
      const targetKey = tableKey({
        schema: foreign.referencedSchema ?? detail.table.schema,
        name: foreign.referencedTable,
      });

      const parent = placed.get(targetKey);
      if (!parent) {
        continue;
      }

      links.push(
        link({
          id: foreign.name,
          child,
          parent,
          column: foreign.columns[0] ?? '',
          columns: columnsOf.get(key) ?? [],
          parentColumns: columnsOf.get(targetKey) ?? [],
          parentColumn: foreign.referencedColumns[0] ?? '',
          kind: 'declared',
          optional: foreign.columns.some((column) => nullable.has(column.toLowerCase())),
        }),
      );
    }
  }

  // Las supuestas se trazan igual que las declaradas y se distinguen por
  // `kind`: el trazo es el mismo problema geométrico, y lo que cambia —color,
  // línea punteada, leyenda— es cosa de quien pinta.
  for (const suggestion of suggestions) {
    const child = placed.get(
      tableKey({ schema: suggestion.fromSchema, name: suggestion.fromTable }),
    );
    const parent = placed.get(tableKey({ schema: suggestion.toSchema, name: suggestion.toTable }));

    if (!child || !parent) {
      continue;
    }

    const nullable = child.columns.find(
      (column) => column.name.toLowerCase() === suggestion.column.toLowerCase(),
    )?.isNullable;

    links.push(
      link({
        id: `~${suggestion.fromTable}.${suggestion.column}`,
        child,
        parent,
        column: suggestion.column,
        columns: child.columns,
        parentColumns: parent.columns,
        parentColumn: suggestion.referencedColumn,
        kind: 'suggested',
        // Nadie la comprueba, así que la opcionalidad es la de la columna.
        optional: nullable ?? true,
      }),
    );
  }

  const width = Math.max(...boxes.map((box) => box.x + box.width), 0) + BOX.marginX;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height), 0) + BOX.marginY;

  return { boxes, links, width, height: bottom };
}

/** La y del centro de una columna, o la del centro de la caja si no se ve. */
function rowY(box: DiagramBox, columns: readonly DiagramColumn[], column: string): number {
  const index = columns.findIndex(
    (candidate) => candidate.name.toLowerCase() === column.toLowerCase(),
  );

  return index < 0 ? box.y + box.height / 2 : box.y + BOX.header + index * BOX.row + BOX.row / 2;
}

/**
 * El trazo de una relación: sale por un costado y entra por el otro.
 *
 * Siempre horizontal a la salida y a la entrada, que es lo que permite dibujar
 * la pata de gallo y la barra sin calcular ángulos.
 */
function link(input: {
  id: string;
  child: DiagramBox;
  parent: DiagramBox;
  column: string;
  columns: readonly DiagramColumn[];
  parentColumns: readonly DiagramColumn[];
  parentColumn: string;
  kind: 'declared' | 'suggested';
  optional: boolean;
}): DiagramLink {
  const { child, parent } = input;

  // Auto-referencia: sale y vuelve por el mismo costado.
  if (child.key === parent.key) {
    const y1 = rowY(child, input.columns, input.column);
    const y2 = child.y + 15;
    const edge = child.x + child.width;
    const out = edge + 34;

    return {
      id: input.id,
      from: child.key,
      to: parent.key,
      column: input.column,
      kind: input.kind,
      optional: input.optional,
      path: `M ${edge + 12} ${y1} H ${out} V ${y2} H ${edge + 12}`,
      feet: `M ${edge + 12} ${y1} L ${edge} ${y1 - 6} M ${edge + 12} ${y1} L ${edge} ${y1} M ${edge + 12} ${y1} L ${edge} ${y1 + 6}`,
      bar: `M ${edge + 6} ${y2 - 5} V ${y2 + 5}`,
      dotX: edge + 12,
      dotY: y2,
    };
  }

  const rightwards = parent.x > child.x;
  const exit = rightwards ? child.x + child.width : child.x;
  const enter = rightwards ? parent.x : parent.x + parent.width;
  const way = rightwards ? 1 : -1;

  const y1 = rowY(child, input.columns, input.column);
  const y2 = rowY(parent, input.parentColumns, input.parentColumn);

  const sx = exit + way * 12;
  const ex = enter - way * 12;
  const mx = (sx + ex) / 2;

  return {
    id: input.id,
    from: child.key,
    to: parent.key,
    column: input.column,
    kind: input.kind,
    optional: input.optional,
    path: `M ${sx} ${y1} H ${mx} V ${y2} H ${ex}`,
    feet: `M ${sx} ${y1} L ${exit} ${y1 - 6} M ${sx} ${y1} L ${exit} ${y1} M ${sx} ${y1} L ${exit} ${y1 + 6}`,
    bar: `M ${ex + way * 6} ${y2 - 5} V ${y2 + 5}`,
    dotX: ex,
    dotY: y2,
  };
}

/**
 * Las vecinas directas de una tabla, que son las que quedan encendidas al
 * marcarla. Sin selección no se apaga nada.
 */
export function neighbours(
  links: readonly DiagramLink[],
  selected: string | null,
): ReadonlySet<string> | null {
  if (selected === null) {
    return null;
  }

  const near = new Set<string>([selected]);

  for (const link of links) {
    if (link.from === selected) {
      near.add(link.to);
    }
    if (link.to === selected) {
      near.add(link.from);
    }
  }

  return near;
}
