import { ReportColumn, ReportSnapshot, ReportValue, ReportVisualKind } from '../../shared/models/reports';

export type ReportAggregate = 'Sum' | 'Count' | 'Average' | 'Min' | 'Max';
export type ReportSort = 'category' | 'valueDesc';

/**
 * Lo que guarda un reporte en `settings`.
 *
 * Los campos se nombran como los devuelve el resultado guardado
 * (`izquierda.mes`, `derecha.meta`…): así el reporte no depende del alias,
 * que se puede renombrar sin romper nada.
 */
export interface ReportSettings {
  /** Eje de categorías en barras y líneas. */
  readonly category: string | null;
  /** La cifra: lo que se agrega en barras, líneas e indicador. */
  readonly value: string | null;
  readonly aggregate: ReportAggregate;
  /** Solo indicador: la meta contra la que se compara. */
  readonly target: string | null;
  /** Solo tabla: columnas a mostrar; vacío es todas. */
  readonly columns: readonly string[];
  readonly sort: ReportSort;
}

export const AGGREGATES: readonly ReportAggregate[] = ['Sum', 'Count', 'Average', 'Min', 'Max'];

const NUMERIC = new Set(['Byte', 'Int16', 'Int32', 'Int64', 'Single', 'Double', 'Decimal']);

export function isNumericColumn(column: ReportColumn): boolean {
  return NUMERIC.has(column.clrType);
}

/** Lo razonable para empezar: la primera columna que no es número y la primera que sí. */
export function defaultSettings(visual: ReportVisualKind, columns: readonly ReportColumn[]): ReportSettings {
  const numbers = columns.filter(isNumericColumn);
  const category = columns.find((column) => !isNumericColumn(column))?.name ?? null;

  return {
    category: visual === 'Bar' || visual === 'Line' ? category : null,
    value: visual === 'Table' ? null : (numbers[0]?.name ?? null),
    aggregate: 'Sum',
    target: visual === 'Indicator' ? (numbers[1]?.name ?? null) : null,
    columns: [],
    sort: 'category',
  };
}

/** Lee los ajustes guardados sin fiarse: un JSON a medias no rompe el reporte. */
export function parseSettings(json: string, visual: ReportVisualKind, columns: readonly ReportColumn[]): ReportSettings {
  const base = defaultSettings(visual, columns);

  try {
    const stored = JSON.parse(json) as Partial<ReportSettings>;

    return {
      category: typeof stored.category === 'string' ? stored.category : base.category,
      value: typeof stored.value === 'string' ? stored.value : base.value,
      aggregate: AGGREGATES.includes(stored.aggregate as ReportAggregate)
        ? (stored.aggregate as ReportAggregate)
        : base.aggregate,
      target: typeof stored.target === 'string' ? stored.target : null,
      columns: Array.isArray(stored.columns) ? stored.columns.filter((c) => typeof c === 'string') : [],
      sort: stored.sort === 'valueDesc' ? 'valueDesc' : 'category',
    };
  } catch {
    return base;
  }
}

function toNumber(value: ReportValue): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return null;
}

function aggregate(values: readonly number[], how: ReportAggregate, rows: number): number | null {
  if (how === 'Count') {
    return rows;
  }

  if (values.length === 0) {
    return null;
  }

  switch (how) {
    case 'Sum':
      return values.reduce((total, value) => total + value, 0);
    case 'Average':
      return values.reduce((total, value) => total + value, 0) / values.length;
    case 'Min':
      return Math.min(...values);
    case 'Max':
      return Math.max(...values);
  }
}

export interface SeriesPoint {
  /** `null` es la categoría vacía: se traduce al pintarla. */
  readonly label: string | null;
  readonly value: number;
}

export interface Series {
  readonly points: readonly SeriesPoint[];
  /** Columnas elegidas que el resultado ya no tiene (la definición cambió). */
  readonly missing: readonly string[];
}

function ordinal(snapshot: ReportSnapshot, name: string | null): number {
  return name === null ? -1 : snapshot.columns.findIndex((column) => column.name === name);
}

/** Agrupa por la categoría y agrega la cifra, para barras y líneas. */
export function buildSeries(snapshot: ReportSnapshot, settings: ReportSettings): Series {
  const category = ordinal(snapshot, settings.category);
  const value = ordinal(snapshot, settings.value);
  const missing = [
    ...(category < 0 && settings.category ? [settings.category] : []),
    ...(value < 0 && settings.value ? [settings.value] : []),
  ];

  if (category < 0 || (value < 0 && settings.aggregate !== 'Count')) {
    return { points: [], missing };
  }

  const groups = new Map<string | null, { values: number[]; rows: number }>();

  for (const row of snapshot.rows) {
    const raw = row[category];
    const label = raw === null ? null : String(raw);
    const group = groups.get(label) ?? { values: [], rows: 0 };
    const number = value < 0 ? null : toNumber(row[value]);

    group.rows++;
    if (number !== null) group.values.push(number);
    groups.set(label, group);
  }

  const points = [...groups.entries()].flatMap(([label, group]) => {
    const result = aggregate(group.values, settings.aggregate, group.rows);

    return result === null ? [] : [{ label, value: result }];
  });

  // Las fechas llegan en ISO y los códigos como texto: el orden de texto ya es
  // el cronológico y respeta los ceros iniciales. La categoría vacía, al final.
  points.sort((a, b) =>
    settings.sort === 'valueDesc'
      ? b.value - a.value
      : a.label === null
        ? 1
        : b.label === null
          ? -1
          : a.label < b.label
            ? -1
            : a.label > b.label
              ? 1
              : 0,
  );

  return { points, missing };
}

export interface Indicator {
  readonly value: number | null;
  /** Con meta: la suma de la meta en las filas que la tienen. */
  readonly target: number | null;
  /** value / target, o `null` sin meta o con meta cero. */
  readonly ratio: number | null;
  readonly zeroTarget: boolean;
  /** Filas con cifra pero sin meta: quedan fuera del cumplimiento y se dice. */
  readonly withoutTarget: number;
  readonly missing: readonly string[];
}

/**
 * La cifra del indicador y, con meta, su cumplimiento.
 *
 * El cumplimiento compara solo las filas que tienen meta: con ventas de 80,
 * 100 y 40 y metas de 100 y 200 (la tercera sin meta) da (80 + 100) / 300 =
 * 60 %, y la fila sin meta se cuenta aparte en vez de rebajar el porcentaje.
 */
export function buildIndicator(snapshot: ReportSnapshot, settings: ReportSettings): Indicator {
  const value = ordinal(snapshot, settings.value);
  const target = ordinal(snapshot, settings.target);
  const missing = [
    ...(value < 0 && settings.value ? [settings.value] : []),
    ...(target < 0 && settings.target ? [settings.target] : []),
  ];

  if (value < 0 && settings.aggregate !== 'Count') {
    return { value: null, target: null, ratio: null, zeroTarget: false, withoutTarget: 0, missing };
  }

  if (target < 0) {
    const numbers = snapshot.rows.flatMap((row) => {
      const number = value < 0 ? null : toNumber(row[value]);

      return number === null ? [] : [number];
    });

    return {
      value: aggregate(numbers, settings.aggregate, snapshot.rows.length),
      target: null,
      ratio: null,
      zeroTarget: false,
      withoutTarget: 0,
      missing,
    };
  }

  let achieved = 0;
  let goal = 0;
  let withoutTarget = 0;

  for (const row of snapshot.rows) {
    const number = toNumber(row[value]);
    const meta = toNumber(row[target]);

    if (meta === null) {
      if (number !== null) withoutTarget++;
      continue;
    }

    achieved += number ?? 0;
    goal += meta;
  }

  return {
    value: achieved,
    target: goal,
    ratio: goal === 0 ? null : achieved / goal,
    zeroTarget: goal === 0 && snapshot.rows.some((row) => toNumber(row[target]) !== null),
    withoutTarget,
    missing,
  };
}

/**
 * Columnas del lado «uno» que este reporte sumaría repetidas.
 *
 * En un cruce 1:N la meta mensual aparece en cada venta diaria; sumarla la
 * multiplica. Contar o tomar el máximo no engaña, sumar y promediar sí.
 */
export function repeatedInUse(snapshot: ReportSnapshot, settings: ReportSettings): readonly string[] {
  const summed = settings.aggregate === 'Sum' || settings.aggregate === 'Average' ? [settings.value] : [];
  const used = [...summed, settings.target].filter((name): name is string => name !== null);

  return used.filter((name) => snapshot.repeatedColumns.includes(name));
}

/** Las columnas y filas de la tabla, en el orden elegido. */
export function tableView(
  snapshot: ReportSnapshot,
  settings: ReportSettings,
): { readonly columns: readonly ReportColumn[]; readonly rows: readonly (readonly ReportValue[])[] } {
  const chosen = settings.columns
    .map((name) => snapshot.columns.find((column) => column.name === name))
    .filter((column): column is ReportColumn => column !== undefined);
  const columns = chosen.length > 0 ? chosen : snapshot.columns;
  const positions = columns.map((column) => snapshot.columns.indexOf(column));

  return {
    columns: columns.map((column, i) => ({ ...column, ordinal: i })),
    rows: snapshot.rows.map((row) => positions.map((position) => row[position])),
  };
}
