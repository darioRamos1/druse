import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { FileSaveService } from '../../../core/files/file-save.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { describeError } from '../../../core/workspace/errors';
import {
  ReportColumn,
  ReportDataset,
  ReportIdentity,
  ReportTemplateScope,
  SavedReportTemplate,
} from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { columnLabelFor } from '../report-draft';
import {
  FieldAssignment,
  MAX_TEMPLATE_BYTES,
  TemplateDocument,
  TemplateField,
  TemplateIdentity,
  exportTemplate,
  fits,
  goalStarter,
  missingFields,
  parseTemplate,
  proposeAssignment,
  templateFileName,
} from '../report-template-model';

/** Una plantilla de la galería, ya leída. Los diseños iniciales no se guardan ni se borran. */
interface GalleryItem {
  readonly id: string;
  readonly document: TemplateDocument;
  readonly starter: boolean;
}

/** Lo que se pide al aplicar: un conjunto por hueco y una columna por campo. */
export interface TemplateApplication {
  readonly document: TemplateDocument;
  readonly datasets: readonly string[];
  readonly assignment: FieldAssignment;
  /** La identidad de la plantilla, si viene y se quiere usar: quien aplica la crea si falta. */
  readonly identity: TemplateIdentity | null;
}

/** Columnas del resultado guardado de un conjunto; `null` si aún no tiene. */
type ColumnsState = readonly ReportColumn[] | null | 'loading';

/**
 * La galería de plantillas: elegir una, importarla de un archivo, exportarla
 * o borrarla, y aplicarla vinculando sus campos a columnas reales.
 *
 * Aplicar no crea nada aquí: devuelve la vinculación y quien abrió la galería
 * crea la copia donde corresponde (un tablero nuevo, un panel, un reporte).
 */
@Component({
  selector: 'app-report-template-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  templateUrl: './report-template-gallery.html',
  styleUrl: './report-template-gallery.scss',
})
export class ReportTemplateGallery implements AfterViewInit, OnDestroy {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _i18n = inject(I18nService);
  private readonly _files = inject(FileSaveService);

  /** Qué ámbitos se pueden aplicar desde donde se abrió. */
  readonly scopes = input.required<readonly ReportTemplateScope[]>();
  readonly datasets = input.required<readonly ReportDataset[]>();
  /** En Visualización la copia va al conjunto abierto: no se pregunta. */
  readonly fixedDataset = input<string | null>(null);
  /** Las identidades que ya hay: para decir si la de la plantilla se usa o se crea. */
  readonly identities = input<readonly ReportIdentity[]>([]);

  readonly applied = output<TemplateApplication>();
  readonly closed = output<void>();

  private readonly _sheet = viewChild<ElementRef<HTMLElement>>('sheet');

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  private readonly _saved = signal<readonly SavedReportTemplate[]>([]);
  protected readonly confirmDelete = signal<string | null>(null);

  /** Lo importado de un archivo, a la espera de confirmarlo. */
  protected readonly importing = signal<TemplateDocument | null>(null);
  /** La plantilla que se está aplicando. */
  protected readonly applying = signal<GalleryItem | null>(null);
  protected readonly slotDatasets = signal<readonly (string | null)[]>([]);
  protected readonly assignment = signal<FieldAssignment>({});
  /** Usar la identidad que trae la plantilla. Marcado: quien la incluyó quería que viajara. */
  protected readonly useIdentity = signal(true);
  private readonly _columns = signal<ReadonlyMap<string, ColumnsState>>(new Map());

  protected readonly items = computed<readonly GalleryItem[]>(() => {
    const scopes = this.scopes();
    const starters: GalleryItem[] = scopes.includes('Dashboard')
      ? [{ id: 'starter:goal', document: this.starter(), starter: true }]
      : [];
    const saved = this._saved().flatMap((template): GalleryItem[] => {
      const read = parseTemplate(template.model);

      // Una plantilla que esta versión no sabe leer no se ofrece: aplicarla a medias sería peor.
      return read.ok && scopes.includes(read.document.scope)
        ? [
            {
              id: template.id,
              document: {
                ...read.document,
                name: template.name,
                description: template.description,
              },
              starter: false,
            },
          ]
        : [];
    });

    return [...starters, ...saved];
  });

  protected readonly missing = computed(() => {
    const item = this.applying();

    return item ? missingFields(item.document, this.assignment()) : [];
  });

  protected readonly missingNames = computed(() =>
    this.missing()
      .map((field) => field.name)
      .join(', '),
  );

  /** Se puede crear la copia: cada hueco tiene conjunto con columnas y no falta ningún campo obligatorio. */
  protected readonly canApply = computed(() => {
    const item = this.applying();

    return (
      item !== null &&
      this.slotDatasets().every((id) => id !== null && Array.isArray(this._columns().get(id))) &&
      this.missing().length === 0
    );
  });

  /** Quien la abrió: al cerrar, el foco vuelve ahí y no al principio del constructor. */
  private readonly _opener = typeof document === 'undefined' ? null : document.activeElement;

  /**
   * El teclado de toda la página, escuchado en fase de captura mientras la
   * galería está abierta.
   *
   * Escuchar solo en la hoja no bastaba: al borrar una plantilla o cambiar de
   * paso desaparece el botón que tenía el foco, el foco cae al documento y el
   * siguiente Escape lo recibía el constructor, que se cerraba entero con la
   * galería encima. En captura, la galería lo ve primero esté donde esté el foco.
   */
  private readonly _keys = (event: KeyboardEvent) => this.keydown(event);

  constructor() {
    void this.load();
    document.addEventListener('keydown', this._keys, true);
  }

  ngAfterViewInit(): void {
    this._sheet()?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this._keys, true);

    if (this._opener instanceof HTMLElement && this._opener.isConnected) {
      this._opener.focus();
    }
  }

  /** Escape retrocede o cierra; Tab no sale de la hoja. Ninguno llega al constructor. */
  private keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      this.escape();
      this.refocus();
    } else if (event.key === 'Tab') {
      this.trapTab(event);
    }
  }

  /** Si el foco se quedó sin sitio (o detrás del velo), vuelve a la hoja. */
  private refocus(): void {
    queueMicrotask(() => {
      const sheet = this._sheet()?.nativeElement;

      if (sheet && !sheet.contains(document.activeElement)) {
        sheet.focus();
      }
    });
  }

  /**
   * Tab da la vuelta dentro de la hoja.
   *
   * El constructor de detrás tiene su propio atrapado de foco, pero cuenta con
   * todos sus controles: sin esto, Tab saltaba de la galería a la lista de
   * conjuntos que el velo está tapando.
   */
  private trapTab(event: KeyboardEvent): void {
    const sheet = this._sheet()?.nativeElement;

    if (!sheet) {
      return;
    }

    const focusables = [
      ...sheet.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]',
      ),
    ].filter((element) => element.getClientRects().length > 0);

    event.stopPropagation();

    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    // Con el foco perdido, Tab entra en la hoja en vez de ir a lo que hay detrás.
    if (!sheet.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && (active === first || active === sheet)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private starter(): TemplateDocument {
    const t = (key: string) => this._i18n.t(`reports.template.starter.${key}`);

    // i18n-keys: reports.template.starter.*
    return goalStarter({
      name: t('name'),
      description: t('description'),
      page: t('page'),
      indicator: t('indicator'),
      byCategory: t('byCategory'),
      overTime: t('overTime'),
      detail: t('detail'),
      dateFilter: t('dateFilter'),
      categoryFilter: t('categoryFilter'),
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);

    try {
      this._saved.set(await firstValueFrom(this._gateway.getReportTemplates()));
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.loading.set(false);
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  /** Escape vuelve un paso atrás antes de cerrar: no se pierde una vinculación a medias. */
  private escape(): void {
    if (this.applying() || this.importing()) {
      this.back();
    } else {
      this.close();
    }
  }

  protected back(): void {
    this.applying.set(null);
    this.importing.set(null);
    this.error.set(null);
    this.refocus();
  }

  // i18n-keys: reports.template.scope.*
  protected scopeLabel(scope: ReportTemplateScope): string {
    return this._i18n.t(`reports.template.scope.${scope}`);
  }

  protected summary(document: TemplateDocument): string {
    const panels =
      document.layout?.pages.reduce((total, page) => total + page.panels.length, 0) ?? 0;

    return document.scope === 'Dashboard'
      ? this._i18n.t('reports.template.summaryBoard', {
          pages: document.layout?.pages.length ?? 0,
          panels,
          fields: document.fields.length,
        })
      : this._i18n.t('reports.template.summary', { fields: document.fields.length });
  }

  // --- Exportar, importar y borrar ---------------------------------------------------

  protected async export(item: GalleryItem): Promise<void> {
    this.error.set(null);

    try {
      const outcome = await this._files.save(
        templateFileName(item.document.name),
        new Blob([exportTemplate(item.document)], { type: 'application/json;charset=utf-8' }),
      );

      this.notice.set(
        outcome.saved
          ? outcome.path
            ? this._i18n.t('reports.template.exportedTo', { path: outcome.path })
            : this._i18n.t('reports.template.exported')
          : null,
      );
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }
  }

  protected async readFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    input.value = '';
    this.error.set(null);
    this.notice.set(null);

    if (!file) {
      return;
    }

    // i18n-keys: reports.template.invalid.*
    if (file.size > MAX_TEMPLATE_BYTES) {
      this.error.set(this._i18n.t('reports.template.invalid.tooBig'));
      return;
    }

    const read = parseTemplate(await file.text());

    if (read.ok) {
      this.importing.set(read.document);
    } else {
      this.error.set(this._i18n.t(`reports.template.invalid.${read.problem}`));
    }
  }

  /** Guarda lo importado como plantilla propia, con id nuevo: importar dos veces no pisa nada. */
  protected async confirmImport(): Promise<void> {
    const document = this.importing();

    if (!document) {
      return;
    }

    try {
      const saved = await firstValueFrom(
        this._gateway.saveReportTemplate({
          id: crypto.randomUUID(),
          name: document.name,
          description: document.description,
          scope: document.scope,
          model: JSON.stringify(document),
        }),
      );

      this._saved.update((list) => [saved, ...list]);
      this.importing.set(null);
      this.refocus();
      this.notice.set(
        this.scopes().includes(saved.scope)
          ? this._i18n.t('reports.template.imported', { name: saved.name })
          : this._i18n.t('reports.template.importedElsewhere', {
              name: saved.name,
              scope: this.scopeLabel(saved.scope),
            }),
      );
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }
  }

  protected async delete(item: GalleryItem): Promise<void> {
    this.confirmDelete.set(null);

    try {
      await firstValueFrom(this._gateway.deleteReportTemplate(item.id));
      this._saved.update((list) => list.filter((template) => template.id !== item.id));
      this.notice.set(this._i18n.t('reports.template.deleted', { name: item.document.name }));
      this.refocus();
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }
  }

  // --- Aplicar ------------------------------------------------------------------------

  protected start(item: GalleryItem): void {
    const fixed = this.fixedDataset();
    // Se propone el conjunto que se llama como el original; si no, el abierto o el primero.
    const slots = item.document.slots.map(
      (slot) =>
        fixed ??
        this.datasets().find((dataset) => slot.label && dataset.name === slot.label)?.id ??
        this.datasets()[0]?.id ??
        null,
    );

    this.error.set(null);
    this.notice.set(null);
    this.applying.set(item);
    this.slotDatasets.set(slots);
    this.assignment.set({});
    this.useIdentity.set(true);
    slots.forEach((id, slot) => void this.useDataset(slot, id));
    this.refocus();
  }

  protected chooseDataset(slot: number, id: string): void {
    this.slotDatasets.update((list) =>
      list.map((item, index) => (index === slot ? id || null : item)),
    );
    void this.useDataset(slot, id || null);
  }

  /** Lee las columnas del resultado guardado y propone la vinculación de los campos del hueco. */
  private async useDataset(slot: number, id: string | null): Promise<void> {
    const columns = id ? await this.columnsOf(id) : null;
    const document = this.applying()?.document;

    // Si mientras se leía se eligió otro conjunto, esta lectura ya no manda.
    if (!document || this.slotDatasets()[slot] !== id) {
      return;
    }

    const proposed = Array.isArray(columns)
      ? proposeAssignment(document, slot, columns)
      : Object.fromEntries(
          document.fields.filter((field) => field.slot === slot).map((field) => [field.id, null]),
        );

    this.assignment.update((current) => ({ ...current, ...proposed }));
  }

  private async columnsOf(id: string): Promise<ColumnsState> {
    const known = this._columns().get(id);

    if (known !== undefined && known !== 'loading') {
      return known;
    }

    this._columns.update((map) => new Map(map).set(id, 'loading'));

    let columns: readonly ReportColumn[] | null = null;

    try {
      columns = (await firstValueFrom(this._gateway.getReportSnapshot(id)))?.columns ?? null;
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }

    this._columns.update((map) => new Map(map).set(id, columns));
    return columns;
  }

  protected columnsState(slot: number): ColumnsState | undefined {
    const id = this.slotDatasets()[slot];

    return id ? this._columns().get(id) : undefined;
  }

  protected fieldsOf(slot: number): readonly TemplateField[] {
    return this.applying()?.document.fields.filter((field) => field.slot === slot) ?? [];
  }

  protected options(field: TemplateField): readonly ReportColumn[] {
    const state = this.columnsState(field.slot);

    return Array.isArray(state) ? state.filter((column) => fits(field, column)) : [];
  }

  protected columnLabel(slot: number, name: string): string {
    const dataset = this.datasets().find((item) => item.id === this.slotDatasets()[slot]);

    return dataset ? columnLabelFor(dataset.sources, name) : name;
  }

  protected hasIdentity(id: string): boolean {
    return this.identities().some((identity) => identity.id.toLowerCase() === id.toLowerCase());
  }

  protected datasetName(id: string | null): string {
    return this.datasets().find((dataset) => dataset.id === id)?.name ?? '';
  }

  // i18n-keys: reports.template.kind.*
  protected kindLabel(field: TemplateField): string {
    return this._i18n.t(`reports.template.kind.${field.kind}`);
  }

  protected assign(field: TemplateField, column: string): void {
    this.assignment.update((current) => ({ ...current, [field.id]: column || null }));
  }

  protected apply(): void {
    const item = this.applying();

    if (!item || !this.canApply()) {
      return;
    }

    this.applied.emit({
      document: item.document,
      datasets: this.slotDatasets() as string[],
      assignment: this.assignment(),
      identity: this.useIdentity() ? (item.document.identity ?? null) : null,
    });
  }
}
