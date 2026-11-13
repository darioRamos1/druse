import { ReportColumn, ReportSnapshot, ReportValue } from '../../shared/models/reports';
import { PALETTE, PaletteColor } from './report-chart';

/** Columnas de la cuadrícula: un panel ocupa de 3 a 12. */
export const GRID_COLUMNS = 12;
export const MIN_WIDTH = 3;
/** Filas de la cuadrícula: un panel ocupa de 2 a 8. */
export const MIN_HEIGHT = 2;
export const MAX_HEIGHT = 8;

export interface DashboardPanel {
  readonly id: string;
  readonly reportId: string;
  readonly width: number;
  readonly height: number;
  /** Título propio; `null` usa el nombre del reporte. */
  readonly title: string | null;
  /** Una línea que explica qué se mira; opcional. */
  readonly description: string | null;
  /** Sin título ni descripción a la vista; el panel sigue nombrándose para lectores de pantalla. */
  readonly hideHeader: boolean;
  /** Color propio en este tablero; `null` hereda del reporte, del tablero o del tema. */
  readonly color: PaletteColor | null;
}

export interface DashboardPage {
  readonly id: string;
  readonly name: string;
  readonly panels: readonly DashboardPanel[];
}

export type DashboardFilterKind = 'date' | 'category';

/**
 * Un filtro compartido.
 *
 * Se vincula a una columna **por conjunto de datos**: el mes de las ventas y el
 * de las metas pueden llamarse distinto, y cada panel filtra por la columna de
 * su propio conjunto. Un conjunto sin columna vinculada no se filtra, y su
 * panel lo dice.
 */
export interface DashboardFilter {
  readonly id: string;
  readonly kind: DashboardFilterKind;
  readonly label: string;
  /** datasetId → nombre de columna en su resultado. */
  readonly bindings: Readonly<Record<string, string>>;
}

export interface DashboardStyle {
  /**
   * El color de los paneles que no eligen otro; `null` es el de marca, si el
   * tablero tiene identidad con color, o el acento del tema.
   */
  readonly color: PaletteColor | null;
  /** La identidad de empresa del tablero: logo, datos y color de marca. */
  readonly identityId: string | null;
}

/**
 * Un color de gráfico: un tono de la paleta o el de la marca del tablero.
 *
 * `brand` no lleva el color dentro: el tablero pone sus dos tonos —el claro y
 * el del tema oscuro— en `--rc-brand-light` y `--rc-brand-dark`, y cada
 * gráfico usa el de su tema, como con la paleta.
 */
export type ChartColor = PaletteColor | 'brand';

export interface DashboardModel {
  readonly version: 1;
  readonly pages: readonly DashboardPage[];
  readonly filters: readonly DashboardFilter[];
  readonly style: DashboardStyle;
}

export const DEFAULT_STYLE: DashboardStyle = { color: null, identityId: null };

function paletteColor(value: unknown): PaletteColor | null {
  return PALETTE.includes(value as PaletteColor) ? (value as PaletteColor) : null;
}

/** Lo elegido en un filtro. Sin desde/hasta, o sin valores, no filtra. */
export type FilterValue =
  | { readonly kind: 'date'; readonly from: string | null; readonly to: string | null }
  | { readonly kind: 'category'; readonly values: readonly (string | null)[] };

export function emptyDashboard(pageName: string): DashboardModel {
  return {
    version: 1,
    pages: [{ id: crypto.randomUUID(), name: pageName, panels: [] }],
    filters: [],
    style: DEFAULT_STYLE,
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

/** Lo que llega del JSON guardado, sin dar nada por supuesto. */
type Raw = Record<string, unknown> | null | undefined;

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? (value as Raw[]) : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readPanel(panel: Raw): DashboardPanel | null {
  const reportId = text(panel?.['reportId']);
  const title = text(panel?.['title']);
  const description = text(panel?.['description']);

  return reportId === null
    ? null
    : {
        id: text(panel?.['id']) ?? crypto.randomUUID(),
        reportId,
        width: clamp(panel?.['width'], MIN_WIDTH, GRID_COLUMNS, 6),
        height: clamp(panel?.['height'], MIN_HEIGHT, MAX_HEIGHT, 4),
        title: title?.trim() ? title : null,
        description: description?.trim() ? description : null,
        hideHeader: panel?.['hideHeader'] === true,
        color: paletteColor(panel?.['color']),
      };
}

function readFilter(filter: Raw): DashboardFilter | null {
  const kind = filter?.['kind'];

  if (kind !== 'date' && kind !== 'category') {
    return null;
  }

  const bindings = filter?.['bindings'];

  return {
    id: text(filter?.['id']) ?? crypto.randomUUID(),
    kind,
    label: text(filter?.['label']) ?? '',
    bindings: Object.fromEntries(
      Object.entries(typeof bindings === 'object' && bindings !== null ? bindings : {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  };
}

/** Lee el modelo guardado sin fiarse: un tablero a medias se abre igual. */
export function parseDashboard(json: string, pageName: string): DashboardModel {
  try {
    const raw = JSON.parse(json) as Raw;
    const pages: DashboardPage[] = list(raw?.['pages']).map((page) => ({
      id: text(page?.['id']) ?? crypto.randomUUID(),
      name: text(page?.['name']) ?? pageName,
      panels: list(page?.['panels'])
        .map(readPanel)
        .filter((panel): panel is DashboardPanel => panel !== null),
    }));
    const filters = list(raw?.['filters'])
      .map(readFilter)
      .filter((filter): filter is DashboardFilter => filter !== null);

    const rawStyle = raw?.['style'] as Raw;
    const style: DashboardStyle = {
      color: paletteColor(rawStyle?.['color']),
      // Los tableros de antes de la 1.26 no tienen identidad.
      identityId: text(rawStyle?.['identityId']) ?? null,
    };

    return pages.length > 0
      ? { version: 1, pages, filters, style }
      : { ...emptyDashboard(pageName), filters, style };
  } catch {
    return emptyDashboard(pageName);
  }
}

function updatePage(
  model: DashboardModel,
  pageId: string,
  change: (panels: readonly DashboardPanel[]) => readonly DashboardPanel[],
): DashboardModel {
  return {
    ...model,
    pages: model.pages.map((page) =>
      page.id === pageId ? { ...page, panels: change(page.panels) } : page,
    ),
  };
}

export function addPanel(model: DashboardModel, pageId: string, reportId: string): DashboardModel {
  return updatePage(model, pageId, (panels) => [
    ...panels,
    {
      id: crypto.randomUUID(),
      reportId,
      width: 6,
      height: 4,
      title: null,
      description: null,
      hideHeader: false,
      color: null,
    },
  ]);
}

/** Añade al final de una página paneles ya hechos, como los de una plantilla. */
export function insertPanels(
  model: DashboardModel,
  pageId: string,
  added: readonly DashboardPanel[],
): DashboardModel {
  return updatePage(model, pageId, (panels) => [...panels, ...added]);
}

export function removePanel(
  model: DashboardModel,
  pageId: string,
  panelId: string,
): DashboardModel {
  return updatePage(model, pageId, (panels) => panels.filter((panel) => panel.id !== panelId));
}

/** Cambia el orden: la cuadrícula coloca los paneles en ese orden, de izquierda a derecha. */
export function movePanel(
  model: DashboardModel,
  pageId: string,
  panelId: string,
  delta: number,
): DashboardModel {
  return updatePage(model, pageId, (panels) => {
    const from = panels.findIndex((panel) => panel.id === panelId);
    const to = Math.min(panels.length - 1, Math.max(0, from + delta));

    if (from < 0 || from === to) {
      return panels;
    }

    const next = [...panels];
    const [moved] = next.splice(from, 1);

    next.splice(to, 0, moved);
    return next;
  });
}

export function resizePanel(
  model: DashboardModel,
  pageId: string,
  panelId: string,
  width: number,
  height: number,
): DashboardModel {
  return updatePage(model, pageId, (panels) =>
    panels.map((panel) =>
      panel.id === panelId
        ? {
            ...panel,
            width: clamp(panel.width + width, MIN_WIDTH, GRID_COLUMNS, panel.width),
            height: clamp(panel.height + height, MIN_HEIGHT, MAX_HEIGHT, panel.height),
          }
        : panel,
    ),
  );
}

export function retitlePanel(
  model: DashboardModel,
  pageId: string,
  panelId: string,
  title: string,
): DashboardModel {
  return updatePage(model, pageId, (panels) =>
    panels.map((panel) =>
      panel.id === panelId ? { ...panel, title: title.trim() ? title : null } : panel,
    ),
  );
}

const DATE_TYPES = new Set(['DateOnly', 'DateTime', 'DateTimeOffset']);

export function fitsFilter(kind: DashboardFilterKind, column: ReportColumn): boolean {
  return kind === 'date' ? DATE_TYPES.has(column.clrType) : column.clrType === 'String';
}

/** El nombre sin el prefijo del cruce: `izquierda.mes` y `mes` hablan de lo mismo. */
function baseName(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}

/**
 * La columna que se propone vincular en un conjunto.
 *
 * Se prefiere la que se llama como las ya vinculadas en otros conjuntos —el
 * «mes» de las ventas para el «mes» de las metas— y si no, la primera del tipo.
 */
export function proposeBinding(
  filter: DashboardFilter,
  columns: readonly ReportColumn[],
): string | null {
  const candidates = columns.filter((column) => fitsFilter(filter.kind, column));
  const hints = new Set(Object.values(filter.bindings).map(baseName));

  return (
    (candidates.find((column) => hints.has(baseName(column.name))) ?? candidates[0])?.name ?? null
  );
}

export function isActive(value: FilterValue | undefined): boolean {
  if (!value) {
    return false;
  }

  return value.kind === 'date' ? value.from !== null || value.to !== null : value.values.length > 0;
}

function categoryKey(value: ReportValue): string | null {
  return value === null ? null : String(value);
}

export interface FilteredSnapshot {
  readonly snapshot: ReportSnapshot;
  /** Filtros activos que este conjunto no puede aplicar: no tiene columna vinculada. */
  readonly unbound: readonly string[];
}

/**
 * Aplica los filtros activos al resultado guardado de un conjunto.
 *
 * Se filtra sobre las filas guardadas, sin volver a consultar: es lo que
 * permite filtrar un tablero con las bases apagadas.
 */
export function applyFilters(
  snapshot: ReportSnapshot,
  datasetId: string,
  filters: readonly DashboardFilter[],
  values: ReadonlyMap<string, FilterValue>,
): FilteredSnapshot {
  const unbound: string[] = [];
  const tests: ((row: readonly ReportValue[]) => boolean)[] = [];

  for (const filter of filters) {
    const value = values.get(filter.id);

    if (!isActive(value)) {
      continue;
    }

    const name = filter.bindings[datasetId];
    const ordinal = name ? snapshot.columns.findIndex((column) => column.name === name) : -1;

    if (ordinal < 0) {
      unbound.push(filter.label);
      continue;
    }

    if (value!.kind === 'date') {
      // Fechas en ISO: compararlas como texto por el día ya es compararlas en el tiempo.
      const { from, to } = value!;

      tests.push((row) => {
        const cell = row[ordinal];
        const day = cell === null ? null : String(cell).slice(0, 10);

        return day !== null && (from === null || day >= from) && (to === null || day <= to);
      });
    } else {
      const chosen = new Set(value!.values);

      tests.push((row) => chosen.has(categoryKey(row[ordinal])));
    }
  }

  return {
    snapshot:
      tests.length === 0
        ? snapshot
        : { ...snapshot, rows: snapshot.rows.filter((row) => tests.every((test) => test(row))) },
    unbound,
  };
}

/** Los valores que ofrece un filtro de categoría: los de todas sus columnas vinculadas. */
export function categoryOptions(
  filter: DashboardFilter,
  snapshots: ReadonlyMap<string, ReportSnapshot>,
): readonly (string | null)[] {
  const values = new Set<string | null>();

  for (const [datasetId, column] of Object.entries(filter.bindings)) {
    const snapshot = snapshots.get(datasetId);
    const ordinal = snapshot ? snapshot.columns.findIndex((item) => item.name === column) : -1;

    if (snapshot && ordinal >= 0) {
      for (const row of snapshot.rows) {
        values.add(categoryKey(row[ordinal]));
      }
    }
  }

  return [...values].sort((a, b) =>
    a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0,
  );
}

/** Cambia campos de estilo de un panel: descripción, encabezado o color. */
export function patchPanel(
  model: DashboardModel,
  pageId: string,
  panelId: string,
  patch: Partial<Pick<DashboardPanel, 'description' | 'hideHeader' | 'color'>>,
): DashboardModel {
  return updatePage(model, pageId, (panels) =>
    panels.map((panel) => (panel.id === panelId ? { ...panel, ...patch } : panel)),
  );
}

export function addPage(model: DashboardModel, name: string): DashboardModel {
  return { ...model, pages: [...model.pages, { id: crypto.randomUUID(), name, panels: [] }] };
}

export function renamePage(model: DashboardModel, pageId: string, name: string): DashboardModel {
  return {
    ...model,
    pages: model.pages.map((page) => (page.id === pageId ? { ...page, name } : page)),
  };
}

/**
 * Quita una página. Sus paneles pasan a la primera de las que quedan: borrar
 * una página no borra reportes de nadie, y deshacerlo es moverlos de vuelta.
 */
export function removePage(model: DashboardModel, pageId: string): DashboardModel {
  if (model.pages.length <= 1) {
    return model;
  }

  const removed = model.pages.find((page) => page.id === pageId);
  const rest = model.pages.filter((page) => page.id !== pageId);

  return {
    ...model,
    pages: rest.map((page, index) =>
      index === 0 && removed ? { ...page, panels: [...page.panels, ...removed.panels] } : page,
    ),
  };
}

/** Lleva un panel al final de otra página. */
export function movePanelToPage(
  model: DashboardModel,
  panelId: string,
  pageId: string,
): DashboardModel {
  const panel = model.pages.flatMap((page) => page.panels).find((item) => item.id === panelId);

  if (!panel || !model.pages.some((page) => page.id === pageId)) {
    return model;
  }

  return {
    ...model,
    pages: model.pages.map((page) => ({
      ...page,
      panels:
        page.id === pageId
          ? [...page.panels.filter((item) => item.id !== panelId), panel]
          : page.panels.filter((item) => item.id !== panelId),
    })),
  };
}

export type ColorSource = 'panel' | 'report' | 'dashboard' | 'brand' | 'theme';

/**
 * El color con que se pinta un panel y de dónde viene.
 *
 * Gana lo más concreto: el panel en este tablero, después el reporte, después
 * el tablero, después la marca de su identidad y, si nada de eso hay, el acento
 * del tema. La interfaz enseña el origen para que se sepa qué se está heredando
 * y qué se puede restablecer.
 */
export function resolveColor(
  panel: DashboardPanel,
  reportColor: PaletteColor | null,
  style: DashboardStyle,
  hasBrand = false,
): { readonly color: ChartColor | null; readonly source: ColorSource } {
  if (panel.color) return { color: panel.color, source: 'panel' };
  if (reportColor) return { color: reportColor, source: 'report' };
  if (style.color) return { color: style.color, source: 'dashboard' };
  if (hasBrand) return { color: 'brand', source: 'brand' };
  return { color: null, source: 'theme' };
}
