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
  SavedReport,
} from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { ReportChart } from '../report-chart/report-chart';
import { buildIndicator, buildSeries, parseSettings, repeatedInUse, tableView } from '../report-chart';
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
  addPanel,
  applyFilters,
  categoryOptions,
  fitsFilter,
  isActive,
  movePanel,
  parseDashboard,
  proposeBinding,
  removePanel,
  resizePanel,
  retitlePanel,
} from '../report-dashboard-model';
import { columnLabelFor } from '../report-draft';

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
  imports: [Icon, ReportChart, TranslatePipe],
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

  protected readonly page = computed(() => this.model().pages[0]);
  protected readonly filters = computed(() => this.model().filters);

  protected readonly dirty = computed(
    () => this.name().trim() !== this._savedName() || JSON.stringify(this.model()) !== this._savedModel(),
  );

  /** Los conjuntos que alimentan algún panel: son los que se actualizan y se filtran. */
  protected readonly usedDatasets = computed(() => {
    const ids = new Set(
      this.page().panels
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
    this.confirmDelete.set(false);
    this.notice.set(null);
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
    };

    if (!report || !dataset || !stored) {
      return empty;
    }

    const { snapshot, unbound } = applyFilters(stored, dataset.id, this.filters(), this.values());
    const settings = parseSettings(report.settings, report.visual, snapshot.columns);
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
    };
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
  }

  protected rename(name: string): void {
    this.name.set(name);
  }

  protected add(reportId: string): void {
    if (!reportId) {
      return;
    }

    this.model.update((model) => addPanel(model, this.page().id, reportId));
    const panels = this.model().pages[0].panels;

    this.selectedPanel.set(panels[panels.length - 1].id);
    // El conjunto nuevo se vincula a los filtros que ya hay, por nombre de columna.
    void this.loadSnapshots().then(() => this.bindNewDatasets());
  }

  protected select(panel: DashboardPanel): void {
    if (this.editing()) {
      this.selectedPanel.set(panel.id);
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
}

const EMPTY_KEY = 'empty';
