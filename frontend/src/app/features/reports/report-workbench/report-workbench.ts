import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { catchError, firstValueFrom, of } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatDate } from '../../../core/i18n/locale-format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { describeError } from '../../../core/workspace/errors';
import {
  ReportDataset,
  ReportRun,
  ReportSchedule,
  ReportSnapshot,
  ReportStorage,
  ReportVisualKind,
  SavedReport,
} from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { ReportChart } from '../report-chart/report-chart';
import { ReportHistory } from '../report-history/report-history';
import { ReportScheduleForm } from '../report-schedule/report-schedule';
import {
  ReportTemplateGallery,
  TemplateApplication,
} from '../report-template-gallery/report-template-gallery';
import {
  ReportTemplateSave,
  TemplateSaveRequest,
} from '../report-template-save/report-template-save';
import { captureTemplate, instantiateTemplate } from '../report-template-model';
import { ServerMessage } from '../../../shared/models/workspace';
import { failureText, serverText } from '../report-messages';
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
  imports: [
    Icon,
    ReportChart,
    ReportHistory,
    ReportScheduleForm,
    ReportTemplateGallery,
    ReportTemplateSave,
    TranslatePipe,
  ],
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
  protected readonly notice = signal<string | null>(null);
  /** Plantillas: la galería abierta, el formulario de guardar y si se está guardando. */
  protected readonly galleryOpen = signal(false);
  protected readonly savingTemplate = signal(false);
  protected readonly templateBusy = signal(false);
  protected readonly currentDatasets = computed(() => [this.dataset()]);
  /** Historial y espacio: los intentos guardados, el panel abierto y lo que ocupa. */
  protected readonly runs = signal<readonly ReportRun[]>([]);
  protected readonly historyOpen = signal(false);
  protected readonly storage = signal<ReportStorage | null>(null);
  protected readonly clearing = signal(false);
  /** Programación: la guardada, si el formulario está abierto y si se está guardando. */
  protected readonly schedule = signal<ReportSchedule | null>(null);
  protected readonly scheduling = signal(false);
  protected readonly scheduleBusy = signal(false);

  /** Qué dice la barra de datos sobre la programación: clave del catálogo y fecha. */
  protected readonly scheduleStatus = computed(() => {
    const schedule = this.schedule();

    if (!schedule) {
      return null;
    }

    if (schedule.paused) {
      return { key: 'reports.schedule.status.paused', date: null };
    }

    if (schedule.running) {
      return { key: 'reports.schedule.status.running', date: null };
    }

    if (schedule.retryAtUtc) {
      return { key: 'reports.schedule.status.retry', date: schedule.retryAtUtc };
    }

    return schedule.nextRunUtc
      ? { key: 'reports.schedule.status.next', date: schedule.nextRunUtc }
      : null;
  });

  /** La próxima mirada por si llegó una actualización programada con esto abierto. */
  private _watch: ReturnType<typeof setTimeout> | null = null;

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

  protected readonly saved = computed(
    () => this.reports().find((report) => report.id === this.draft()?.id) ?? null,
  );

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

    return snapshot && draft?.visual === 'Indicator'
      ? buildIndicator(snapshot, draft.settings)
      : null;
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

    inject(DestroyRef).onDestroy(() => this.stopWatch());
  }

  private async load(datasetId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.draft.set(null);
    this.savingTemplate.set(false);
    this.scheduling.set(false);
    this.schedule.set(null);
    this.historyOpen.set(false);
    this.runs.set([]);
    this.stopWatch();

    try {
      const [snapshot, runs, reports, schedule] = await Promise.all([
        firstValueFrom(this._gateway.getReportSnapshot(datasetId)),
        firstValueFrom(this._gateway.getReportRuns(datasetId)),
        firstValueFrom(this._gateway.getSavedReports(datasetId)),
        // Sin saber la programación los datos se ven igual: no tumba la carga.
        firstValueFrom(this._gateway.getReportSchedule(datasetId).pipe(catchError(() => of(null)))),
      ]);

      this.snapshot.set(snapshot);
      this.lastRun.set(runs[0] ?? null);
      this.runs.set(runs);
      this.reports.set(reports);
      this.schedule.set(schedule);
      this.armWatch();

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

      if (result.run) {
        this.runs.update((runs) => [result.run!, ...runs].slice(0, 20));
      }

      if (this.historyOpen()) {
        void this.loadStorage();
      }

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

  /** Cómo se cuenta un intento fallido: programado o a mano, con o sin datos anteriores. */
  protected failureKey(run: ReportRun): string {
    const prefix =
      run.origin === 'Scheduled' ? 'reports.data.scheduledFailed' : 'reports.data.failed';

    return this.snapshot() ? `${prefix}Keeps` : prefix;
  }

  // --- Historial y espacio ----------------------------------------------------------

  protected toggleHistory(): void {
    const open = !this.historyOpen();

    this.historyOpen.set(open);

    if (open) {
      void this.loadStorage();
    }
  }

  private async loadStorage(): Promise<void> {
    try {
      this.storage.set(await firstValueFrom(this._gateway.getReportStorage()));
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }
  }

  /** Borra el resultado guardado: el conjunto vuelve a «Todavía no hay datos». */
  protected async clearData(): Promise<void> {
    const datasetId = this.dataset().id;

    this.clearing.set(true);
    this.error.set(null);

    try {
      await firstValueFrom(this._gateway.deleteReportSnapshot(datasetId));
      this.snapshot.set(null);
      this.notice.set(this._i18n.t('reports.history.cleared'));
      await this.loadStorage();
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.clearing.set(false);
    }
  }

  // --- Programar -----------------------------------------------------------------

  protected async saveSchedule(schedule: ReportSchedule): Promise<void> {
    const datasetId = this.dataset().id;

    this.scheduleBusy.set(true);
    this.error.set(null);

    try {
      this.schedule.set(
        await firstValueFrom(this._gateway.saveReportSchedule(datasetId, schedule)),
      );
      this.scheduling.set(false);
      this.armWatch();
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.scheduleBusy.set(false);
    }
  }

  protected async removeSchedule(): Promise<void> {
    const datasetId = this.dataset().id;

    this.scheduleBusy.set(true);
    this.error.set(null);

    try {
      await firstValueFrom(this._gateway.deleteReportSchedule(datasetId));
      this.schedule.set(null);
      this.scheduling.set(false);
      this.stopWatch();
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.scheduleBusy.set(false);
    }
  }

  /**
   * Programa la próxima mirada: un poco después del horario o del reintento, y
   * cada pocos segundos mientras el servidor no lo haya despachado. Así el dato
   * nuevo aparece solo, sin tener que reabrir el conjunto.
   */
  private armWatch(): void {
    this.stopWatch();

    const schedule = this.schedule();

    if (!schedule || schedule.paused) {
      return;
    }

    const due = [schedule.nextRunUtc, schedule.retryAtUtc]
      .filter((value): value is string => !!value)
      .map((value) => Date.parse(value));
    const target = schedule.running || due.length === 0 ? Date.now() : Math.min(...due);
    const delay = Math.min(Math.max(target - Date.now() + 2_000, 5_000), 60 * 60 * 1_000);
    const datasetId = this.dataset().id;

    this._watch = setTimeout(() => void this.checkScheduled(datasetId), delay);
  }

  private stopWatch(): void {
    if (this._watch !== null) {
      clearTimeout(this._watch);
      this._watch = null;
    }
  }

  private async checkScheduled(datasetId: string): Promise<void> {
    this._watch = null;

    try {
      const [schedule, runs] = await Promise.all([
        firstValueFrom(this._gateway.getReportSchedule(datasetId)),
        firstValueFrom(this._gateway.getReportRuns(datasetId)),
      ]);

      if (this.dataset().id !== datasetId) {
        return;
      }

      this.schedule.set(schedule);
      this.runs.set(runs);

      const latest = runs[0] ?? null;

      if (latest && latest.id !== this.lastRun()?.id && !this.refreshing()) {
        this.lastRun.set(latest);

        if (latest.status === 'Succeeded') {
          this.snapshot.set(await firstValueFrom(this._gateway.getReportSnapshot(datasetId)));

          if (!this.draft()) {
            this.newReport();
          }
        }
      }
    } catch {
      // La API local no respondió esta vez; se vuelve a mirar en la siguiente.
    }

    if (this.dataset().id === datasetId) {
      this.armWatch();
    }
  }

  protected when(iso: string): string {
    return formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected failureText(
    code: string | null,
    message: string | null,
    localized?: ServerMessage | null,
  ): string {
    return failureText(this._i18n, code, message, localized);
  }

  protected serverText(
    localized: ServerMessage | null | undefined,
    message: string | null,
  ): string | null {
    return serverText(this._i18n, localized, message);
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
          value:
            base.value === null && visual === 'Table' ? null : (draft.settings.value ?? base.value),
          aggregate: draft.settings.aggregate,
        },
      };
    });
  }

  protected patch(patch: Partial<ReportSettings>): void {
    this.draft.update((draft) =>
      draft ? { ...draft, settings: { ...draft.settings, ...patch } } : draft,
    );
  }

  protected patchLook(patch: Partial<ReportAppearance>): void {
    this.draft.update((draft) =>
      draft
        ? {
            ...draft,
            settings: { ...draft.settings, appearance: { ...draft.settings.appearance, ...patch } },
          }
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

    const current =
      draft.settings.columns.length > 0
        ? draft.settings.columns
        : this.columns().map((column) => column.name);
    const next = shown ? [...current, name] : current.filter((item) => item !== name);

    // Vuelve a «todas» cuando están todas: así una columna nueva del conjunto aparece sola.
    this.patch({
      columns:
        next.length === this.columns().length
          ? []
          : this.columns()
              .map((c) => c.name)
              .filter((c) => next.includes(c)),
    });
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
  // --- Plantillas ------------------------------------------------------------------

  /** Guarda el reporte que se está viendo —con sus cambios sin guardar— como plantilla. */
  protected async saveAsTemplate(request: TemplateSaveRequest): Promise<void> {
    const draft = this.draft();

    if (!draft || this.templateBusy()) {
      return;
    }

    const datasetId = this.dataset().id;
    const document = captureTemplate('Report', request.name, request.description, {
      reports: [
        {
          id: draft.id,
          datasetId,
          name: draft.name.trim(),
          visual: draft.visual,
          settings: JSON.stringify(draft.settings),
        },
      ],
      datasets: [this.dataset()],
      columnsOf: () => this.columns(),
    });

    await this.storeTemplate(document.name, document.description, JSON.stringify(document));
  }

  private async storeTemplate(
    name: string,
    description: string | null,
    model: string,
  ): Promise<void> {
    this.templateBusy.set(true);
    this.error.set(null);

    try {
      await firstValueFrom(
        this._gateway.saveReportTemplate({
          id: crypto.randomUUID(),
          name,
          description,
          scope: 'Report',
          model,
        }),
      );
      this.savingTemplate.set(false);
      this.notice.set(this._i18n.t('reports.template.savedNotice', { name }));
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.templateBusy.set(false);
    }
  }

  /** Crea en este conjunto los reportes de la plantilla y abre el primero. */
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

      if (saved.length > 0) {
        this.select(saved[0]);
      }

      this.notice.set(this._i18n.t('reports.template.appliedReports', { count: saved.length }));
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }
  }
}
