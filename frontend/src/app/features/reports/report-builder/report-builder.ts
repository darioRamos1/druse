import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  SavedCompositionRecord,
} from '../../../core/application-gateway/application-gateway';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatDate, formatNumber } from '../../../core/i18n/locale-format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { describeError } from '../../../core/workspace/errors';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DialogBackdrop } from '../../../shared/a11y/dialog-backdrop';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';
import {
  ReportColumn,
  ReportDataset,
  ReportDatasetPreview,
  ReportJoin,
  ReportJoinPreview,
  ReportSource,
  ReportSourcePreview,
  ReportValue,
  SavedDashboard,
} from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { ReportWorkbench } from '../report-workbench/report-workbench';
import { ReportDashboard } from '../report-dashboard/report-dashboard';
import { emptyDashboard } from '../report-dashboard-model';
import {
  MAX_SOURCES,
  adoptExpectedColumns,
  applyComposition,
  columnLabelFor,
  draftProblems,
  newDataset,
  newSource,
  nextAlias,
  readVisualModel,
  sameDefinition,
  sourceFingerprint,
  suggestKeys,
  toSqlMode,
  toVisualMode,
  visualWouldDiscardSql,
} from '../report-draft';

export type ReportStep = 'sources' | 'join' | 'visual';

/** Qué se ve en el centro: una fuente o el cruce. */
export type PreviewView = { readonly kind: 'source'; readonly index: number } | { readonly kind: 'join' };

/** Una pregunta que espera respuesta antes de hacer algo que descarta trabajo. */
interface PendingConfirm {
  readonly message: string;
  readonly confirmLabel: string;
  readonly run: () => void;
}

/** Por fuente: lo que hay para elegir en su conexión. */
interface SourceOptions {
  readonly databases: readonly string[];
  readonly loading: boolean;
  readonly error: string | null;
}

const EMPTY_OPTIONS: SourceOptions = { databases: [], loading: false, error: null };

/**
 * Hay sitio para el inspector al lado de la vista previa.
 *
 * El mismo corte que la hoja de estilos: por debajo de 1.100 px el inspector
 * pasa a panel superpuesto. Sin `matchMedia` (pruebas) se supone que sí cabe.
 */
function wideLayout(): boolean {
  return !(globalThis.matchMedia?.('(max-width: 1100px)').matches ?? false);
}

/**
 * Constructor de conjuntos de datos de Reportes BI.
 *
 * Navegación a la izquierda (pasos y conjuntos guardados), vista previa en el
 * centro y la configuración en un inspector plegable a la derecha: lo que más
 * espacio necesita es ver qué devuelve cada fuente y qué sale al cruzarlas.
 */
@Component({
  selector: 'app-report-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogBackdrop, DialogFocus, Icon, NgTemplateOutlet, ReportDashboard, ReportWorkbench, TranslatePipe],
  templateUrl: './report-builder.html',
  styleUrl: './report-builder.scss',
})
export class ReportBuilder {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _store = inject(WorkspaceStore);
  private readonly _i18n = inject(I18nService);

  readonly closed = output<void>();

  protected readonly datasets = signal<readonly ReportDataset[]>([]);
  protected readonly loadingList = signal(true);
  protected readonly dashboards = signal<readonly SavedDashboard[]>([]);

  /**
   * Qué ocupa el centro: el constructor de un conjunto o un tablero.
   *
   * El borrador del conjunto se conserva al abrir un tablero: volver a los
   * pasos lo encuentra donde estaba.
   */
  protected readonly mode = signal<'dataset' | 'dashboard'>('dataset');
  protected readonly openDashboard = signal<SavedDashboard | null>(null);
  private readonly _dashboardDirty = signal(false);

  protected readonly draft = signal<ReportDataset>(
    newDataset(crypto.randomUUID(), this._i18n.t('reports.untitled')),
  );

  /** La última versión guardada de lo que se está editando, para saber si hay cambios. */
  private readonly _saved = signal<ReportDataset | null>(null);

  /** Lo que usa Visualización: la definición guardada, no la que se está editando. */
  protected readonly savedDataset = this._saved.asReadonly();

  /** Para pasar a los hijos sin perder `this`. */
  protected readonly labelOf = (name: string): string => this.columnLabel(name);

  protected readonly step = signal<ReportStep>('sources');
  protected readonly activeSource = signal(0);
  protected readonly view = signal<PreviewView>({ kind: 'source', index: 0 });
  protected readonly inspectorOpen = signal(wideLayout());

  protected readonly preview = signal<ReportDatasetPreview | null>(null);
  protected readonly previewing = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly confirm = signal<PendingConfirm | null>(null);

  /** El SQL de cada fuente cuando se previsualizó, para no fiarse de una vista vieja. */
  private readonly _previewedSql = signal<ReadonlyMap<string, string>>(new Map());

  private readonly _options = signal<ReadonlyMap<string, SourceOptions>>(new Map());

  /** Composiciones guardadas por `conexión|base`, pedidas solo al elegir esa base. */
  private readonly _compositions = signal<ReadonlyMap<string, readonly SavedCompositionRecord[]>>(new Map());

  /** Solo las conexiones guardadas: una fuente tiene que poder reabrirse mañana. */
  protected readonly connections = computed(() =>
    this._store.connections().filter((connection) => connection.saved),
  );

  protected readonly sources = computed(() => this.draft().sources);
  protected readonly current = computed<ReportSource | null>(
    () => this.sources()[this.activeSource()] ?? null,
  );
  protected readonly canAddSource = computed(() => this.sources().length < MAX_SOURCES);
  protected readonly hasJoin = computed(() => this.sources().length === MAX_SOURCES);
  protected readonly problems = computed(() => draftProblems(this.draft()));

  /**
   * Lo que impide leer las fuentes. La unión no cuenta: sus columnas se eligen
   * entre las que devuelve cada fuente, así que hay que poder leerlas antes.
   */
  protected readonly previewProblems = computed(() =>
    this.problems().filter((problem) => problem !== 'reports.problem.joinKeys'),
  );
  protected readonly dirty = computed(() => {
    const saved = this._saved();

    return saved === null ? this.sources().length > 0 : !sameDefinition(saved, this.draft());
  });

  protected readonly currentOptions = computed(() => {
    const source = this.current();

    return (source && this._options().get(source.connectionId)) ?? EMPTY_OPTIONS;
  });

  /** Composiciones de la base elegida en la fuente activa. */
  protected readonly currentCompositions = computed(() => {
    const source = this.current();

    return source ? (this._compositions().get(`${source.connectionId}|${source.database}`) ?? []) : [];
  });

  protected readonly currentVisual = computed(() => {
    const source = this.current();

    return source ? readVisualModel(source) : null;
  });

  protected readonly sourcePreview = computed<ReportSourcePreview | null>(() => {
    const view = this.view();
    const source = view.kind === 'source' ? this.sources()[view.index] : undefined;

    return source ? (this.preview()?.sources.find((item) => item.alias === source.alias) ?? null) : null;
  });

  protected readonly joinPreview = computed<ReportJoinPreview | null>(() => this.preview()?.join ?? null);

  /** Una vista previa que ya no describe la fuente porque se cambió después. */
  protected readonly stale = computed(() => {
    const view = this.view();
    const previewed = this._previewedSql();

    if (!this.preview()) {
      return false;
    }

    const changed = (source: ReportSource) => previewed.get(source.alias) !== sourceFingerprint(source);

    return view.kind === 'join'
      ? this.sources().some(changed)
      : this.sources()[view.index] !== undefined && changed(this.sources()[view.index]);
  });

  protected readonly leftColumns = computed(() => this.columnsOf(0));
  protected readonly rightColumns = computed(() => this.columnsOf(1));

  constructor() {
    void this.loadList();
  }

  // --- Conjuntos guardados -------------------------------------------------

  private async loadList(): Promise<void> {
    this.loadingList.set(true);

    try {
      const [datasets, dashboards] = await Promise.all([
        firstValueFrom(this._gateway.getReportDatasets()),
        firstValueFrom(this._gateway.getDashboards()),
      ]);

      this.datasets.set(datasets);
      this.dashboards.set(dashboards);
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.loadingList.set(false);
    }
  }

  protected isOpen(dataset: ReportDataset): boolean {
    return this.mode() === 'dataset' && dataset.id === this.draft().id;
  }

  protected open(dataset: ReportDataset): void {
    this.guard(() => this.load(dataset));
  }

  protected startNew(): void {
    this.guard(() => {
      this._saved.set(null);
      this.reset(newDataset(crypto.randomUUID(), this._i18n.t('reports.untitled')));
    });
  }

  private load(dataset: ReportDataset): void {
    this._saved.set(dataset);
    this.reset(dataset);

    for (const source of dataset.sources) {
      void this.loadOptions(source.connectionId);
      void this.loadCompositions(source.connectionId, source.database);
    }
  }

  private reset(dataset: ReportDataset): void {
    this.leaveDashboard();
    this.draft.set(dataset);
    this.preview.set(null);
    this._previewedSql.set(new Map());
    this.activeSource.set(0);
    this.view.set({ kind: 'source', index: 0 });
    this.step.set('sources');
    this.error.set(null);
    this.notice.set(null);
  }

  protected rename(name: string): void {
    this.draft.update((draft) => ({ ...draft, name }));
  }

  protected async save(): Promise<void> {
    if (this.problems().length > 0 || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    try {
      const toSave = adoptExpectedColumns(this.draft(), this.preview(), this._previewedSql());
      const saved = await firstValueFrom(this._gateway.saveReportDataset(toSave));

      this._saved.set(saved);
      this.draft.set(saved);
      this.datasets.update((list) => [saved, ...list.filter((item) => item.id !== saved.id)]);
      this.notice.set(this._i18n.t('reports.saved', { version: saved.version }));
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.saving.set(false);
    }
  }

  protected remove(): void {
    const draft = this.draft();

    this.ask(
      this._i18n.t('reports.confirm.delete', { name: draft.name }),
      this._i18n.t('reports.delete'),
      async () => {
        try {
          if (this._saved() !== null) {
            await firstValueFrom(this._gateway.deleteReportDataset(draft.id));
          }

          this.datasets.update((list) => list.filter((item) => item.id !== draft.id));
          this._saved.set(null);
          this.reset(newDataset(crypto.randomUUID(), this._i18n.t('reports.untitled')));
        } catch (error) {
          this.error.set(describeError(error, this._i18n));
        }
      },
    );
  }

  protected close(): void {
    this.guard(() => this.closed.emit());
  }

  // --- Pasos y vista ---------------------------------------------------------

  protected goTo(step: ReportStep): void {
    // Desde un tablero, los pasos devuelven al conjunto que se estaba editando.
    if (this.mode() === 'dashboard') {
      this.guard(() => {
        this.leaveDashboard();
        this.goTo(step);
      }, 'dashboard');
      return;
    }

    if ((step === 'visual' && this._saved() === null) || (step === 'join' && !this.hasJoin())) {
      return;
    }

    this.step.set(step);
    if (step !== 'visual') {
      this.view.set(step === 'join' ? { kind: 'join' } : { kind: 'source', index: this.activeSource() });
    }
    // En ancho estrecho el inspector se superpone: abrirlo solo al cambiar de
    // paso taparía «Actualizar ahora» y la vista previa. Ahí se abre con su botón.
    if (wideLayout()) {
      this.inspectorOpen.set(true);
    }

    if (step === 'join') {
      this.proposeKeys();
    }
  }

  protected show(view: PreviewView): void {
    this.view.set(view);

    if (view.kind === 'source') {
      this.activeSource.set(view.index);
    }
  }

  protected isView(view: PreviewView): boolean {
    const current = this.view();

    return view.kind === 'join'
      ? current.kind === 'join'
      : current.kind === 'source' && current.index === view.index;
  }

  protected toggleInspector(): void {
    this.inspectorOpen.update((open) => !open);
  }

  // --- Fuentes ---------------------------------------------------------------

  protected addSource(): void {
    if (!this.canAddSource()) {
      return;
    }

    // La segunda fuente arranca en la misma conexión que la primera: es lo más
    // probable cuando se cruzan dos bases del mismo servidor.
    const first = this.sources()[0];
    const connection = first?.connectionId ?? this.connections()[0]?.id ?? '';
    const source = newSource(nextAlias(this.sources(), this._i18n.t('reports.source.defaultAlias')), connection, '');

    this.draft.update((draft) => ({ ...draft, sources: [...draft.sources, source] }));
    const index = this.sources().length - 1;

    this.activeSource.set(index);
    this.view.set({ kind: 'source', index });
    this.step.set('sources');
    this.inspectorOpen.set(true);

    if (connection) {
      void this.loadOptions(connection);
    }
  }

  protected removeSource(index: number): void {
    this.draft.update((draft) => ({
      ...draft,
      sources: draft.sources.filter((_, i) => i !== index),
      // Sin segunda fuente no hay nada que unir.
      join: null,
    }));
    this.activeSource.set(0);
    this.view.set({ kind: 'source', index: 0 });
    this.step.set('sources');
  }

  protected selectSource(index: number): void {
    this.activeSource.set(index);
    this.view.set({ kind: 'source', index });
  }

  protected patchSource(patch: Partial<ReportSource>): void {
    const index = this.activeSource();

    this.draft.update((draft) => ({
      ...draft,
      sources: draft.sources.map((source, i) => (i === index ? { ...source, ...patch } : source)),
    }));
  }

  protected renameSource(alias: string): void {
    const previous = this.current()?.alias;

    this.patchSource({ alias });

    // La vista previa se indexa por alias: se renombra también ahí para no
    // perderla por cambiar una letra.
    if (previous !== undefined && previous !== alias) {
      this.preview.update((preview) =>
        preview
          ? {
              ...preview,
              sources: preview.sources.map((item) => (item.alias === previous ? { ...item, alias } : item)),
            }
          : preview,
      );
      this._previewedSql.update((map) => {
        const next = new Map(map);
        const value = next.get(previous);

        next.delete(previous);
        if (value !== undefined) next.set(alias, value);
        return next;
      });
    }
  }

  protected chooseConnection(connectionId: string): void {
    this.patchSource({ connectionId, database: '', expectedColumns: [] });
    void this.loadOptions(connectionId);
  }

  protected chooseDatabase(database: string): void {
    this.patchSource({ database });

    const source = this.current();

    if (source) {
      void this.loadCompositions(source.connectionId, database);
    }
  }

  protected editSql(sql: string): void {
    this.patchSource({ sql });
  }

  protected chooseComposition(id: string): void {
    const source = this.current();
    const record = this.currentCompositions().find((item) => item.id === id);

    if (source && record) {
      this.replaceCurrent(applyComposition(source, record));
    }
  }

  /** Pasar a SQL no pierde nada: el estado visual se queda para poder volver. */
  protected useSqlMode(): void {
    const source = this.current();

    if (source && source.mode !== 'Sql') {
      this.replaceCurrent(toSqlMode(source));
    }
  }

  protected useVisualMode(): void {
    const source = this.current();

    if (!source || source.mode === 'Visual') {
      return;
    }

    if (visualWouldDiscardSql(source)) {
      this.ask(
        this._i18n.t('reports.confirm.regenerate'),
        this._i18n.t('reports.confirm.regenerateAction'),
        () => this.replaceCurrent(toVisualMode(source)),
      );
      return;
    }

    this.replaceCurrent(toVisualMode(source));
  }

  private replaceCurrent(source: ReportSource): void {
    const index = this.activeSource();

    this.draft.update((draft) => ({
      ...draft,
      sources: draft.sources.map((item, i) => (i === index ? source : item)),
    }));
  }

  protected optionsFor(connectionId: string): SourceOptions {
    return this._options().get(connectionId) ?? EMPTY_OPTIONS;
  }

  private async loadOptions(connectionId: string): Promise<void> {
    if (!connectionId || this._options().get(connectionId)?.loading) {
      return;
    }

    this.setOptions(connectionId, { ...this.optionsFor(connectionId), loading: true, error: null });

    try {
      const list = await firstValueFrom(this._gateway.getReportSourceDatabases(connectionId));
      const databases = list.databases;

      this.setOptions(connectionId, {
        databases,
        loading: false,
        error: list.failureCode ? this.failureText(list.failureCode, list.message) : null,
      });

      // Si la conexión solo tiene una base, no hay nada que preguntar.
      const source = this.current();

      if (source?.connectionId === connectionId && !source.database && databases.length === 1) {
        this.chooseDatabase(databases[0]);
      }
    } catch (error) {
      this.setOptions(connectionId, { ...EMPTY_OPTIONS, error: describeError(error, this._i18n) });
    }
  }

  private async loadCompositions(connectionId: string, database: string): Promise<void> {
    const key = `${connectionId}|${database}`;

    if (!connectionId || !database.trim() || this._compositions().has(key)) {
      return;
    }

    try {
      const records = await firstValueFrom(this._gateway.getCompositions(connectionId, database, undefined));

      this._compositions.update((map) => new Map(map).set(key, records));
    } catch {
      // Sin composiciones el modo visual lo dice; el modo SQL sigue sirviendo.
      this._compositions.update((map) => new Map(map).set(key, []));
    }
  }

  private setOptions(connectionId: string, options: SourceOptions): void {
    this._options.update((map) => new Map(map).set(connectionId, options));
  }

  // --- Unión -----------------------------------------------------------------

  protected readonly join = computed<ReportJoin>(
    () => this.draft().join ?? { keys: [], kind: 'Left', cardinality: 'OneToOne' },
  );

  protected patchJoin(patch: Partial<ReportJoin>): void {
    this.draft.update((draft) => ({ ...draft, join: { ...this.join(), ...patch } }));
  }

  protected addKey(): void {
    this.patchJoin({ keys: [...this.join().keys, { left: '', right: '' }] });
  }

  protected removeKey(index: number): void {
    this.patchJoin({ keys: this.join().keys.filter((_, i) => i !== index) });
  }

  protected editKey(index: number, side: 'left' | 'right', value: string): void {
    this.patchJoin({
      keys: this.join().keys.map((key, i) => (i === index ? { ...key, [side]: value } : key)),
    });
  }

  /** La primera vez que se llega a Combinar con columnas leídas, se proponen las que coinciden. */
  private proposeKeys(): void {
    if (this.join().keys.length > 0) {
      return;
    }

    const keys = suggestKeys(this.leftColumns(), this.rightColumns());

    this.patchJoin({ keys: keys.length > 0 ? keys : [{ left: '', right: '' }] });
  }

  private columnsOf(index: number): readonly ReportColumn[] {
    const source = this.sources()[index];

    if (!source) {
      return [];
    }

    const read = this.preview()?.sources.find((item) => item.alias === source.alias);

    if (read?.succeeded) {
      return read.columns;
    }

    // Sin vista previa todavía, lo que se leyó la última vez que se guardó.
    return source.expectedColumns.map((column, ordinal) => ({
      name: column.name,
      clrType: column.clrType,
      dataType: column.clrType,
      ordinal,
    }));
  }

  // --- Vista previa ----------------------------------------------------------

  protected async runPreview(): Promise<void> {
    if (this.previewProblems().length > 0 || this.previewing()) {
      return;
    }

    // Una unión a medias no se manda: las fuentes se leen igual, cada una por su lado.
    const current = this.draft();
    const draft = this.problems().includes('reports.problem.joinKeys') ? { ...current, join: null } : current;

    this.previewing.set(true);
    this.error.set(null);

    try {
      const preview = await firstValueFrom(this._gateway.previewReportDataset(draft));

      this.preview.set(preview);
      this._previewedSql.set(new Map(draft.sources.map((source) => [source.alias, sourceFingerprint(source)])));

      if (this.step() === 'join') {
        this.proposeKeys();
      }
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.previewing.set(false);
    }
  }

  protected failureText(code: string | null, message: string | null): string {
    // i18n-keys: reports.failure.*
    const key = `reports.failure.${code ?? 'unknown'}`;
    const known = this._i18n.t(key);

    // El motor ya explica su error en su idioma; los demás códigos se traducen.
    return code === 'database-error' || code === 'invalid-query' || known === key
      ? (message ?? known)
      : known;
  }

  protected schemaChangeText(change: ReportSourcePreview['schemaChanges'][number]): string {
    // i18n-keys: reports.schema.*
    return this._i18n.t(`reports.schema.${change.kind}`, {
      column: change.column,
      expected: change.expected ?? '',
      actual: change.actual ?? '',
    });
  }

  protected cell(value: ReportValue): string {
    if (value === null) {
      return 'NULL';
    }

    return typeof value === 'number' ? formatNumber(value, { maximumFractionDigits: 10 }) : String(value);
  }

  /**
   * El cruce califica las columnas con `izquierda.` y `derecha.` para que no
   * choquen; aquí se enseñan con el alias de cada fuente, que es como las
   * conoce quien armó el conjunto.
   */
  protected columnLabel(name: string): string {
    return columnLabelFor(this.sources(), name);
  }

  protected repeatedLabels(names: readonly string[]): string {
    return names.map((name) => this.columnLabel(name)).join(', ');
  }

  protected isNumeric(column: ReportColumn): boolean {
    return ['Byte', 'Int16', 'Int32', 'Int64', 'Single', 'Double', 'Decimal'].includes(column.clrType);
  }

  protected count(value: number): string {
    return formatNumber(value);
  }

  protected readAt(preview: ReportSourcePreview): string {
    return formatDate(preview.completedAtUtc, { timeStyle: 'medium' });
  }

  // --- Tableros --------------------------------------------------------------

  protected isDashboardOpen(dashboard: SavedDashboard): boolean {
    return this.mode() === 'dashboard' && this.openDashboard()?.id === dashboard.id;
  }

  protected showDashboard(dashboard: SavedDashboard): void {
    this.guard(() => this.enterDashboard(dashboard), 'dashboard');
  }

  protected newDashboard(): void {
    this.guard(
      () =>
        this.enterDashboard({
          id: crypto.randomUUID(),
          name: this._i18n.t('reports.dashboard.untitled'),
          model: JSON.stringify(emptyDashboard(this._i18n.t('reports.dashboard.page', { number: 1 }))),
        }),
      'dashboard',
    );
  }

  private enterDashboard(dashboard: SavedDashboard): void {
    this._dashboardDirty.set(false);
    this.openDashboard.set(dashboard);
    this.mode.set('dashboard');
    this.inspectorOpen.set(wideLayout());
  }

  private leaveDashboard(): void {
    this.mode.set('dataset');
    this.openDashboard.set(null);
    this._dashboardDirty.set(false);
  }

  protected dashboardSaved(saved: SavedDashboard): void {
    this.dashboards.update((list) => [saved, ...list.filter((item) => item.id !== saved.id)]);
  }

  protected dashboardDeleted(id: string): void {
    this.dashboards.update((list) => list.filter((item) => item.id !== id));
    this.leaveDashboard();
  }

  /** Editar un tablero es pedir el inspector: se abre aunque la ventana sea estrecha. */
  protected dashboardEditing(editing: boolean): void {
    if (editing) {
      this.inspectorOpen.set(true);
    }
  }

  protected dashboardDirty(dirty: boolean): void {
    this._dashboardDirty.set(dirty);
  }

  // --- Confirmaciones --------------------------------------------------------

  /**
   * Antes de descartar cambios sin guardar, se pregunta.
   *
   * `what` dice qué se pierde: abrir otro tablero solo descarta el tablero
   * abierto (el borrador del conjunto se conserva); abrir otro conjunto o
   * cerrar descarta los dos.
   */
  private guard(action: () => void, what: 'all' | 'dashboard' = 'all'): void {
    const dashboardDirty = this.mode() === 'dashboard' && this._dashboardDirty();

    if (!dashboardDirty && (what === 'dashboard' || !this.dirty())) {
      action();
      return;
    }

    this.ask(this._i18n.t('reports.confirm.discard'), this._i18n.t('reports.confirm.discardAction'), action);
  }

  private ask(message: string, confirmLabel: string, run: () => void): void {
    this.confirm.set({ message, confirmLabel, run });
  }

  protected acceptConfirm(): void {
    const pending = this.confirm();

    this.confirm.set(null);
    pending?.run();
  }

  protected cancelConfirm(): void {
    this.confirm.set(null);
  }
}
