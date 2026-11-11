import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
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
  ReportRun,
  ReportSnapshot,
  ReportVisualKind,
  SavedReport,
} from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { ReportChart } from '../report-chart/report-chart';
import {
  AGGREGATES,
  MAX_CATEGORY_COLORS,
  PALETTE,
  ReportAppearance,
  categoryColors,
  ReportAggregate,
  ReportSettings,
  buildIndicator,
  buildSeries,
  defaultSettings,
  isNumericColumn,
  parseSettings,
  repeatedInUse,
  tableView,
} from '../report-chart';

/** Lo que se está editando: el reporte con sus ajustes ya leídos. */
interface ReportDraft {
  readonly id: string;
  readonly name: string;
  readonly visual: ReportVisualKind;
  readonly settings: ReportSettings;
}

export const VISUALS: readonly ReportVisualKind[] = ['Table', 'Bar', 'Line', 'Indicator'];

/**
 * El paso Visualización: actualizar el conjunto, ver su último resultado y
 * armar reportes sobre él.
 *
 * Todo lo que se dibuja sale del resultado guardado, no de los orígenes: por
 * eso un reporte se abre con las bases apagadas, y por eso el estado de los
 * datos —de cuándo son, si el último intento falló— va siempre a la vista.
 */
@Component({
  selector: 'app-report-workbench',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ReportChart, TranslatePipe],
  templateUrl: './report-workbench.html',
  styleUrl: './report-workbench.scss',
})
export class ReportWorkbench {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _i18n = inject(I18nService);

  /** La definición guardada: es la que usa «Actualizar ahora». */
  readonly dataset = input.required<ReportDataset>();
  /** Hay cambios sin guardar en la definición; la actualización no los verá. */
  readonly definitionDirty = input(false);
  readonly inspectorOpen = input(true);
  readonly columnLabel = input<(name: string) => string>((name) => name);

  protected readonly visuals = VISUALS;
  protected readonly aggregates = AGGREGATES;
  protected readonly palette = PALETTE;
  protected readonly maxCategoryColors = MAX_CATEGORY_COLORS;

  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly snapshot = signal<ReportSnapshot | null>(null);
  protected readonly lastRun = signal<ReportRun | null>(null);
  protected readonly reports = signal<readonly SavedReport[]>([]);
  protected readonly draft = signal<ReportDraft | null>(null);
  protected readonly asTable = signal(false);
  protected readonly savingReport = signal(false);

  /** El último intento falló después del último resultado bueno. */
  protected readonly failedAfterData = computed(() => {
    const run = this.lastRun();
    const snapshot = this.snapshot();

    return (
      run !== null &&
      run.status !== 'Succeeded' &&
      (snapshot === null || run.startedAtUtc > snapshot.completedAtUtc)
    );
  });

  protected readonly columns = computed(() => this.snapshot()?.columns ?? []);
  protected readonly numericColumns = computed(() => this.columns().filter(isNumericColumn));

  protected readonly saved = computed(() => this.reports().find((report) => report.id === this.draft()?.id) ?? null);

  protected readonly reportDirty = computed(() => {
    const draft = this.draft();
    const saved = this.saved();

    return (
      draft !== null &&
      (saved === null ||
        saved.name !== draft.name.trim() ||
        saved.visual !== draft.visual ||
        saved.settings !== JSON.stringify(draft.settings))
    );
  });

  protected readonly series = computed(() => {
    const snapshot = this.snapshot();
    const draft = this.draft();

    return snapshot && draft && (draft.visual === 'Bar' || draft.visual === 'Line')
      ? buildSeries(snapshot, draft.settings)
      : null;
  });

  protected readonly indicator = computed(() => {
    const snapshot = this.snapshot();
    const draft = this.draft();

    return snapshot && draft?.visual === 'Indicator' ? buildIndicator(snapshot, draft.settings) : null;
  });

  protected readonly table = computed(() => {
    const snapshot = this.snapshot();
    const draft = this.draft();

    return snapshot && draft?.visual === 'Table' ? tableView(snapshot, draft.settings) : null;
  });

  /** Colores por categoría, del resultado entero: el color sigue a la categoría. */
  protected readonly categoryColorMap = computed(() => {
    const snapshot = this.snapshot();
    const draft = this.draft();

    return snapshot && draft ? categoryColors(snapshot, draft.settings) : null;
  });

  /** Un color por categoría solo si caben en la paleta, sin repetir tonos. */
  protected readonly categoryColorsAvailable = computed(() => this.categoryColorMap() !== null);

  protected readonly repeated = computed(() => {
    const snapshot = this.snapshot();
    const draft = this.draft();

    return snapshot && draft ? repeatedInUse(snapshot, draft.settings) : [];
  });

  protected readonly missing = computed(() => [
    ...(this.series()?.missing ?? []),
    ...(this.indicator()?.missing ?? []),
  ]);

  protected readonly valueLabel = computed(() => {
    const draft = this.draft();

    if (!draft) {
      return '';
    }

    // i18n-keys: reports.aggregate.*
    const how = this._i18n.t(`reports.aggregate.${draft.settings.aggregate}`);

    return draft.settings.aggregate === 'Count' || !draft.settings.value
      ? how
      : `${how} · ${this.columnLabel()(draft.settings.value)}`;
  });

  protected readonly categoryLabel = computed(() => {
    const category = this.draft()?.settings.category;

    return category ? this.columnLabel()(category) : '';
  });

  constructor() {
    // Al abrir otro conjunto se recarga todo; editar su nombre no.
    effect(() => {
      const id = this.dataset().id;

      untracked(() => void this.load(id));
    });
  }

  private async load(datasetId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.draft.set(null);

    try {
      const [snapshot, runs, reports] = await Promise.all([
        firstValueFrom(this._gateway.getReportSnapshot(datasetId)),
        firstValueFrom(this._gateway.getReportRuns(datasetId)),
        firstValueFrom(this._gateway.getSavedReports(datasetId)),
      ]);

      this.snapshot.set(snapshot);
      this.lastRun.set(runs[0] ?? null);
      this.reports.set(reports);

      if (reports.length > 0) {
        this.select(reports[0]);
      }
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.loading.set(false);
    }
  }

  // --- Actualizar ---------------------------------------------------------------

  protected async refresh(): Promise<void> {
    if (this.refreshing()) {
      return;
    }

    const datasetId = this.dataset().id;

    this.refreshing.set(true);
    this.error.set(null);

    try {
      const result = await firstValueFrom(this._gateway.refreshReportDataset(datasetId));

      this.lastRun.set(result.run);

      // Un intento fallido no cambia el resultado: solo se relee si hubo uno nuevo.
      if (result.outcome === 'Refreshed') {
        this.snapshot.set(await firstValueFrom(this._gateway.getReportSnapshot(datasetId)));

        if (!this.draft()) {
          this.newReport();
        }
      }
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.refreshing.set(false);
    }
  }

  protected when(iso: string): string {
    return formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected failureText(code: string | null, message: string | null): string {
    // i18n-keys: reports.failure.*
    const key = `reports.failure.${code ?? 'unknown'}`;
    const known = this._i18n.t(key);

    return code === 'database-error' || code === 'invalid-query' || known === key ? (message ?? known) : known;
  }

  // --- Reportes ------------------------------------------------------------------

  protected select(report: SavedReport): void {
    this.draft.set({
      id: report.id,
      name: report.name,
      visual: report.visual,
      settings: parseSettings(report.settings, report.visual, this.columns()),
    });
    this.asTable.set(false);
  }

  protected isSelected(report: SavedReport): boolean {
    return this.draft()?.id === report.id;
  }

  protected newReport(): void {
    const visual: ReportVisualKind = this.numericColumns().length > 0 ? 'Bar' : 'Table';

    this.draft.set({
      id: crypto.randomUUID(),
      name: this._i18n.t('reports.report.defaultName', { number: this.reports().length + 1 }),
      visual,
      settings: defaultSettings(visual, this.columns()),
    });
    this.asTable.set(false);
  }

  protected rename(name: string): void {
    this.draft.update((draft) => (draft ? { ...draft, name } : draft));
  }

  /** Al cambiar de tipo se conservan los campos que sigan teniendo sentido. */
  protected chooseVisual(visual: ReportVisualKind): void {
    this.draft.update((draft) => {
      if (!draft || draft.visual === visual) {
        return draft;
      }

      const base = defaultSettings(visual, this.columns());

      return {
        ...draft,
        visual,
        settings: {
          ...base,
          category: base.category === null ? null : (draft.settings.category ?? base.category),
          value: base.value === null && visual === 'Table' ? null : (draft.settings.value ?? base.value),
          aggregate: draft.settings.aggregate,
        },
      };
    });
  }

  protected patch(patch: Partial<ReportSettings>): void {
    this.draft.update((draft) => (draft ? { ...draft, settings: { ...draft.settings, ...patch } } : draft));
  }

  protected patchLook(patch: Partial<ReportAppearance>): void {
    this.draft.update((draft) =>
      draft
        ? { ...draft, settings: { ...draft.settings, appearance: { ...draft.settings.appearance, ...patch } } }
        : draft,
    );
  }

  /** Un campo numérico vacío es «sin umbral». */
  protected number(text: string): number | null {
    return text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text);
  }

  protected chooseAggregate(aggregate: string): void {
    this.patch({ aggregate: aggregate as ReportAggregate });
  }

  protected toggleColumn(name: string, shown: boolean): void {
    const draft = this.draft();

    if (!draft) {
      return;
    }

    const current = draft.settings.columns.length > 0
      ? draft.settings.columns
      : this.columns().map((column) => column.name);
    const next = shown ? [...current, name] : current.filter((item) => item !== name);

    // Vuelve a «todas» cuando están todas: así una columna nueva del conjunto aparece sola.
    this.patch({ columns: next.length === this.columns().length ? [] : this.columns().map((c) => c.name).filter((c) => next.includes(c)) });
  }

  protected isShown(name: string): boolean {
    const columns = this.draft()?.settings.columns ?? [];

    return columns.length === 0 || columns.includes(name);
  }

  protected async saveReport(): Promise<void> {
    const draft = this.draft();

    if (!draft || !draft.name.trim() || this.savingReport()) {
      return;
    }

    this.savingReport.set(true);
    this.error.set(null);

    try {
      const saved = await firstValueFrom(
        this._gateway.saveReport({
          id: draft.id,
          datasetId: this.dataset().id,
          name: draft.name.trim(),
          visual: draft.visual,
          settings: JSON.stringify(draft.settings),
        }),
      );

      this.reports.update((list) =>
        list.some((item) => item.id === saved.id)
          ? list.map((item) => (item.id === saved.id ? saved : item))
          : [...list, saved],
      );
      this.draft.update((current) => (current ? { ...current, name: saved.name } : current));
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.savingReport.set(false);
    }
  }

  protected async deleteReport(): Promise<void> {
    const draft = this.draft();

    if (!draft) {
      return;
    }

    try {
      if (this.saved()) {
        await firstValueFrom(this._gateway.deleteReport(draft.id));
      }

      const rest = this.reports().filter((item) => item.id !== draft.id);

      this.reports.set(rest);
      this.draft.set(null);

      if (rest.length > 0) {
        this.select(rest[0]);
      }
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }
  }
}
