import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatDate } from '../../../core/i18n/locale-format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { describeError } from '../../../core/workspace/errors';
import {
  ReportDataset,
  ReportSnapshot,
  SavedDashboard,
  ReportTemplateScope,
  SavedReport,
} from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { ReportChart } from '../report-chart/report-chart';
import {
  DEFAULT_APPEARANCE,
  PALETTE,
  PaletteColor,
  ReportAppearance,
  buildIndicator,
  buildSeries,
  categoryColors,
  parseSettings,
  repeatedInUse,
  tableView,
} from '../report-chart';
import {
  DashboardFilter,
  DashboardFilterKind,
  DashboardModel,
  DashboardPanel,
  FilterValue,
  GRID_COLUMNS,
  MAX_HEIGHT,
  MIN_HEIGHT,
  MIN_WIDTH,
  ColorSource,
  addPage,
  addPanel,
  insertPanels,
  applyFilters,
  categoryOptions,
  fitsFilter,
  isActive,
  movePanel,
  movePanelToPage,
  parseDashboard,
  proposeBinding,
  patchPanel,
  removePage,
  removePanel,
  renamePage,
  resolveColor,
  resizePanel,
  retitlePanel,
} from '../report-dashboard-model';
import { columnLabelFor } from '../report-draft';
import { ReportTemplateGallery, TemplateApplication } from '../report-template-gallery/report-template-gallery';
import { ReportTemplateSave, TemplateSaveRequest } from '../report-template-save/report-template-save';
import { captureTemplate, instantiateTemplate, panelLayout } from '../report-template-model';

/** Lo que pinta un panel, ya calculado con los filtros activos. */
interface PanelView {
  readonly panel: DashboardPanel;
  readonly report: SavedReport | null;
  readonly dataset: ReportDataset | null;
  readonly snapshot: ReportSnapshot | null;
  readonly title: string;
  readonly unbound: readonly string[];
  readonly repeated: readonly string[];
  readonly label: (name: string) => string;
  readonly series: ReturnType<typeof buildSeries> | null;
  readonly indicator: ReturnType<typeof buildIndicator> | null;
  readonly table: ReturnType<typeof tableView> | null;
  readonly valueLabel: string;
  readonly categoryLabel: string;
  readonly appearance: ReportAppearance;
  /** El color resuelto y de dónde viene: panel, reporte, tablero o tema. */
  readonly color: PaletteColor | null;
  readonly colorSource: ColorSource;
  readonly categoryColors: ReadonlyMap<string | null, PaletteColor> | null;
  /** Pulsar una barra filtra el tablero: hay un filtro vinculado a su categoría. */
  readonly pickFilter: DashboardFilter | null;
  /** La categoría elegida en ese filtro; `undefined` si no hay ninguna. */
  readonly picked: string | null | undefined;
}

/**
 * Un tablero: reportes de uno o varios conjuntos en una cuadrícula, con
 * filtros de fecha y categoría compartidos.
 *
 * Todo se pinta con los resultados guardados, así que se abre y se filtra con
 * las bases apagadas. Ordenar y redimensionar se hace con botones y con el
 * teclado (Alt + flechas mueve, Mayús + flechas cambia el tamaño): no hay nada
 * que solo se pueda hacer arrastrando.
 */
@Component({
  selector: 'app-report-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ReportChart, ReportTemplateGallery, ReportTemplateSave, TranslatePipe],
  templateUrl: './report-dashboard.html',
  styleUrl: './report-dashboard.scss',
  host: {
    '[class.is-editing]': 'editing()',
  },
})
export class ReportDashboard {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _i18n = inject(I18nService);

  readonly dashboard = input.required<SavedDashboard>();
  readonly datasets = input.required<readonly ReportDataset[]>();
  readonly inspectorOpen = input(true);

  readonly saved = output<SavedDashboard>();
  readonly deleted = output<string>();
  readonly dirtyChange = output<boolean>();
  /** Al empezar a editar: el constructor abre el inspector, que es donde se edita. */
  readonly editingChange = output<boolean>();

  /**
   * Si el tablero existe en el servidor.
   *
   * No basta con mirar la entrada: un tablero nuevo se guarda aquí dentro y la
   * entrada sigue siendo la de antes de guardarlo. Sin esto, borrarlo después
   * solo lo quitaba de la lista y volvía a aparecer al reabrir.
   */
  private readonly _persisted = signal(false);

  protected readonly name = signal('');
  protected readonly model = signal<DashboardModel>(parseDashboard('{}', ''));
  private readonly _savedModel = signal('');
  private readonly _savedName = signal('');

  protected readonly editing = signal(false);
  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly reports = signal<readonly SavedReport[]>([]);
  protected readonly snapshots = signal<ReadonlyMap<string, ReportSnapshot | null>>(new Map());
  protected readonly values = signal<ReadonlyMap<string, FilterValue>>(new Map());
  protected readonly selectedPanel = signal<string | null>(null);
  protected readonly confirmDelete = signal(false);

  /** Plantillas: qué se está guardando como plantilla, si algo, y la galería. */
  protected readonly savingTemplate = signal<'Dashboard' | 'Panel' | null>(null);
  protected readonly templateBusy = signal(false);
  protected readonly galleryOpen = signal(false);
  protected readonly galleryScopes: readonly ReportTemplateScope[] = ['Panel', 'Report'];

  protected readonly palette = PALETTE;
  protected readonly currentPage = signal<string | null>(null);
  protected readonly pages = computed(() => this.model().pages);
  protected readonly page = computed(
    () => this.pages().find((page) => page.id === this.currentPage()) ?? this.pages()[0],
  );
  /** Paneles que se ven como tabla en vez de gráfico: la alternativa accesible. */
  protected readonly asTable = signal<ReadonlySet<string>>(new Set());
  protected readonly filters = computed(() => this.model().filters);

  protected readonly dirty = computed(
    () => this.name().trim() !== this._savedName() || JSON.stringify(this.model()) !== this._savedModel(),
  );

  /** Los conjuntos que alimentan algún panel: son los que se actualizan y se filtran. */
  protected readonly usedDatasets = computed(() => {
    const ids = new Set(
      this.pages()
        .flatMap((page) => page.panels)
        .map((panel) => this.reports().find((report) => report.id === panel.reportId)?.datasetId)
        .filter((id): id is string => id !== undefined),
    );

    return this.datasets().filter((dataset) => ids.has(dataset.id));
  });

  protected readonly anyActive = computed(() => [...this.values().values()].some(isActive));

  protected readonly panels = computed<readonly PanelView[]>(() =>
    this.page().panels.map((panel) => this.view(panel)),
  );

  /** Los reportes que se pueden añadir, agrupados por su conjunto. */
  protected readonly catalog = computed(() =>
    this.datasets()
      .map((dataset) => ({
        dataset,
        reports: this.reports().filter((report) => report.datasetId === dataset.id),
      }))
      .filter((group) => group.reports.length > 0),
  );

  protected readonly selected = computed(
    () => this.panels().find((view) => view.panel.id === this.selectedPanel()) ?? null,
  );

  constructor() {
    effect(() => {
      const dashboard = this.dashboard();

      untracked(() => this.open(dashboard));
    });

    effect(() => this.dirtyChange.emit(this.dirty()));
  }

  private open(dashboard: SavedDashboard): void {
    const model = parseDashboard(dashboard.model, this._i18n.t('reports.dashboard.page', { number: 1 }));

    this.name.set(dashboard.name);
    this.model.set(model);
    this._savedName.set(dashboard.name.trim());
    // Un tablero nuevo no está guardado: se compara con «nada» y se abre en edición.
    this._savedModel.set(dashboard.createdAtUtc ? JSON.stringify(model) : '');
    this._persisted.set(dashboard.createdAtUtc !== undefined);
    this.setEditing(!dashboard.createdAtUtc);
    this.values.set(new Map());
    this.selectedPanel.set(null);
    this.currentPage.set(model.pages[0]?.id ?? null);
    this.asTable.set(new Set());
    this.confirmDelete.set(false);
    this.notice.set(null);
    this.savingTemplate.set(null);
    this.galleryOpen.set(false);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      this.reports.set(await firstValueFrom(this._gateway.getAllReports()));
      await this.loadSnapshots();
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.loading.set(false);
    }
  }

  /** Lee de reports.db los resultados que faltan; no toca los orígenes. */
  private async loadSnapshots(force = false): Promise<void> {
    const pending = this.usedDatasets().filter((dataset) => force || !this.snapshots().has(dataset.id));
    const loaded = await Promise.all(
      pending.map(async (dataset) => [dataset.id, await firstValueFrom(this._gateway.getReportSnapshot(dataset.id))] as const),
    );

    this.snapshots.update((map) => {
      const next = new Map(map);

      for (const [id, snapshot] of loaded) next.set(id, snapshot);
      return next;
    });
  }

  private view(panel: DashboardPanel): PanelView {
    const report = this.reports().find((item) => item.id === panel.reportId) ?? null;
    const dataset = report ? (this.datasets().find((item) => item.id === report.datasetId) ?? null) : null;
    const stored = dataset ? (this.snapshots().get(dataset.id) ?? null) : null;
    const label = (name: string) => (dataset ? columnLabelFor(dataset.sources, name) : name);
    const empty = {
      panel,
      report,
      dataset,
      snapshot: stored,
      title: panel.title ?? report?.name ?? '',
      unbound: [],
      repeated: [],
      label,
      series: null,
      indicator: null,
      table: null,
      valueLabel: '',
      categoryLabel: '',
      appearance: DEFAULT_APPEARANCE,
      color: null,
      colorSource: 'theme' as ColorSource,
      categoryColors: null,
      pickFilter: null,
      picked: undefined,
    };

    if (!report || !dataset || !stored) {
      return empty;
    }

    const { snapshot, unbound } = applyFilters(stored, dataset.id, this.filters(), this.values());
    const settings = parseSettings(report.settings, report.visual, snapshot.columns);
    const pickFilter =
      report.visual === 'Bar' && settings.category
        ? this.filters().find((filter) => filter.kind === 'category' && filter.bindings[dataset.id] === settings.category)
        : undefined;
    // i18n-keys: reports.aggregate.*
    const how = this._i18n.t(`reports.aggregate.${settings.aggregate}`);

    return {
      ...empty,
      snapshot,
      unbound,
      repeated: repeatedInUse(snapshot, settings).map(label),
      series: report.visual === 'Bar' || report.visual === 'Line' ? buildSeries(snapshot, settings) : null,
      indicator: report.visual === 'Indicator' ? buildIndicator(snapshot, settings) : null,
      table: report.visual === 'Table' ? tableView(snapshot, settings) : null,
      valueLabel: settings.aggregate === 'Count' || !settings.value ? how : `${how} · ${label(settings.value)}`,
      categoryLabel: settings.category ? label(settings.category) : '',
      appearance: settings.appearance,
      ...this.colorOf(panel, settings.appearance.color),
      // Del resultado sin filtrar: filtrar no repinta las barras que quedan.
      categoryColors: categoryColors(stored, settings),
      pickFilter: pickFilter ?? null,
      picked: pickFilter ? this.pickedValue(pickFilter) : undefined,
    };
  }

  private colorOf(panel: DashboardPanel, reportColor: PaletteColor | null) {
    const { color, source } = resolveColor(panel, reportColor, this.model().style);

    return { color, colorSource: source };
  }

  private pickedValue(filter: DashboardFilter): string | null | undefined {
    const value = this.values().get(filter.id);

    return value?.kind === 'category' && value.values.length > 0 ? value.values[0] : undefined;
  }

  /**
   * Pulsar una barra elige su categoría en el filtro vinculado; pulsarla otra
   * vez lo quita. Todos los paneles vinculados se filtran a la vez.
   */
  protected pick(view: PanelView, label: string | null): void {
    const filter = view.pickFilter;

    if (!filter) {
      return;
    }

    this.setValue(filter.id, {
      kind: 'category',
      values: view.picked === label ? [] : [label],
    });
  }

  protected toggleTable(panel: DashboardPanel): void {
    this.asTable.update((set) => {
      const next = new Set(set);

      if (!next.delete(panel.id)) next.add(panel.id);
      return next;
    });
  }

  protected when(iso: string): string {
    return formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
  }

  // --- Filtros -------------------------------------------------------------------

  protected dateValue(filter: DashboardFilter, side: 'from' | 'to'): string {
    const value = this.values().get(filter.id);

    return value?.kind === 'date' ? (value[side] ?? '') : '';
  }

  protected setDate(filter: DashboardFilter, side: 'from' | 'to', day: string): void {
    const current = this.values().get(filter.id);
    const base = current?.kind === 'date' ? current : { kind: 'date' as const, from: null, to: null };

    this.setValue(filter.id, { ...base, [side]: day || null });
  }

  protected categoryValue(filter: DashboardFilter): string {
    const value = this.values().get(filter.id);

    return value?.kind === 'category' && value.values.length > 0 ? this.optionKey(value.values[0]) : '';
  }

  protected setCategory(filter: DashboardFilter, key: string): void {
    this.setValue(filter.id, {
      kind: 'category',
      values: key === '' ? [] : [key === EMPTY_KEY ? null : key.slice(1)],
    });
  }

  /** `""` es «todos»; el vacío y los textos se distinguen con un prefijo. */
  protected optionKey(value: string | null): string {
    return value === null ? EMPTY_KEY : `v${value}`;
  }

  protected options(filter: DashboardFilter): readonly (string | null)[] {
    return categoryOptions(filter, new Map([...this.snapshots()].filter((entry): entry is [string, ReportSnapshot] => entry[1] !== null)));
  }

  private setValue(id: string, value: FilterValue): void {
    this.values.update((map) => new Map(map).set(id, value));
  }

  protected clearFilters(): void {
    this.values.set(new Map());
  }

  // --- Actualizar ----------------------------------------------------------------

  /** Actualiza, uno tras otro, los conjuntos que usa el tablero. */
  protected async refreshAll(): Promise<void> {
    if (this.refreshing()) {
      return;
    }

    this.refreshing.set(true);
    this.error.set(null);
    this.notice.set(null);

    const failed: string[] = [];

    try {
      for (const dataset of this.usedDatasets()) {
        const result = await firstValueFrom(this._gateway.refreshReportDataset(dataset.id));

        if (result.outcome !== 'Refreshed') {
          failed.push(dataset.name);
        }
      }

      await this.loadSnapshots(true);
      this.notice.set(
        failed.length > 0
          ? this._i18n.t('reports.dashboard.refreshFailed', { names: failed.join(', ') })
          : this._i18n.t('reports.dashboard.refreshed'),
      );
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.refreshing.set(false);
    }
  }

  // --- Edición -------------------------------------------------------------------

  protected toggleEditing(): void {
    this.setEditing(!this.editing());
  }

  private setEditing(editing: boolean): void {
    this.editing.set(editing);
    this.editingChange.emit(editing);
    this.selectedPanel.set(null);

    if (this.savingTemplate() === 'Panel') {
      this.savingTemplate.set(null);
    }
  }

  protected rename(name: string): void {
    this.name.set(name);
  }

  protected add(reportId: string): void {
    if (!reportId) {
      return;
    }

    this.model.update((model) => addPanel(model, this.page().id, reportId));
    const panels = this.page().panels;

    this.selectedPanel.set(panels[panels.length - 1].id);
    // El conjunto nuevo se vincula a los filtros que ya hay, por nombre de columna.
    void this.loadSnapshots().then(() => this.bindNewDatasets());
  }

  protected select(panel: DashboardPanel): void {
    if (this.editing() && this.selectedPanel() !== panel.id) {
      this.selectedPanel.set(panel.id);

      // El formulario de plantilla de panel es del panel que estaba elegido.
      if (this.savingTemplate() === 'Panel') {
        this.savingTemplate.set(null);
      }
    }
  }

  protected move(panel: DashboardPanel, delta: number): void {
    this.model.update((model) => movePanel(model, this.page().id, panel.id, delta));
  }

  protected resize(panel: DashboardPanel, width: number, height: number): void {
    this.model.update((model) => resizePanel(model, this.page().id, panel.id, width, height));
  }

  protected retitle(panel: DashboardPanel, title: string): void {
    this.model.update((model) => retitlePanel(model, this.page().id, panel.id, title));
  }

  protected remove(panel: DashboardPanel): void {
    this.model.update((model) => removePanel(model, this.page().id, panel.id));
    this.selectedPanel.set(null);
  }

  // --- Estilo y páginas ------------------------------------------------------------

  protected styleColor(color: string): void {
    this.model.update((model) => ({ ...model, style: { ...model.style, color: (color || null) as PaletteColor | null } }));
  }

  protected patchStyle(panel: DashboardPanel, patch: Parameters<typeof patchPanel>[3]): void {
    this.model.update((model) => patchPanel(model, this.page().id, panel.id, patch));
  }

  /**
   * El panel que está seleccionado ahora mismo.
   *
   * El inspector edita siempre este, leído al momento, y no el panel de su
   * bloque de plantilla: ese alias solo se pone al día al repintar, y quien
   * escribe justo después de cambiar de panel (una prueba, o un lector de
   * pantalla rápido) editaba el anterior.
   */
  private selectedNow(): DashboardPanel | null {
    const id = this.selectedPanel();

    return this.page().panels.find((panel) => panel.id === id) ?? null;
  }

  protected retitleSelected(title: string): void {
    const panel = this.selectedNow();

    if (panel) this.retitle(panel, title);
  }

  protected patchSelected(patch: Parameters<typeof patchPanel>[3]): void {
    const panel = this.selectedNow();

    if (panel) this.patchStyle(panel, patch);
  }

  protected moveSelectedTo(pageId: string): void {
    const panel = this.selectedNow();

    if (panel) this.movePanelTo(panel, pageId);
  }

  protected showPage(id: string): void {
    this.currentPage.set(id);
    this.selectedPanel.set(null);
  }

  protected addPage(): void {
    // i18n-keys: reports.dashboard.page
    const name = this._i18n.t('reports.dashboard.page', { number: this.pages().length + 1 });

    this.model.update((model) => addPage(model, name));
    this.showPage(this.pages()[this.pages().length - 1].id);
  }

  protected renamePage(name: string): void {
    this.model.update((model) => renamePage(model, this.page().id, name));
  }

  protected removePage(): void {
    this.model.update((model) => removePage(model, this.page().id));
    this.showPage(this.pages()[0].id);
  }

  protected movePanelTo(panel: DashboardPanel, pageId: string): void {
    this.model.update((model) => movePanelToPage(model, panel.id, pageId));
    this.selectedPanel.set(null);
  }

  /** Alt + flechas mueve, Mayús + flechas redimensiona: lo mismo que los botones. */
  protected keydown(event: KeyboardEvent, panel: DashboardPanel): void {
    if (!this.editing() || !(event.altKey || event.shiftKey)) {
      return;
    }

    const moves: Record<string, [number, number, number]> = event.altKey
      ? { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [-1, 0, 0], ArrowDown: [1, 0, 0] }
      : { ArrowLeft: [0, -1, 0], ArrowRight: [0, 1, 0], ArrowUp: [0, 0, -1], ArrowDown: [0, 0, 1] };
    const step = moves[event.key];

    if (!step) {
      return;
    }

    event.preventDefault();
    if (step[0] !== 0) this.move(panel, step[0]);
    else this.resize(panel, step[1], step[2]);
  }

  protected canGrow(panel: DashboardPanel): boolean {
    return panel.width < GRID_COLUMNS;
  }

  protected canShrink(panel: DashboardPanel): boolean {
    return panel.width > MIN_WIDTH;
  }

  protected canTaller(panel: DashboardPanel): boolean {
    return panel.height < MAX_HEIGHT;
  }

  protected canShorter(panel: DashboardPanel): boolean {
    return panel.height > MIN_HEIGHT;
  }

  protected index(panel: DashboardPanel): number {
    return this.page().panels.findIndex((item) => item.id === panel.id);
  }

  // --- Filtros en edición ------------------------------------------------------------

  protected addFilter(kind: DashboardFilterKind): void {
    // i18n-keys: reports.dashboard.filterKind.*
    const filter: DashboardFilter = {
      id: crypto.randomUUID(),
      kind,
      label: this._i18n.t(`reports.dashboard.filterKind.${kind}`),
      bindings: {},
    };

    this.model.update((model) => ({ ...model, filters: [...model.filters, filter] }));
    this.bindNewDatasets();
  }

  protected removeFilter(filter: DashboardFilter): void {
    this.model.update((model) => ({ ...model, filters: model.filters.filter((item) => item.id !== filter.id) }));
    this.values.update((map) => {
      const next = new Map(map);

      next.delete(filter.id);
      return next;
    });
  }

  protected relabel(filter: DashboardFilter, label: string): void {
    this.updateFilter(filter.id, (item) => ({ ...item, label }));
  }

  protected bind(filter: DashboardFilter, datasetId: string, column: string): void {
    this.updateFilter(filter.id, (item) => {
      const bindings = { ...item.bindings };

      if (column) bindings[datasetId] = column;
      else delete bindings[datasetId];

      return { ...item, bindings };
    });
  }

  protected columnsFor(filter: DashboardFilter, dataset: ReportDataset) {
    return (this.snapshots().get(dataset.id)?.columns ?? []).filter((column) => fitsFilter(filter.kind, column));
  }

  protected labelIn(dataset: ReportDataset, name: string): string {
    return columnLabelFor(dataset.sources, name);
  }

  /** Propone columna en los conjuntos que aún no la tienen, sin pisar lo elegido. */
  private bindNewDatasets(): void {
    for (const filter of this.filters()) {
      for (const dataset of this.usedDatasets()) {
        const snapshot = this.snapshots().get(dataset.id);

        if (snapshot && !(dataset.id in filter.bindings)) {
          const current = this.filters().find((item) => item.id === filter.id)!;
          const column = proposeBinding(current, snapshot.columns);

          if (column) this.bind(current, dataset.id, column);
        }
      }
    }
  }

  private updateFilter(id: string, change: (filter: DashboardFilter) => DashboardFilter): void {
    this.model.update((model) => ({
      ...model,
      filters: model.filters.map((filter) => (filter.id === id ? change(filter) : filter)),
    }));
  }

  // --- Guardar y borrar ----------------------------------------------------------------

  protected async save(): Promise<void> {
    const name = this.name().trim();

    if (!name || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    try {
      const saved = await firstValueFrom(
        this._gateway.saveDashboard({ id: this.dashboard().id, name, model: JSON.stringify(this.model()) }),
      );

      this._savedName.set(saved.name);
      this._savedModel.set(JSON.stringify(this.model()));
      this._persisted.set(true);
      this.setEditing(false);
      this.selectedPanel.set(null);
      this.saved.emit(saved);
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteDashboard(): Promise<void> {
    const id = this.dashboard().id;

    try {
      if (this._persisted()) {
        await firstValueFrom(this._gateway.deleteDashboard(id));
      }

      this.deleted.emit(id);
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }
  }

  // --- Plantillas ----------------------------------------------------------------------

  /**
   * Guarda el tablero entero —o el panel elegido— como plantilla.
   *
   * Se captura lo que se ve, con los cambios sin guardar: es el diseño que se
   * quiere reutilizar. Los tipos de los campos salen de los resultados
   * guardados que ya están cargados.
   */
  protected async saveAsTemplate(request: TemplateSaveRequest): Promise<void> {
    const scope = this.savingTemplate();
    const panel = this.selectedNow();
    const layout = scope === 'Panel' ? (panel ? panelLayout(this.model(), panel.id) : null) : this.model();

    if (!scope || !layout || this.templateBusy()) {
      return;
    }

    const document = captureTemplate(scope, request.name, request.description, {
      reports: this.reports(),
      datasets: this.datasets(),
      columnsOf: (id) => this.snapshots().get(id)?.columns ?? [],
      layout,
    });

    if (document.reports.length === 0) {
      this.error.set(this._i18n.t('reports.template.nothingToSave'));
      return;
    }

    this.templateBusy.set(true);
    this.error.set(null);

    try {
      await firstValueFrom(
        this._gateway.saveReportTemplate({
          id: crypto.randomUUID(),
          name: document.name,
          description: document.description,
          scope,
          model: JSON.stringify(document),
        }),
      );
      this.savingTemplate.set(null);
      this.notice.set(this._i18n.t('reports.template.savedNotice', { name: document.name }));
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.templateBusy.set(false);
    }
  }

  protected panelTemplateName(): string {
    return this.selected()?.title ?? '';
  }

  /**
   * Crea los reportes de la plantilla y pone sus paneles en esta página.
   *
   * Los reportes quedan guardados en sus conjuntos; los paneles son un cambio
   * del tablero, que se guarda con «Guardar» como cualquier otro.
   */
  protected async applyTemplate(application: TemplateApplication): Promise<void> {
    this.galleryOpen.set(false);
    this.error.set(null);

    const copy = instantiateTemplate(
      application.document,
      application.datasets,
      application.assignment,
      undefined,
      this.reports(),
    );

    try {
      const saved: SavedReport[] = [];

      for (const report of copy.reports) {
        saved.push(await firstValueFrom(this._gateway.saveReport(report)));
      }

      this.reports.update((list) => [...list, ...saved]);

      const panels =
        copy.layout?.pages.flatMap((page) => page.panels) ??
        saved.map((report) => ({
          id: crypto.randomUUID(),
          reportId: report.id,
          width: 6,
          height: 4,
          title: null,
          description: null,
          hideHeader: false,
          color: null,
        }));

      this.model.update((model) => insertPanels(model, this.page().id, panels));
      this.selectedPanel.set(panels[panels.length - 1]?.id ?? null);
      this.notice.set(this._i18n.t('reports.template.appliedPanels', { count: panels.length }));
      await this.loadSnapshots();
      this.bindNewDatasets();
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }
  }
}

const EMPTY_KEY = 'empty';
