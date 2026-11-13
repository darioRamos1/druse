import {
  ReportColumn,
  ReportDataset,
  ReportIdentity,
  ReportIdentityLogo,
  ReportTemplateScope,
  ReportVisualKind,
  SavedReport,
} from '../../shared/models/reports';
import {
  PALETTE,
  PaletteColor,
  ReportSettings,
  isNumericColumn,
  parseSettings,
} from './report-chart';
import {
  DashboardFilter,
  DashboardModel,
  DashboardPage,
  DashboardStyle,
  GRID_COLUMNS,
  MAX_HEIGHT,
  MIN_HEIGHT,
  MIN_WIDTH,
} from './report-dashboard-model';

/**
 * Plantillas de Reportes BI.
 *
 * Una plantilla es **diseño sin datos**: los reportes con su apariencia, la
 * distribución de los paneles y los filtros, con las columnas sustituidas por
 * campos lógicos («ventas», «mes»). Al aplicarla, cada campo se vincula a una
 * columna del conjunto que elija quien la usa, y se crea una copia
 * independiente: cambiar la plantilla después no toca las copias ya hechas.
 *
 * Nunca lleva SQL, conexiones, bases ni filas. Por eso se puede exportar a un
 * archivo y dársela a otra persona: cada cual la aplica a sus propios datos.
 *
 * La identidad de la empresa (logo y datos) solo viaja si quien guarda la
 * plantilla lo pide, y solo en las de tablero: ver `TemplateIdentity`.
 */

export const TEMPLATE_FORMAT = 'druse.report-template';
export const TEMPLATE_VERSION = 1;
/** Lo mismo que acepta el servidor: un diseño no necesita más. */
export const MAX_TEMPLATE_BYTES = 512 * 1024;

const MAX_SLOTS = 8;
const MAX_FIELDS = 200;
const MAX_REPORTS = 60;
const MAX_PAGES = 20;
const MAX_PANELS = 120;
const MAX_FILTERS = 20;

/** Lo que un campo espera de la columna a la que se vincule. */
export type FieldKind = 'number' | 'date' | 'text' | 'boolean' | 'other';
const FIELD_KINDS: readonly FieldKind[] = ['number', 'date', 'text', 'boolean', 'other'];

const VISUALS: readonly ReportVisualKind[] = ['Table', 'Bar', 'Line', 'Indicator'];
const SCOPES: readonly ReportTemplateScope[] = ['Report', 'Panel', 'Dashboard'];

/**
 * Un conjunto de datos de la plantilla, sin decir cuál.
 *
 * Un tablero puede mezclar reportes de dos conjuntos (ventas y gastos): cada
 * uno es un hueco que se rellena con un conjunto propio al aplicarla.
 */
export interface TemplateSlot {
  /** El nombre del conjunto original, como pista; no se usa para vincular. */
  readonly label: string;
}

export interface TemplateField {
  readonly id: string;
  readonly slot: number;
  /** El nombre de la columna original: se usa para proponer la vinculación. */
  readonly name: string;
  readonly kind: FieldKind;
  /** Sin él, algún reporte no tiene qué dibujar. Los opcionales (una meta) pueden quedar sin vincular. */
  readonly required: boolean;
}

export interface TemplateReport {
  readonly key: string;
  readonly slot: number;
  readonly name: string;
  readonly visual: ReportVisualKind;
  /** Los ajustes del reporte con los nombres de columna cambiados por ids de campo. */
  readonly settings: ReportSettings;
}

export interface TemplatePanel {
  readonly report: string;
  readonly width: number;
  readonly height: number;
  readonly title: string | null;
  readonly description: string | null;
  readonly hideHeader: boolean;
  readonly color: PaletteColor | null;
}

export interface TemplatePage {
  readonly name: string;
  readonly panels: readonly TemplatePanel[];
}

export interface TemplateFilter {
  readonly kind: 'date' | 'category';
  readonly label: string;
  /** Hueco (como texto) → id de campo. */
  readonly bindings: Readonly<Record<string, string>>;
}

export interface TemplateLayout {
  readonly pages: readonly TemplatePage[];
  readonly filters: readonly TemplateFilter[];
  readonly style: DashboardStyle;
}

/**
 * La identidad de empresa incluida a propósito en una plantilla de tablero.
 *
 * Lleva su id para reconocerla: aplicada en el mismo perfil se usa la que ya
 * hay; en otro, se crea con ese mismo id, así que aplicar la plantilla dos
 * veces no la duplica. El logo va dentro, en base64, y cuenta para el límite
 * de tamaño de la plantilla.
 */
export interface TemplateIdentity {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string | null;
  readonly details: readonly string[];
  readonly footer: string | null;
  readonly brandColor: string | null;
  readonly logoOnWhite: boolean;
  readonly logo: { readonly contentType: string; readonly data: string } | null;
}

export interface TemplateDocument {
  readonly format: typeof TEMPLATE_FORMAT;
  readonly version: typeof TEMPLATE_VERSION;
  readonly scope: ReportTemplateScope;
  readonly name: string;
  readonly description: string | null;
  readonly slots: readonly TemplateSlot[];
  readonly fields: readonly TemplateField[];
  readonly reports: readonly TemplateReport[];
  /** Solo en paneles y tableros. */
  readonly layout: TemplateLayout | null;
  /** Solo en tableros, y solo si se pidió al guardarla. */
  readonly identity?: TemplateIdentity | null;
}

/** La identidad lista para ir en una plantilla, con su logo si lo tiene. */
export function templateIdentity(
  identity: ReportIdentity,
  logo: ReportIdentityLogo | null,
): TemplateIdentity {
  return {
    id: identity.id,
    name: identity.name,
    subtitle: identity.subtitle,
    details: identity.details,
    footer: identity.footer,
    brandColor: identity.brandColor,
    logoOnWhite: identity.logoOnWhite,
    logo: logo ? { contentType: logo.contentType ?? 'image/png', data: logo.data } : null,
  };
}

/** Lo que ocupa la plantilla guardada: con logo, puede pasar del límite. */
export function templateBytes(document: TemplateDocument): number {
  return new Blob([JSON.stringify(document)]).size;
}

// --- Tipos de campo ---------------------------------------------------------------

const DATE_TYPES = new Set(['DateOnly', 'DateTime', 'DateTimeOffset']);

export function kindOf(column: ReportColumn): FieldKind {
  if (isNumericColumn(column)) return 'number';
  if (DATE_TYPES.has(column.clrType)) return 'date';
  if (column.clrType === 'String') return 'text';
  if (column.clrType === 'Boolean') return 'boolean';
  return 'other';
}

/** Si una columna sirve para un campo: mismo tipo, o un campo que admite cualquiera. */
export function fits(field: TemplateField, column: ReportColumn): boolean {
  return field.kind === 'other' || kindOf(column) === field.kind;
}

/** `izquierda.mes` y `mes` hablan de lo mismo: se compara sin el prefijo del cruce. */
function baseName(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1);
}

function slug(name: string): string {
  const plain = baseName(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return plain || 'campo';
}

// --- Capturar una plantilla ---------------------------------------------------------

export interface CaptureSource {
  readonly reports: readonly SavedReport[];
  readonly datasets: readonly ReportDataset[];
  /** Las columnas del resultado guardado de cada conjunto, para saber de qué tipo es cada campo. */
  readonly columnsOf: (datasetId: string) => readonly ReportColumn[];
  /** Paneles y filtros: solo para plantillas de panel o de tablero. */
  readonly layout?: DashboardModel | null;
}

/**
 * Convierte reportes (y, si lo hay, su diseño) en una plantilla.
 *
 * Cada columna usada pasa a ser un campo de su hueco. El campo es obligatorio
 * si algún reporte lo necesita para dibujar —la categoría o la cifra— y
 * opcional si solo lo usa una meta, una columna de tabla o un filtro.
 */
export function captureTemplate(
  scope: ReportTemplateScope,
  name: string,
  description: string | null,
  source: CaptureSource,
): TemplateDocument {
  const layout = scope === 'Report' ? null : (source.layout ?? null);
  const usedIds = layout
    ? new Set(layout.pages.flatMap((page) => page.panels.map((panel) => panel.reportId)))
    : new Set(source.reports.map((report) => report.id));
  const reports = source.reports.filter((report) => usedIds.has(report.id));

  const slotOf = new Map<string, number>();
  const slots: TemplateSlot[] = [];

  for (const report of reports) {
    if (!slotOf.has(report.datasetId)) {
      slotOf.set(report.datasetId, slots.length);
      slots.push({
        label: source.datasets.find((item) => item.id === report.datasetId)?.name ?? '',
      });
    }
  }

  const fields: TemplateField[] = [];
  const fieldIds = new Set<string>();
  /** `hueco|columna` → posición en `fields`: dos columnas de un cruce pueden compartir nombre base. */
  const byColumn = new Map<string, number>();

  /** El campo de una columna de un hueco; se crea la primera vez que se usa. */
  const field = (datasetId: string, column: string, required: boolean): string => {
    const slot = slotOf.get(datasetId)!;
    const existing = byColumn.get(`${slot}|${column}`) ?? -1;

    if (existing >= 0) {
      if (required && !fields[existing].required) {
        fields[existing] = { ...fields[existing], required: true };
      }

      return fields[existing].id;
    }

    const base = slug(column);
    let id = base;

    for (let n = 2; fieldIds.has(id); n++) id = `${base}_${n}`;

    const original = source.columnsOf(datasetId).find((item) => item.name === column);

    fieldIds.add(id);
    byColumn.set(`${slot}|${column}`, fields.length);
    // Solo el nombre base: el prefijo del cruce (`izquierda.`) no dice nada fuera de este conjunto.
    fields.push({
      id,
      slot,
      name: baseName(column),
      kind: original ? kindOf(original) : 'other',
      required,
    });
    return id;
  };

  const keyOf = new Map(reports.map((report, index) => [report.id, `r${index + 1}`]));

  const templateReports: TemplateReport[] = reports.map((report) => {
    const settings = parseSettings(
      report.settings,
      report.visual,
      source.columnsOf(report.datasetId),
    );
    const ref = (column: string | null, required: boolean) =>
      column === null ? null : field(report.datasetId, column, required);

    return {
      key: keyOf.get(report.id)!,
      slot: slotOf.get(report.datasetId)!,
      name: report.name,
      visual: report.visual,
      settings: {
        ...settings,
        category: ref(settings.category, true),
        value: ref(settings.value, true),
        target: ref(settings.target, false),
        columns: settings.columns.map((column) => field(report.datasetId, column, false)),
      },
    };
  });

  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    scope,
    name: name.trim(),
    description: description?.trim() ? description.trim() : null,
    slots,
    fields,
    reports: templateReports,
    layout: layout ? captureLayout(layout, keyOf, slotOf, field) : null,
  };
}

function captureLayout(
  model: DashboardModel,
  keyOf: ReadonlyMap<string, string>,
  slotOf: ReadonlyMap<string, number>,
  field: (datasetId: string, column: string, required: boolean) => string,
): TemplateLayout {
  return {
    pages: model.pages.map((page) => ({
      name: page.name,
      panels: page.panels
        .filter((panel) => keyOf.has(panel.reportId))
        .map((panel) => ({
          report: keyOf.get(panel.reportId)!,
          width: panel.width,
          height: panel.height,
          title: panel.title,
          description: panel.description,
          hideHeader: panel.hideHeader,
          color: panel.color,
        })),
    })),
    // Solo se conservan los vínculos de conjuntos que están en la plantilla.
    filters: model.filters.map((filter) => ({
      kind: filter.kind,
      label: filter.label,
      bindings: Object.fromEntries(
        Object.entries(filter.bindings)
          .filter(([datasetId]) => slotOf.has(datasetId))
          .map(([datasetId, column]) => [
            String(slotOf.get(datasetId)),
            field(datasetId, column, false),
          ]),
      ),
    })),
    // La identidad de la empresa no viaja en la plantilla: las plantillas se
    // comparten, y llevarse el logo de una empresa a otra sería un error fácil.
    style: { color: model.style.color, identityId: null },
  };
}

/** Una plantilla de panel: el panel elegido y su reporte, sin filtros. */
export function panelLayout(model: DashboardModel, panelId: string): DashboardModel | null {
  const panel = model.pages.flatMap((page) => page.panels).find((item) => item.id === panelId);

  return panel ? { ...model, pages: [{ id: 'p', name: '', panels: [panel] }], filters: [] } : null;
}

// --- Vincular campos --------------------------------------------------------------

/** Columna elegida para cada campo; `null` es «sin vincular». */
export type FieldAssignment = Readonly<Record<string, string | null>>;

/**
 * La vinculación que se propone para los campos de un hueco.
 *
 * Primero, la columna que se llama igual y es del mismo tipo: aplicada al
 * mismo conjunto, la plantilla sale idéntica. Después, la primera columna libre
 * del tipo, para no empezar en blanco con nombres distintos (`monto_total` por
 * `venta`). Es una propuesta: quien aplica la revisa antes de crear nada.
 */
export function proposeAssignment(
  document: TemplateDocument,
  slot: number,
  columns: readonly ReportColumn[],
): FieldAssignment {
  const fields = document.fields.filter((item) => item.slot === slot);
  const chosen: Record<string, string | null> = {};
  const used = new Set<string>();

  for (const field of fields) {
    const name = baseName(field.name).toLowerCase();
    const match = columns.find(
      (column) =>
        !used.has(column.name) &&
        fits(field, column) &&
        baseName(column.name).toLowerCase() === name,
    );

    chosen[field.id] = match?.name ?? null;
    if (match) used.add(match.name);
  }

  for (const field of fields) {
    if (chosen[field.id] === null) {
      const free = columns.find((column) => !used.has(column.name) && fits(field, column));

      chosen[field.id] = free?.name ?? null;
      if (free) used.add(free.name);
    }
  }

  return chosen;
}

/** Los campos obligatorios que aún no tienen columna: impiden crear la copia. */
export function missingFields(
  document: TemplateDocument,
  assignment: FieldAssignment,
): readonly TemplateField[] {
  return document.fields.filter((field) => field.required && !assignment[field.id]);
}

// --- Aplicar ----------------------------------------------------------------------

export interface TemplateCopy {
  /** Reportes nuevos, con ids nuevos, listos para guardar. */
  readonly reports: readonly SavedReport[];
  /** El diseño con esos reportes; `null` en una plantilla de reporte. */
  readonly layout: DashboardModel | null;
}

/**
 * Crea una copia independiente de la plantilla sobre los conjuntos elegidos.
 *
 * `datasets[n]` es el conjunto del hueco `n`. Los campos opcionales sin
 * vincular se quitan de los ajustes (una tabla sin esa columna, un indicador
 * sin meta) y de los filtros.
 */
export function instantiateTemplate(
  document: TemplateDocument,
  datasets: readonly string[],
  assignment: FieldAssignment,
  newId: () => string = () => crypto.randomUUID(),
  existing: readonly Pick<SavedReport, 'datasetId' | 'name'>[] = [],
): TemplateCopy {
  const column = (fieldId: string | null) =>
    fieldId === null ? null : (assignment[fieldId] ?? null);
  const idOf = new Map<string, string>();
  // Aplicar dos veces al mismo conjunto no deja dos pestañas con el mismo nombre.
  const taken = new Set(
    existing.map((report) => `${report.datasetId}|${report.name.trim().toLowerCase()}`),
  );
  const unique = (datasetId: string, name: string) => {
    let candidate = name;

    for (let n = 2; taken.has(`${datasetId}|${candidate.trim().toLowerCase()}`); n++)
      candidate = `${name} (${n})`;
    taken.add(`${datasetId}|${candidate.trim().toLowerCase()}`);
    return candidate;
  };

  const reports: SavedReport[] = document.reports.map((report) => {
    const id = newId();
    const settings: ReportSettings = {
      ...report.settings,
      category: column(report.settings.category),
      value: column(report.settings.value),
      target: column(report.settings.target),
      columns: report.settings.columns.map(column).filter((name): name is string => name !== null),
    };

    idOf.set(report.key, id);
    return {
      id,
      datasetId: datasets[report.slot],
      name: unique(datasets[report.slot], report.name),
      visual: report.visual,
      settings: JSON.stringify(settings),
    };
  });

  const layout = document.layout;

  if (!layout) {
    return { reports, layout: null };
  }

  const pages: DashboardPage[] = layout.pages.map((page) => ({
    id: newId(),
    name: page.name,
    panels: page.panels.map((panel) => ({
      id: newId(),
      reportId: idOf.get(panel.report)!,
      width: panel.width,
      height: panel.height,
      title: panel.title,
      description: panel.description,
      hideHeader: panel.hideHeader,
      color: panel.color,
    })),
  }));

  const filters: DashboardFilter[] = layout.filters.map((filter) => {
    const bindings: Record<string, string> = {};

    for (const [slot, fieldId] of Object.entries(filter.bindings)) {
      const datasetId = datasets[Number(slot)];
      const name = column(fieldId);

      if (datasetId && name) bindings[datasetId] = name;
    }

    return { id: newId(), kind: filter.kind, label: filter.label, bindings };
  });

  return { reports, layout: { version: 1, pages, filters, style: layout.style } };
}

// --- Leer un archivo --------------------------------------------------------------

/** Lo que tendría una plantilla con consultas, credenciales o filas: igual que en el servidor. */
const FORBIDDEN = new Set(
  [
    'sql',
    'query',
    'connectionId',
    'connection',
    'connectionString',
    'password',
    'secret',
    'database',
    'visualModel',
    'rows',
    'sampleRows',
  ].map((key) => key.toLowerCase()),
);

/** Por qué no se pudo leer una plantilla, como clave de idioma `reports.template.invalid.*`. */
export type TemplateProblem =
  | 'tooBig'
  | 'notJson'
  | 'format'
  | 'version'
  | 'scope'
  | 'name'
  | 'forbidden'
  | 'content'
  | 'references';

export type TemplateRead =
  | { readonly ok: true; readonly document: TemplateDocument }
  | { readonly ok: false; readonly problem: TemplateProblem };

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasForbidden(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbidden);
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, item]) => FORBIDDEN.has(key.toLowerCase()) || hasForbidden(item),
  );
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function color(value: unknown): PaletteColor | null {
  return PALETTE.includes(value as PaletteColor) ? (value as PaletteColor) : null;
}

/** Error de contenido: se lanza dentro de `parseTemplate` y se devuelve como problema. */
class Invalid extends Error {
  constructor(readonly problem: TemplateProblem) {
    super(problem);
  }
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Invalid('content');
  }

  return value;
}

/**
 * Lee una plantilla de un archivo o de la base, sin fiarse de nada.
 *
 * Comprueba formato, versión, tamaño, ámbito, tipos de panel y que cada
 * referencia —de un ajuste a un campo, de un panel a un reporte, de un filtro
 * a un hueco— exista, antes de enseñar la vista previa. Lo que devuelve está
 * normalizado: un archivo editado a mano no cuela valores fuera de rango.
 */
export function parseTemplate(json: string): TemplateRead {
  if (new Blob([json]).size > MAX_TEMPLATE_BYTES) {
    return { ok: false, problem: 'tooBig' };
  }

  let raw: unknown;

  try {
    raw = JSON.parse(json.replace(/^﻿/, ''));
  } catch {
    return { ok: false, problem: 'notJson' };
  }

  if (!isObject(raw) || raw['format'] !== TEMPLATE_FORMAT) return { ok: false, problem: 'format' };
  if (raw['version'] !== TEMPLATE_VERSION) return { ok: false, problem: 'version' };
  if (!SCOPES.includes(raw['scope'] as ReportTemplateScope)) return { ok: false, problem: 'scope' };
  if (hasForbidden(raw)) return { ok: false, problem: 'forbidden' };

  const name = str(raw['name'], 120)?.trim();

  if (!name) return { ok: false, problem: 'name' };

  try {
    return { ok: true, document: readDocument(raw, raw['scope'] as ReportTemplateScope, name) };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, problem: error.problem };
    throw error;
  }
}

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const HEX = /^#[0-9a-f]{6}$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La identidad de una plantilla de tablero, con los mismos límites que pone
 * el servidor a una identidad. El logo solo se acepta como PNG, JPEG o WebP
 * en base64: el servidor vuelve a mirar sus bytes al guardarlo.
 */
function readIdentity(value: unknown): TemplateIdentity | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) throw new Invalid('content');

  const name = str(value['name'], 120)?.trim();
  const id = value['id'];

  if (!name || typeof id !== 'string' || !ID.test(id)) throw new Invalid('content');

  const line = (item: unknown) => str(item, 160)?.trim() || null;
  const details = list(value['details'] ?? [], 3).map(line).filter((item) => item !== null);
  const brand = value['brandColor'];
  const logo = value['logo'];
  let readLogo: TemplateIdentity['logo'] = null;

  if (logo !== undefined && logo !== null) {
    if (
      !isObject(logo) ||
      !LOGO_TYPES.has(logo['contentType'] as string) ||
      typeof logo['data'] !== 'string' ||
      !BASE64.test(logo['data'])
    ) {
      throw new Invalid('content');
    }

    readLogo = { contentType: logo['contentType'] as string, data: logo['data'] };
  }

  return {
    id: id.toLowerCase(),
    name,
    subtitle: line(value['subtitle']),
    details,
    footer: line(value['footer']),
    brandColor: typeof brand === 'string' && HEX.test(brand) ? brand.toUpperCase() : null,
    logoOnWhite: value['logoOnWhite'] === true,
    logo: readLogo,
  };
}

function readDocument(raw: Raw, scope: ReportTemplateScope, name: string): TemplateDocument {
  const slots: TemplateSlot[] = list(raw['slots'], MAX_SLOTS).map((slot) => ({
    label: (isObject(slot) ? str(slot['label'], 120) : null) ?? '',
  }));

  if (slots.length === 0) throw new Invalid('content');

  const fields: TemplateField[] = list(raw['fields'], MAX_FIELDS).map((item) => {
    if (!isObject(item)) throw new Invalid('content');

    const id = str(item['id'], 80);
    const slot = item['slot'];

    if (
      !id ||
      typeof slot !== 'number' ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= slots.length
    ) {
      throw new Invalid('references');
    }

    return {
      id,
      slot,
      name: str(item['name'], 200) ?? id,
      kind: FIELD_KINDS.includes(item['kind'] as FieldKind) ? (item['kind'] as FieldKind) : 'other',
      required: item['required'] === true,
    };
  });

  const fieldSlot = new Map(fields.map((field) => [field.id, field.slot]));

  if (fieldSlot.size !== fields.length) throw new Invalid('references');

  const reports: TemplateReport[] = list(raw['reports'], MAX_REPORTS).map((item) => {
    if (!isObject(item) || !VISUALS.includes(item['visual'] as ReportVisualKind))
      throw new Invalid('content');

    const key = str(item['key'], 40);
    const slot = item['slot'];

    if (
      !key ||
      typeof slot !== 'number' ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= slots.length
    ) {
      throw new Invalid('references');
    }

    const visual = item['visual'] as ReportVisualKind;
    // Los ajustes se leen como los de un reporte guardado y luego se comprueba
    // que cada referencia sea un campo de su mismo hueco.
    const settings = parseSettings(JSON.stringify(item['settings'] ?? {}), visual, []);
    const refs = [settings.category, settings.value, settings.target, ...settings.columns].filter(
      (ref): ref is string => ref !== null,
    );

    if (refs.some((ref) => fieldSlot.get(ref) !== slot)) throw new Invalid('references');

    return { key, slot, name: str(item['name'], 120)?.trim() || key, visual, settings };
  });

  if (
    reports.length === 0 ||
    new Set(reports.map((report) => report.key)).size !== reports.length
  ) {
    throw new Invalid(reports.length === 0 ? 'content' : 'references');
  }

  const layout =
    scope === 'Report' ? null : readLayout(raw['layout'], reports, slots.length, fieldSlot);

  if (scope === 'Report' ? reports.length !== 1 : layout === null) throw new Invalid('content');
  if (scope === 'Panel' && (layout!.pages.length !== 1 || layout!.pages[0].panels.length !== 1)) {
    throw new Invalid('content');
  }

  // Una identidad en una plantilla de panel o de reporte no tendría dónde ir.
  const identity = scope === 'Dashboard' ? readIdentity(raw['identity']) : null;

  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    scope,
    name,
    description: str(raw['description'], 400)?.trim() || null,
    slots,
    fields,
    reports,
    layout,
    // Sin identidad no se escribe la clave: la plantilla queda igual que antes.
    ...(identity ? { identity } : {}),
  };
}

function readLayout(
  value: unknown,
  reports: readonly TemplateReport[],
  slotCount: number,
  fieldSlot: ReadonlyMap<string, number>,
): TemplateLayout | null {
  if (!isObject(value)) return null;

  const keys = new Set(reports.map((report) => report.key));
  let panelCount = 0;

  const pages: TemplatePage[] = list(value['pages'], MAX_PAGES).map((page) => {
    if (!isObject(page)) throw new Invalid('content');

    const panels = list(page['panels'], MAX_PANELS).map((panel) => {
      if (!isObject(panel) || !keys.has(panel['report'] as string)) throw new Invalid('references');

      const title = str(panel['title'], 80);
      const description = str(panel['description'], 140);

      return {
        report: panel['report'] as string,
        width: int(panel['width'], MIN_WIDTH, GRID_COLUMNS, 6),
        height: int(panel['height'], MIN_HEIGHT, MAX_HEIGHT, 4),
        title: title?.trim() ? title : null,
        description: description?.trim() ? description : null,
        hideHeader: panel['hideHeader'] === true,
        color: color(panel['color']),
      };
    });

    panelCount += panels.length;
    return { name: str(page['name'], 40) ?? '', panels };
  });

  if (pages.length === 0 || panelCount > MAX_PANELS) throw new Invalid('content');

  const filters: TemplateFilter[] = list(value['filters'] ?? [], MAX_FILTERS).map((filter) => {
    if (!isObject(filter) || (filter['kind'] !== 'date' && filter['kind'] !== 'category')) {
      throw new Invalid('content');
    }

    const bindings = isObject(filter['bindings']) ? filter['bindings'] : {};

    for (const [slot, fieldId] of Object.entries(bindings)) {
      const index = Number(slot);

      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= slotCount ||
        fieldSlot.get(fieldId as string) !== index
      ) {
        throw new Invalid('references');
      }
    }

    return {
      kind: filter['kind'],
      label: str(filter['label'], 40) ?? '',
      bindings: bindings as Record<string, string>,
    };
  });

  const style = isObject(value['style'])
    ? { color: color(value['style']['color']), identityId: null }
    : { color: null, identityId: null };

  return { pages, filters, style };
}

/** El archivo que se exporta: la plantilla tal cual, legible por una persona. */
export function exportTemplate(document: TemplateDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Un nombre de archivo sin caracteres que algún sistema rechace. */
export function templateFileName(name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return `${safe || 'plantilla'}.druse-plantilla.json`;
}

// --- Diseños iniciales ------------------------------------------------------------

/** Textos de un diseño inicial, ya traducidos. */
export interface StarterTexts {
  readonly name: string;
  readonly description: string;
  readonly page: string;
  readonly indicator: string;
  readonly byCategory: string;
  readonly overTime: string;
  readonly detail: string;
  readonly dateFilter: string;
  readonly categoryFilter: string;
}

/**
 * «Seguimiento de una cifra»: el diseño con que se puede empezar sin haber
 * guardado ninguna plantilla. Una cifra contra su meta, por categoría y en el
 * tiempo, y el detalle, con filtros de fecha y categoría ya vinculados.
 */
export function goalStarter(texts: StarterTexts): TemplateDocument {
  const settings = (patch: Partial<ReportSettings>): ReportSettings => ({
    ...parseSettings('{}', 'Table', []),
    category: null,
    value: null,
    target: null,
    ...patch,
  });

  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    scope: 'Dashboard',
    name: texts.name,
    description: texts.description,
    slots: [{ label: '' }],
    fields: [
      { id: 'cifra', slot: 0, name: 'cifra', kind: 'number', required: true },
      { id: 'meta', slot: 0, name: 'meta', kind: 'number', required: false },
      { id: 'categoria', slot: 0, name: 'categoria', kind: 'text', required: true },
      { id: 'fecha', slot: 0, name: 'fecha', kind: 'date', required: true },
    ],
    reports: [
      {
        key: 'r1',
        slot: 0,
        name: texts.indicator,
        visual: 'Indicator',
        settings: settings({ value: 'cifra', target: 'meta' }),
      },
      {
        key: 'r2',
        slot: 0,
        name: texts.byCategory,
        visual: 'Bar',
        settings: settings({ category: 'categoria', value: 'cifra', sort: 'valueDesc' }),
      },
      {
        key: 'r3',
        slot: 0,
        name: texts.overTime,
        visual: 'Line',
        settings: settings({ category: 'fecha', value: 'cifra' }),
      },
      { key: 'r4', slot: 0, name: texts.detail, visual: 'Table', settings: settings({}) },
    ],
    layout: {
      pages: [
        {
          name: texts.page,
          panels: [
            {
              report: 'r1',
              width: 4,
              height: 4,
              title: null,
              description: null,
              hideHeader: false,
              color: null,
            },
            {
              report: 'r2',
              width: 8,
              height: 4,
              title: null,
              description: null,
              hideHeader: false,
              color: null,
            },
            {
              report: 'r3',
              width: 12,
              height: 4,
              title: null,
              description: null,
              hideHeader: false,
              color: null,
            },
            {
              report: 'r4',
              width: 12,
              height: 5,
              title: null,
              description: null,
              hideHeader: false,
              color: null,
            },
          ],
        },
      ],
      filters: [
        { kind: 'date', label: texts.dateFilter, bindings: { '0': 'fecha' } },
        { kind: 'category', label: texts.categoryFilter, bindings: { '0': 'categoria' } },
      ],
      style: { color: null, identityId: null },
    },
  };
}
