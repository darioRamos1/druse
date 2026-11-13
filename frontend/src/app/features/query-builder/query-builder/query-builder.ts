import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';

import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  SavedCompositionRecord,
} from '../../../core/application-gateway/application-gateway';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatNumber } from '../../../core/i18n/locale-format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { ValueInput } from '../../../shared/ui/value-input/value-input';
import {
  DatabaseEngine,
  DatabaseForeignKey,
  DatabaseObject,
  InputKind,
  KnownColumn,
  QueryResult,
} from '../../../shared/models/workspace';
import { ResultsGrid } from '../../query-results/results-grid/results-grid';
import {
  AggregateFunction,
  ColumnWrite,
  FilterOperator,
  DatePeriod,
  JoinType,
  QueryFilter,
  buildCreateTable,
  buildDropTable,
  buildDeleteCount,
  buildDeleteValues,
  buildInsertValues,
  buildSelect,
  buildUpdateValues,
  COMPARISON_OPERATORS,
} from '../../query-editor/sql-language/sql-writer';
import { SQL_DIALECTS } from '../../query-editor/sql-language/sql-dialects';
import { MAX_JOIN_HOPS, findJoinPath } from './join-path';
import * as Model from '../query-model';
import {
  AggregateDraft,
  CanvasLayout,
  CompositionState,
  HavingDraft,
  ModelCatalog,
  ModelJoin,
  OrderDraft,
  QueryColumnOption,
  SavedJoin,
  SelectForm,
  SelectModel,
  isDateColumn,
} from '../query-model';
import { FieldDrop, QueryCanvas } from '../query-canvas/query-canvas';
import { ModelEdit, QueryShelves, ShelfId } from '../query-shelves/query-shelves';
import { previewChart } from '../preview-chart';
import { CatalogTable, referencedTables, sqlToModel } from '../sql-to-model';
import { ReportChart } from '../../reports/report-chart/report-chart';
import { ReportVisualKind } from '../../../shared/models/reports';
import {
  BASE_KEY,
  CanvasBox,
  CanvasLink,
  ColumnEnd,
  Connection,
  joinKey,
} from '../query-canvas/query-canvas-layout';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';
import { DialogBackdrop } from '../../../shared/a11y/dialog-backdrop';
import { Icon } from '../../../shared/ui/icon/icon';

type Operation = 'select' | 'insert' | 'update' | 'delete';
type InputMode = 'omit' | 'value' | 'null' | 'default';

interface ColumnDraft {
  readonly name: string;
  readonly mode: InputMode;
  readonly text: string | null;
}

interface JoinDraft {
  readonly id: number;
  readonly type: JoinType;
  readonly tableId: string;
  readonly search: string;
  /** `null` representa la tabla principal; un número, un JOIN anterior. */
  readonly leftJoinId: number | null;
  readonly leftColumn: string;
  readonly rightColumn: string;
  readonly columns: readonly KnownColumn[];
  readonly chosen: readonly string[];
  readonly loading: boolean;
  readonly suggestionsOpen: boolean;
  readonly highlighted: number;
}

interface JoinSource {
  readonly joinId: number | null;
  readonly alias: string;
  readonly label: string;
  readonly columns: readonly KnownColumn[];
}

interface JoinSuggestion {
  readonly id: string;
  readonly kind: 'schema' | 'table';
  readonly schema: string;
  readonly tableId?: string;
  readonly table?: string;
}

interface SavedComposition {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
  /** Falta en las guardadas antes de que existiera: esas se abren como texto. */
  readonly state?: CompositionState;
}

const MAX_JOIN_SUGGESTIONS = 40;

/**
 * Cuántas tablas se leen para buscar un camino entre dos.
 *
 * El mismo tope que aplica la API al grafo del esquema: pasarlo sería una
 * petición que el servidor rechaza.
 */
const MAX_PATH_TABLES = 300;

/** Cuánto se espera tras el último cambio antes de refrescar la vista previa. */
const AUTO_PREVIEW_DELAY_MS = 700;

/** Dónde se recuerda si la vista previa se actualiza sola. Es de quien usa Druse, no de la tabla. */
const AUTO_PREVIEW_KEY = 'druse.query-builder.auto-preview';

/** Dónde se recuerda si se compone con el formulario o con el lienzo. */
const VIEW_KEY = 'druse.query-builder.view';

/** Operadores que se ofrecen, en el orden en que se usan. */
const OPERATORS: readonly FilterOperator[] = [
  '=',
  '<>',
  '>',
  '>=',
  '<',
  '<=',
  'BETWEEN',
  'LIKE',
  'NOT LIKE',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
];

const HAVING_OPERATORS: readonly FilterOperator[] = ['=', '<>', '>', '>=', '<', '<='];
const AGGREGATE_FUNCTIONS: readonly AggregateFunction[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
const DATE_PERIODS: readonly { readonly value: DatePeriod | 'none'; readonly label: string }[] = [
  { value: 'none', label: 'builder.period.none' },
  { value: 'day', label: 'builder.period.day' },
  { value: 'month', label: 'builder.period.month' },
  { value: 'quarter', label: 'builder.period.quarter' },
  { value: 'year', label: 'builder.period.year' },
];

/**
 * Compone una consulta sin escribirla.
 *
 * No pretende sustituir al editor: **produce un punto de partida** que se
 * inserta y se sigue trabajando a mano, con el autocompletado y el resto de
 * ayudas. Por eso enseña el SQL mientras se compone, en vez de esconderlo
 * detrás de una interfaz que haya que aprender.
 *
 * Los JOIN se proponen desde las claves foráneas que el catálogo declara, pero
 * las dos columnas quedan a la vista y se pueden cambiar: una relación que el
 * esquema no declara no se inventa, se elige.
 */
@Component({
  selector: 'app-query-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Icon,
    DialogBackdrop,
    DialogFocus,
    ValueInput,
    ResultsGrid,
    TranslatePipe,
    QueryCanvas,
    QueryShelves,
    ReportChart,
  ],
  templateUrl: './query-builder.html',
  styleUrl: './query-builder.scss',
})
export class QueryBuilder implements OnInit {
  private readonly _store = inject(WorkspaceStore);
  private readonly _i18n = inject(I18nService);

  /** Las frases con un trozo con formato propio, sin partir la clave. */
  protected starParts() {
    return this._i18n.tParts('builder.starHint', { star: '' });
  }

  protected distinctParts() {
    return this._i18n.tParts('builder.distinct', { keyword: '' });
  }

  protected affectedParts(rows: number) {
    return this._i18n.tParts('builder.affected', { rows: formatNumber(rows) }, { count: rows });
  }

  /** El alias que se propone para un cálculo, en el idioma elegido. */
  private defaultAlias(): string {
    return this._i18n.t('builder.aliasDefault');
  }
  private readonly _gateway = inject(ApplicationGateway);

  readonly table = input.required<DatabaseObject>();
  readonly engine = input.required<DatabaseEngine>();
  readonly connectionId = input.required<string>();

  /**
   * Un formulario con el que arrancar, en vez del vacío.
   *
   * Es lo que permite reabrir desde el editor una consulta que salió de aquí.
   * Se aplica en cuanto están las columnas, que es cuando el formulario puede
   * enseñarlo.
   */
  readonly initialState = input<unknown>(null);

  /**
   * Para qué se compone: una consulta para el editor o una fuente de Reportes.
   *
   * Una fuente solo admite SELECT, empieza en el lienzo y su botón no inserta
   * nada en el editor: devuelve la consulta y su modelo a quien la pidió.
   */
  readonly purpose = input<'editor' | 'source'>('editor');

  readonly closed = output<void>();
  readonly insert = output<string>();

  /**
   * El SELECT que se manda al editor junto con su formulario, para que quien
   * lo recuerde pueda volver a abrirlo aquí.
   */
  readonly composed = output<{ readonly sql: string; readonly state: unknown }>();

  protected readonly operators = OPERATORS;
  protected readonly havingOperators = HAVING_OPERATORS;
  protected readonly aggregateFunctions = AGGREGATE_FUNCTIONS;
  protected readonly datePeriods = DATE_PERIODS;
  /**
   * Tipos de unión que ofrece el compositor.
   *
   * `FULL OUTER JOIN` solo donde el motor lo entiende: ofrecerlo en otro
   * produciría SQL que el servidor rechaza, y el usuario buscaría el error en
   * su consulta en vez de en el motor. Lo decide el dialecto.
   */
  protected readonly joinTypes = computed<readonly JoinType[]>(() =>
    SQL_DIALECTS[this.engine()].fullOuterJoin
      ? ['INNER', 'LEFT', 'RIGHT', 'FULL OUTER', 'CROSS']
      : ['INNER', 'LEFT', 'RIGHT', 'CROSS'],
  );

  /** Columnas de la tabla, según lo que el catálogo ya sabe. */
  protected readonly columns = signal<readonly KnownColumn[]>([]);
  protected readonly loading = signal(true);
  protected readonly templatesReady = computed(() => !this.loading() && this.columns().length > 0);
  protected readonly operation = signal<Operation>('select');
  protected readonly sqlOverride = signal<string | null>(null);

  /**
   * El SELECT que se compone, salvo los cruces.
   *
   * Las reglas viven en `query-model.ts`; aquí solo se guarda el resultado de
   * cada operación. Los cruces van aparte porque arrastran estado de pantalla
   * —el buscador, la carga de columnas— que no es de la consulta.
   */
  private readonly _form = signal<SelectForm>(Model.emptySelectForm());

  /** Posiciones del lienzo que traía la composición: se conservan al guardarla de nuevo. */
  private readonly _layout = signal<CanvasLayout | undefined>(undefined);

  protected readonly chosen = formField(this._form, 'chosen');
  protected readonly columnSearch = signal('');
  protected readonly visibleColumns = computed(() => {
    const search = this.columnSearch().trim().toLocaleLowerCase();
    return this.columns().filter((column) =>
      `${column.name} ${column.dataType}`.toLocaleLowerCase().includes(search),
    );
  });
  protected readonly joins = signal<readonly JoinDraft[]>([]);
  protected readonly filters = formField(this._form, 'filters');
  protected readonly grouped = formField(this._form, 'grouped');
  protected readonly groupByKeys = formField(this._form, 'groupByKeys');
  protected readonly groupPeriods = formField(this._form, 'groupPeriods');
  protected readonly aggregates = formField(this._form, 'aggregates');
  protected readonly having = formField(this._form, 'having');
  protected readonly orders = formField(this._form, 'orders');
  protected readonly limit = formField(this._form, 'limit');
  protected readonly distinct = formField(this._form, 'distinct');

  /** El SELECT entero, cruces incluidos, como lo entiende el modelo. */
  protected readonly model = computed<SelectModel>(() => ({
    ...this._form(),
    joins: this.joins().map((join) => this.toModelJoin(join)),
  }));

  /** Lo que el modelo necesita saber del catálogo. */
  protected readonly catalog = computed<ModelCatalog>(() => ({
    table: { schema: this.table().schema, name: this.table().name },
    columns: this.columns(),
    joinColumns: new Map(this.joins().map((join) => [join.id, join.columns])),
  }));

  /**
   * Formulario o lienzo: dos maneras de editar las columnas y los cruces del
   * mismo SELECT. Se recuerda, como la vista previa automática.
   */
  protected readonly view = signal<'form' | 'canvas'>(readView());

  protected setView(view: 'form' | 'canvas'): void {
    this.view.set(view);

    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Sin almacenamiento se recuerda solo mientras el diálogo siga abierto.
    }
  }

  protected readonly layout = this._layout.asReadonly();

  /** Las cajas del lienzo: la tabla principal y un cruce por caja, en el orden del SQL. */
  protected readonly canvasBoxes = computed<readonly CanvasBox[]>(() => {
    const joins = this.joins();
    const aliased = Model.toQueryJoins(this.model().joins).length > 0;

    return [
      {
        key: BASE_KEY,
        alias: aliased ? 't0' : '',
        label: this.relationLabel(this.table()),
        name: this.table().name,
        columns: this.columns(),
        chosen: this.chosen(),
        joinId: null,
        type: null,
        leftKey: null,
        loading: this.loading(),
      },
      ...joins.map((join, index) => ({
        key: joinKey(join.id),
        alias: `t${index + 1}`,
        label: this.relationLabel(this.joinRelation(join)) || join.search,
        name: this.joinRelation(join)?.name ?? join.search,
        columns: join.columns,
        chosen: join.chosen,
        joinId: join.id,
        type: join.type,
        leftKey: join.leftJoinId === null ? BASE_KEY : joinKey(join.leftJoinId),
        loading: join.loading,
      })),
    ];
  });

  /** Una línea por cruce con condición; un CROSS no une columnas y no la lleva. */
  protected readonly canvasLinks = computed<readonly CanvasLink[]>(() =>
    this.joins()
      .filter((join) => join.type !== 'CROSS' && this.joinRelation(join))
      .map((join) => ({
        joinId: join.id,
        key: joinKey(join.id),
        leftKey: join.leftJoinId === null ? BASE_KEY : joinKey(join.leftJoinId),
        leftColumn: join.leftColumn,
        rightColumn: join.rightColumn,
        type: join.type,
      })),
  );

  /** Tablas que se pueden añadir al lienzo: todas las de la base salvo la principal. */
  protected addTable(tableId: string): void {
    if (tableId) {
      this.addJoin(tableId);
    }
  }

  protected canvasToggle(end: ColumnEnd): void {
    if (end.key === BASE_KEY) {
      this.toggleColumn(end.column);
      return;
    }

    const join = this.joins().find((item) => joinKey(item.id) === end.key);
    if (join) {
      this.toggleJoinColumn(join.id, end.column);
    }
  }

  /**
   * Une dos columnas en el lienzo.
   *
   * Un CROSS que recibe una condición pasa a INNER: quien une dos columnas
   * quiere un cruce por ellas, y un CROSS la ignoraría.
   */
  protected canvasConnect(connection: Connection): void {
    const join = this.joins().find((item) => item.id === connection.joinId);

    if (!join) {
      return;
    }

    this.patchJoin(join.id, {
      leftJoinId: connection.leftJoinId,
      leftColumn: connection.leftColumn,
      rightColumn: connection.rightColumn,
      type: join.type === 'CROSS' ? 'INNER' : join.type,
    });
  }

  /** Trae las tablas de un esquema para poder añadirlas al lienzo. */
  protected loadSchema(schema: string): void {
    if (schema) {
      void this._store.ensureRelationsAsync(schema, this.connectionId(), this.table().database);
    }
  }

  /** Se está llevando una columna del lienzo a los estantes. */
  protected readonly fieldDragging = signal(false);

  /** Por qué no se aceptó la última columna soltada en un estante. */
  protected readonly shelfNotice = signal<string | null>(null);

  /** Lo que piden los estantes: una operación del mismo modelo que edita el formulario. */
  protected applyEdit(edit: ModelEdit): void {
    this.shelfNotice.set(null);
    this.apply(edit);
  }

  /**
   * Una columna del lienzo soltada en un estante.
   *
   * Lo que el modelo no admite se dice en vez de ignorarlo: los filtros son de
   * la tabla principal, y sin agrupar solo se ordena por sus columnas.
   */
  protected dropField(drop: FieldDrop): void {
    this.shelfNotice.set(null);

    const join =
      drop.key === BASE_KEY ? null : this.joins().find((item) => joinKey(item.id) === drop.key);
    const key = join ? `join:${join.id}:${drop.column}` : `base:${drop.column}`;
    const alias = this.defaultAlias();
    const refuse = (message: string) =>
      this.shelfNotice.set(this._i18n.t(message, { column: drop.column }));

    switch (drop.shelf as ShelfId) {
      case 'group':
        this.apply((model, catalog) => Model.groupBy(model, catalog, key, alias));
        return;
      case 'value':
        this.apply((model, catalog) => Model.addValue(model, catalog, key, alias));
        return;
      case 'filter':
        if (join) {
          refuse('shelves.filterOnlyMain');
        } else {
          this.apply((model) => Model.addFilterOn(model, drop.column));
        }
        return;
      case 'order':
        if (this.grouped()) {
          if (this.groupByKeys().includes(key)) {
            this.apply((model) => Model.addOrderFor(model, `group:${key}`));
          } else {
            refuse('shelves.orderNeedsGroup');
          }
        } else if (join) {
          refuse('shelves.orderOnlyMain');
        } else {
          this.apply((model) => Model.addOrderFor(model, `column:${drop.column}`));
        }
        return;
    }
  }

  /** Cómo se enseña la vista previa: la cuadrícula o una de las gráficas de Reportes. */
  protected readonly previewKind = signal<ReportVisualKind>('Table');
  protected readonly previewKinds: readonly ReportVisualKind[] = [
    'Table',
    'Bar',
    'Line',
    'Indicator',
  ];
  protected readonly chart = computed(() => {
    const set = this.previewSet();
    return set ? previewChart(set) : null;
  });

  protected setLayout(layout: CanvasLayout): void {
    this._layout.set(layout);
  }

  /** Aplica una operación del modelo; los cruces no cambian por esta vía. */
  private apply(operation: (model: SelectModel, catalog: ModelCatalog) => SelectModel): void {
    this._form.set(Model.formOf(operation(this.model(), this.catalog())));
  }
  protected readonly insertDrafts = signal<readonly ColumnDraft[]>([]);
  protected readonly updateDrafts = signal<readonly ColumnDraft[]>([]);
  protected readonly updateFilters = signal<readonly QueryFilter[]>([]);
  protected readonly foreignKeys = signal<readonly DatabaseForeignKey[]>([]);
  protected readonly previewResult = signal<QueryResult | null>(null);
  private readonly previewSql = signal<string | null>(null);
  protected readonly previewStale = computed(
    () => this.previewResult() !== null && this.previewSql() !== this.sql(),
  );
  protected readonly previewRunning = signal(false);
  protected readonly previewCanceling = signal(false);
  protected readonly savedCompositions = signal<readonly SavedComposition[]>([]);
  protected readonly compositionName = signal('');

  /** Por qué no se pudo leer, guardar o borrar una composición, si falló. */
  protected readonly compositionError = signal<string | null>(null);
  private _previewExecutionId: string | null = null;
  private _previewRefresh = 0;
  private _destroyed = false;
  private _autoPreviewTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * La vista previa se refresca sola al cambiar la composición.
   *
   * **Apagada por omisión.** Es una consulta real contra el servidor en cada
   * cambio, y contra una base de producción con tablas grandes eso no puede
   * pasar sin que alguien lo pida. Se recuerda entre sesiones.
   */
  protected readonly autoPreview = signal(readAutoPreview());

  /**
   * Cuándo se puede refrescar sola: solo un SELECT, y solo el que escribe el
   * formulario. El SQL retocado a mano puede ser cualquier cosa —un DELETE
   * pegado encima—, y ejecutarlo sin que se pulse nada sería peligroso.
   */
  protected readonly canAutoPreview = computed(
    () =>
      this.operation() === 'select' &&
      this.sqlOverride() === null &&
      this.validationMessages().length === 0 &&
      !this.hasPendingValues() &&
      !this.joins().some((join) => join.loading),
  );

  /**
   * Algún filtro sin su valor.
   *
   * Refrescar entonces ejecutaría el marcador de «valor obligatorio» y enseñaría
   * un error de sintaxis por cada campo que se está a medio escribir.
   */
  protected readonly hasPendingValues = computed(() => Model.hasPendingValues(this.model()));

  protected readonly canPreview = computed(
    () =>
      !this.loading() &&
      this.operation() === 'select' &&
      this.sql().trim().length > 0 &&
      this.validationMessages().length === 0 &&
      (this.sqlOverride() !== null ||
        (!this.hasPendingValues() && !this.joins().some((join) => join.loading))),
  );

  private readonly scheduleAutoPreview = effect(() => {
    const sql = this.sql();

    clearTimeout(this._autoPreviewTimer);

    if (!this.autoPreview() || !this.canAutoPreview() || this.loading() || !sql) {
      return;
    }

    this._autoPreviewTimer = setTimeout(() => void this.refreshPreview(), AUTO_PREVIEW_DELAY_MS);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this._destroyed = true;
      this._previewRefresh += 1;
      clearTimeout(this._autoPreviewTimer);
      const executionId = this._previewExecutionId;
      this._previewExecutionId = null;
      if (executionId) {
        void this._store.cancelExecution(executionId);
      }
    });
  }

  protected setAutoPreview(enabled: boolean): void {
    this.autoPreview.set(enabled);

    try {
      localStorage.setItem(AUTO_PREVIEW_KEY, enabled ? '1' : '0');
    } catch {
      // Sin almacenamiento se recuerda solo mientras el diálogo siga abierto.
    }
  }

  /** Cancela la que siga en curso —ya describe una composición vieja— y lanza otra. */
  private async refreshPreview(): Promise<void> {
    if (this._destroyed || !this.autoPreview() || !this.canAutoPreview()) {
      return;
    }

    const refresh = ++this._previewRefresh;
    if (this._previewExecutionId) {
      const executionId = this._previewExecutionId;
      this._previewExecutionId = null;
      this.previewRunning.set(false);
      await this._store.cancelExecution(executionId);
    }

    if (
      refresh === this._previewRefresh &&
      !this._destroyed &&
      this.autoPreview() &&
      this.canAutoPreview()
    ) {
      await this.runPreview();
    }
  }

  ngOnInit(): void {
    // Una fuente de Reportes se compone en el lienzo: es a lo que se viene.
    // No se recuerda como preferencia, para no cambiar cómo se abre en el editor.
    if (this.purpose() === 'source') {
      this.view.set('canvas');
    }

    // Las columnas hacen falta para todo lo de aquí; se piden una vez.
    void this.load();
    void this.loadSavedCompositions();
  }

  private async load(): Promise<void> {
    const table = this.table();

    try {
      const columns = await this._store.ensureColumnsAsync(
        table.schema ?? null,
        table.name,
        this.connectionId(),
        table.database,
      );

      this.columns.set(columns);
      this.insertDrafts.set(
        columns.map((column) => ({
          name: column.name,
          mode:
            column.isGenerated || column.defaultValue != null || column.isNullable
              ? 'omit'
              : 'value',
          text: null,
        })),
      );
      this.updateDrafts.set(
        columns
          .filter((column) => !column.isGenerated && !column.isPrimaryKey)
          .map((column) => ({ name: column.name, mode: 'omit', text: null })),
      );
      this.updateFilters.set(
        columns
          .filter((column) => column.isPrimaryKey)
          .map((column) => ({ column: column.name, operator: '=', value: null })),
      );
      if (table.kind === 'table') {
        const structure = await this._store.tableStructure(this.connectionId(), table);
        this.foreignKeys.set(structure?.foreignKeys ?? []);
      }
    } finally {
      this.loading.set(false);
    }

    const initial = Model.readCompositionState(this.initialState());

    if (initial) {
      await this.applyState(initial);
    }
  }

  protected readonly generatedSql = computed(() => {
    const base = { schema: this.table().schema, table: this.table().name };

    switch (this.operation()) {
      case 'insert':
        return buildInsertValues(this.engine(), {
          ...base,
          values: this.toWrites(this.insertDrafts(), false),
        });
      case 'update':
        return buildUpdateValues(this.engine(), {
          ...base,
          assignments: this.toWrites(this.updateDrafts(), true),
          filters: this.updateFilters(),
        });
      case 'delete':
        // Comparte los filtros del UPDATE a propósito: es el mismo «qué filas»,
        // y tener dos listas invitaría a componer el DELETE mirando la del otro.
        return buildDeleteValues(this.engine(), { ...base, filters: this.updateFilters() });
      default:
        return buildSelect(this.engine(), Model.toSelectSpec(this.model(), this.catalog()));
    }
  });

  protected readonly sql = computed(() => this.sqlOverride() ?? this.generatedSql());

  /** Cuántas filas se llevaría el DELETE compuesto, o `null` si no se ha contado. */
  protected readonly affected = signal<number | null>(null);
  protected readonly counting = signal(false);
  private _affectedRequest = 0;

  /**
   * Cuenta las filas que caerían con el mismo filtro.
   *
   * El error caro no suele ser olvidar el `WHERE`, sino escribir uno que abarca
   * más de lo que uno cree; el recuento es lo único que lo enseña **antes**.
   */
  protected async countAffected(): Promise<void> {
    const sql = buildDeleteCount(this.engine(), {
      schema: this.table().schema,
      table: this.table().name,
      filters: this.updateFilters(),
    });

    if (!sql) {
      return;
    }

    const request = ++this._affectedRequest;
    this.affected.set(null);
    this.counting.set(true);

    try {
      const affected = await this._store.countRows(this.connectionId(), sql);

      if (request === this._affectedRequest) {
        this.affected.set(affected);
      }
    } finally {
      if (request === this._affectedRequest) {
        this.counting.set(false);
      }
    }
  }

  protected setOperation(operation: Operation): void {
    this.invalidateAffected();
    this.operation.set(operation);
    this.sqlOverride.set(null);
  }

  protected patchSql(value: string): void {
    this.invalidateAffected();
    this.drawNotice.set(null);
    this.sqlOverride.set(value);
  }

  protected resetSql(): void {
    this.drawNotice.set(null);
    this.sqlOverride.set(null);
  }

  /** Qué pasó al llevar el SQL a mano al lienzo, si se intentó. */
  protected readonly drawNotice = signal<{
    readonly tone: 'done' | 'kept';
    readonly text: string;
  } | null>(null);

  protected readonly drawing = signal(false);

  /**
   * Lleva el SQL retocado a mano al modelo: al lienzo y al formulario.
   *
   * Es un paso que se pide, no algo que pase al escribir: convertir mientras se
   * escribe reescribiría el texto bajo el cursor con el formato del compositor.
   * Lo que no se entiende queda como columna o condición a mano; si cambia la
   * forma de la consulta, no se convierte nada y se dice por qué.
   */
  protected async drawSql(): Promise<void> {
    const sql = this.sqlOverride();

    if (sql === null || this.drawing()) {
      return;
    }

    this.drawing.set(true);

    try {
      const tables: CatalogTable[] = this.availableRelations().map((node) => ({
        id: node.source.id,
        schema: node.source.schema ?? null,
        name: node.source.name,
      }));
      const loaded = new Map<string, readonly KnownColumn[]>();

      // Las columnas de lo que se cruza, antes de traducir: así los nombres
      // vuelven a escribirse como los tiene el catálogo.
      for (const table of referencedTables(sql, tables)) {
        try {
          loaded.set(
            table.id,
            await this._store.ensureColumnsAsync(
              table.schema,
              table.name,
              this.connectionId(),
              this.table().database,
            ),
          );
        } catch {
          // Sin columnas se traduce igual, con los nombres tal como se escribieron.
        }
      }

      const result = sqlToModel(sql, {
        engine: this.engine(),
        table: { schema: this.table().schema ?? null, name: this.table().name },
        columns: this.columns(),
        tables,
        columnsOf: (id) => loaded.get(id) ?? [],
      });

      if (!result.ok) {
        // i18n-keys: builder.toModel.*
        this.drawNotice.set({
          tone: 'kept',
          text: this._i18n.t(`builder.toModel.${result.reason}`),
        });
        return;
      }

      this.invalidateAffected();
      this._form.set(result.form);
      this.joins.set(
        result.joins.map((join) => ({
          id: join.id,
          type: join.type,
          tableId: join.tableId,
          search: join.schema ? `${join.schema}.${join.table}` : join.table,
          leftJoinId: join.leftJoinId,
          leftColumn: join.leftColumn,
          rightColumn: join.rightColumn,
          columns: loaded.get(join.tableId) ?? [],
          chosen: join.chosen,
          loading: false,
          suggestionsOpen: false,
          highlighted: 0,
        })),
      );
      this.sqlOverride.set(null);
      this.drawNotice.set({
        tone: 'done',
        text:
          result.handPieces > 0
            ? this._i18n.t('builder.toModel.doneHand', { count: result.handPieces })
            : this._i18n.t('builder.toModel.done'),
      });
    } finally {
      this.drawing.set(false);
    }
  }

  protected isChosen(name: string): boolean {
    return this.chosen().includes(name);
  }

  protected toggleColumn(name: string): void {
    this.apply((model) => Model.toggleColumn(model, name));
  }

  protected selectVisibleColumns(): void {
    const names = this.visibleColumns().map((column) => column.name);
    this.apply((model) => Model.chooseColumns(model, names));
  }

  protected clearColumns(): void {
    this.apply(Model.clearColumns);
  }

  protected setDistinct(distinct: boolean): void {
    this.apply((model) => Model.setDistinct(model, distinct));
  }

  /** Columnas disponibles para agrupar, incluidas las de los JOIN válidos. */
  protected readonly queryColumns = computed(() =>
    Model.queryColumns(this.model(), this.catalog()),
  );

  protected readonly orderOptions = computed(() =>
    Model.orderOptions(this.model(), this.catalog()),
  );

  protected readonly validationMessages = computed(() => {
    const messages = Model.validate(this.model(), this.catalog()).map((problem) => {
      switch (problem.key) {
        case 'builder.needsNumeric':
          return this._i18n.t(problem.key, { function: problem.function, column: problem.column });
        case 'builder.needsDate':
          // El período se dice como en el desplegable que lo eligió, no con el
          // nombre del contrato: «Por mes» y no «month».
          return this._i18n.t(problem.key, {
            period: this._i18n
              .t(`builder.period.${problem.period}`)
              .toLocaleLowerCase(this._i18n.intlLocale()),
            column: problem.column,
          });
        default:
          return this._i18n.t(problem.key);
      }
    });

    return [...new Set(messages)];
  });

  protected toggleGrouping(): void {
    this.apply((model, catalog) => Model.toggleGrouping(model, catalog, this.defaultAlias()));
  }

  protected isGrouped(key: string): boolean {
    return this.groupByKeys().includes(key);
  }

  protected clearGroupColumns(): void {
    this.apply(Model.clearGroupColumns);
  }

  protected toggleGroupColumn(key: string): void {
    this.apply((model) => Model.toggleGroupColumn(model, key));
  }

  protected setGroupPeriod(key: string, period: DatePeriod | 'none'): void {
    this.apply((model) => Model.setGroupPeriod(model, key, period));
  }

  protected canGroupByDate(option: QueryColumnOption): boolean {
    return isDateColumn(option.column);
  }

  /** Los accesos directos calculan un total global; GROUP BY se elige por separado. */
  protected addAggregate(fn: AggregateFunction = 'COUNT'): void {
    this.apply((model, catalog) => Model.addAggregate(model, catalog, fn, this.defaultAlias()));
  }

  protected patchAggregate(id: number, patch: Partial<AggregateDraft>): void {
    this.apply((model) => Model.patchAggregate(model, id, patch));
  }

  protected changeAggregateFunction(id: number, value: AggregateFunction): void {
    this.apply((model, catalog) => Model.changeAggregateFunction(model, catalog, id, value));
  }

  protected removeAggregate(id: number): void {
    this.apply((model) => Model.removeAggregate(model, id));
  }

  protected aggregateLabel(aggregate: AggregateDraft): string {
    return Model.aggregateLabel(aggregate, this.queryColumns());
  }

  protected addHaving(): void {
    this.apply(Model.addHaving);
  }

  protected patchHaving(id: number, patch: Partial<HavingDraft>): void {
    this.apply((model) => Model.patchHaving(model, id, patch));
  }

  protected removeHaving(id: number): void {
    this.apply((model) => Model.removeHaving(model, id));
  }

  protected addOrder(): void {
    this.apply(Model.addOrder);
  }

  protected patchOrder(id: number, patch: Partial<OrderDraft>): void {
    this.apply((model) => Model.patchOrder(model, id, patch));
  }

  protected removeOrder(id: number): void {
    this.apply((model) => Model.removeOrder(model, id));
  }

  protected havingKind(filter: HavingDraft): InputKind {
    return Model.havingKind(this.model(), this.catalog(), filter);
  }

  protected readonly availableRelations = computed(() => {
    const table = this.table();

    return this._store
      .searchableRelations()
      .filter(
        (node) =>
          node.connectionId === this.connectionId() &&
          node.source.database === table.database &&
          node.source.kind === 'table' &&
          node.source.id !== table.id,
      );
  });

  protected readonly availableSchemas = computed(() => {
    const table = this.table();

    return this._store
      .searchableSchemas()
      .filter(
        (node) =>
          node.connectionId === this.connectionId() && node.source.database === table.database,
      );
  });

  /** Añade un cruce; sin tabla dicha, con la primera que se ofrece. */
  protected addJoin(tableId?: string): void {
    const relation =
      tableId === undefined
        ? this.availableRelations()[0]
        : this.availableRelations().find((node) => node.source.id === tableId);

    if (tableId !== undefined && !relation) {
      return;
    }

    if (!relation && this.availableSchemas().length === 0) {
      return;
    }

    const id = Math.max(0, ...this.joins().map((join) => join.id)) + 1;
    this.joins.update((current) => [
      ...current,
      {
        id,
        type: 'INNER',
        tableId: relation?.source.id ?? '',
        search: relation ? this.relationLabel(relation.source) : '',
        leftJoinId: null,
        leftColumn: this.columns()[0]?.name ?? '',
        rightColumn: '',
        columns: [],
        chosen: [],
        loading: !!relation,
        suggestionsOpen: !relation,
        highlighted: 0,
      },
    ]);
    if (relation) {
      void this.loadJoin(id, relation.source);
    }
  }

  protected async addForeignKeyJoin(key: DatabaseForeignKey): Promise<void> {
    if (key.columns.length !== 1) {
      return;
    }

    const schema = key.referencedSchema ?? this.table().schema ?? '';
    await this._store.ensureRelationsAsync(schema, this.connectionId(), this.table().database);
    const relation = this.availableRelations().find(
      (node) => node.source.schema === schema && node.source.name === key.referencedTable,
    );

    if (!relation) {
      return;
    }

    const id = Math.max(0, ...this.joins().map((join) => join.id)) + 1;
    this.joins.update((current) => [
      ...current,
      {
        id,
        type: 'INNER',
        tableId: relation.source.id,
        search: this.relationLabel(relation.source),
        leftJoinId: null,
        leftColumn: key.columns[0],
        rightColumn: '',
        columns: [],
        chosen: [],
        loading: true,
        suggestionsOpen: false,
        highlighted: 0,
      },
    ]);
    await this.loadJoin(id, relation.source);

    let referenced: string | undefined = key.referencedColumns[0];
    if (!referenced) {
      const structure = await this._store.tableStructure(this.connectionId(), relation.source);
      referenced =
        structure?.primaryKey?.columns.length === 1 ? structure.primaryKey.columns[0] : undefined;
    }

    if (referenced) {
      this.patchJoin(id, { leftColumn: key.columns[0], rightColumn: referenced });
    }
  }

  /** Buscando el camino hasta una tabla. */
  protected readonly pathSearching = signal(false);

  /** Por qué no se añadió el camino pedido, si no se pudo. */
  protected readonly pathNotice = signal<string | null>(null);

  /**
   * Añade los cruces que llevan hasta una tabla, siguiendo las claves foráneas.
   *
   * Es la parte que más cuesta escribir a mano: de `clientes` a `productos` hay
   * que pasar por `pedidos` y por `lineas`, y acertar las cuatro columnas de
   * los dos `ON` intermedios. Aquí se elige el destino y el resto lo dice el
   * esquema, que se lee entero una vez para ver también quién apunta a quién.
   */
  protected async joinPathTo(tableId: string): Promise<void> {
    this.pathNotice.set(null);

    const target = this.availableRelations().find((node) => node.source.id === tableId)?.source;

    if (!target) {
      return;
    }

    const candidates = [this.table(), ...this.availableRelations().map((node) => node.source)];

    if (candidates.length > MAX_PATH_TABLES) {
      this.pathNotice.set(
        this._i18n.t('builder.tooManyTables', {
          count: candidates.length,
          max: MAX_PATH_TABLES,
        }),
      );
      return;
    }

    this.pathSearching.set(true);

    try {
      const graph = await this._store.schemaGraph(this.connectionId(), candidates);

      if (!graph) {
        this.pathNotice.set(this._i18n.t('builder.schemaFailed'));
        return;
      }

      const path = findJoinPath(graph, this.table(), target);

      if (path === null) {
        this.pathNotice.set(
          this._i18n.t('builder.noPath', {
            hops: MAX_JOIN_HOPS,
            from: this.table().name,
            to: target.name,
          }),
        );
        return;
      }

      const sameTable = (
        a: { schema?: string; name: string },
        b: { schema?: string; name: string },
      ) =>
        a.name.toLowerCase() === b.name.toLowerCase() &&
        (a.schema ?? this.table().schema ?? '').toLowerCase() ===
          (b.schema ?? this.table().schema ?? '').toLowerCase();

      let leftJoinId: number | null = null;
      let nextId = Math.max(0, ...this.joins().map((join) => join.id)) + 1;
      const added: SavedJoin[] = [];

      for (const step of path) {
        const relation = this.availableRelations().find((node) => sameTable(node.source, step.to));

        if (!relation) {
          this.pathNotice.set(this._i18n.t('builder.pathOutOfView', { table: step.to.name }));
          return;
        }

        added.push({
          id: nextId,
          type: 'INNER',
          tableId: relation.source.id,
          schema: relation.source.schema ?? '',
          table: relation.source.name,
          leftJoinId,
          leftColumn: step.fromColumn,
          rightColumn: step.toColumn,
          chosen: [],
        });
        leftJoinId = nextId;
        nextId += 1;
      }

      this.joins.update((current) => [
        ...current,
        ...added.map((join) => ({
          ...join,
          search: this.relationLabel(
            this.availableRelations().find((node) => node.source.id === join.tableId)!.source,
          ),
          columns: [],
          loading: true,
          suggestionsOpen: false,
          highlighted: 0,
        })),
      ]);

      await Promise.all(added.map((join) => this.restoreJoinColumns(join)));
    } finally {
      this.pathSearching.set(false);
    }
  }

  protected readonly simpleForeignKeys = computed(() =>
    this.foreignKeys().filter((key) => key.columns.length === 1),
  );

  protected removeJoin(id: number): void {
    this.joins.update((current) =>
      current
        .filter((join) => join.id !== id)
        .map((join) =>
          join.leftJoinId === id
            ? {
                ...join,
                leftJoinId: null,
                leftColumn: this.preferredColumn(this.columns(), join.leftColumn, join.rightColumn),
              }
            : join,
        ),
    );
    this.pruneGrouping();
  }

  protected patchJoin(id: number, patch: Partial<JoinDraft>): void {
    this.joins.update((current) =>
      current.map((join) => (join.id === id ? { ...join, ...patch } : join)),
    );
  }

  /** La condición solo puede partir de la tabla principal o de un JOIN anterior. */
  protected joinSources(join: JoinDraft): readonly JoinSource[] {
    const joins = this.joins();
    const index = joins.findIndex((item) => item.id === join.id);
    const base: JoinSource = {
      joinId: null,
      alias: 't0',
      label: this.relationLabel(this.table()),
      columns: this.columns(),
    };

    if (index <= 0) {
      return [base];
    }

    return [
      base,
      ...joins.slice(0, index).flatMap((candidate, candidateIndex) => {
        const relation = this.joinRelation(candidate);

        return relation
          ? [
              {
                joinId: candidate.id,
                alias: `t${candidateIndex + 1}`,
                label: this.relationLabel(relation),
                columns: candidate.columns,
              },
            ]
          : [];
      }),
    ];
  }

  protected leftColumns(join: JoinDraft): readonly KnownColumn[] {
    return (
      this.joinSources(join).find((source) => source.joinId === join.leftJoinId)?.columns ??
      this.columns()
    );
  }

  protected changeJoinSource(id: number, value: string): void {
    const join = this.joins().find((item) => item.id === id);

    if (!join) {
      return;
    }

    const joinId = value === '' ? null : Number.parseInt(value, 10);
    const source = this.joinSources(join).find((option) => option.joinId === joinId);

    if (!source) {
      return;
    }

    this.patchJoin(id, {
      leftJoinId: source.joinId,
      leftColumn: this.preferredColumn(source.columns, join.leftColumn, join.rightColumn),
    });
  }

  protected changeJoinTable(id: number, tableId: string): void {
    const relation = this.availableRelations().find((node) => node.source.id === tableId);

    if (!relation) {
      return;
    }

    this.patchJoin(id, {
      tableId,
      search: this.relationLabel(relation.source),
      rightColumn: '',
      columns: [],
      chosen: [],
      loading: true,
    });
    void this.loadJoin(id, relation.source);
  }

  protected async searchJoinTable(id: number, value: string): Promise<void> {
    this.patchJoin(id, { search: value, suggestionsOpen: true, highlighted: 0 });

    const exact = this.availableRelations().find(
      (node) => this.relationLabel(node.source).toLowerCase() === value.trim().toLowerCase(),
    );

    if (exact) {
      this.changeJoinTable(id, exact.source.id);
      return;
    }

    const dot = value.indexOf('.');

    if (dot > 0) {
      await this._store.ensureRelationsAsync(
        value.slice(0, dot).trim(),
        this.connectionId(),
        this.table().database,
      );
    }
  }

  protected joinSuggestions(join: JoinDraft): JoinSuggestion[] {
    const term = join.search.trim().toLowerCase();
    const selected = this.relationLabel(this.joinRelation(join)).toLowerCase();
    const schemas = this.availableSchemas().map<JoinSuggestion>((node) => ({
      id: `schema:${node.source.name}`,
      kind: 'schema',
      schema: node.source.name,
    }));
    const tables = this.availableRelations().map<JoinSuggestion>((node) => ({
      id: node.source.id,
      kind: 'table',
      schema: node.source.schema ?? '',
      tableId: node.source.id,
      table: node.source.name,
    }));

    if (!term || term === selected) {
      return [...schemas, ...tables].slice(0, MAX_JOIN_SUGGESTIONS);
    }

    return [...schemas, ...tables]
      .filter((suggestion) => this.suggestionLabel(suggestion).toLowerCase().includes(term))
      .sort((left, right) => this.suggestionRank(left, term) - this.suggestionRank(right, term))
      .slice(0, MAX_JOIN_SUGGESTIONS);
  }

  protected openJoinSuggestions(id: number): void {
    this.patchJoin(id, { suggestionsOpen: true, highlighted: 0 });
  }

  protected closeJoinSuggestions(id: number): void {
    this.patchJoin(id, { suggestionsOpen: false });
  }

  protected selectJoinSuggestion(event: Event, id: number, suggestion: JoinSuggestion): void {
    event.preventDefault();

    if (suggestion.kind === 'schema') {
      this.patchJoin(id, {
        search: `${suggestion.schema}.`,
        suggestionsOpen: true,
        highlighted: 0,
      });
      void this._store.ensureRelationsAsync(
        suggestion.schema,
        this.connectionId(),
        this.table().database,
      );
      return;
    }

    this.changeJoinTable(id, suggestion.tableId!);
    this.patchJoin(id, { suggestionsOpen: false, highlighted: 0 });
  }

  protected onJoinSearchKeydown(event: KeyboardEvent, join: JoinDraft): void {
    const suggestions = this.joinSuggestions(join);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.patchJoin(join.id, {
          suggestionsOpen: true,
          highlighted: Math.min(join.highlighted + 1, Math.max(0, suggestions.length - 1)),
        });
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.patchJoin(join.id, {
          suggestionsOpen: true,
          highlighted: Math.max(0, join.highlighted - 1),
        });
        break;
      case 'Enter': {
        const selected = suggestions[join.highlighted];

        if (join.suggestionsOpen && selected) {
          event.preventDefault();
          this.selectJoinSuggestion(event, join.id, selected);
        }
        break;
      }
      case 'Escape':
        /**
         * Solo con sugerencias a la vista, y sin dejar subir la tecla.
         *
         * El diálogo escucha Escape en el documento para cerrarse: sin
         * detenerla aquí, cerrar el desplegable cerraría también la ventana
         * entera y se perdería la consulta a medio componer. Y cuando no hay
         * desplegable, la tecla tiene que llegar arriba para que Escape siga
         * cerrando el diálogo desde este campo como desde cualquier otro.
         */
        if (join.suggestionsOpen) {
          event.preventDefault();
          event.stopPropagation();
          this.closeJoinSuggestions(join.id);
        }
        break;
    }
  }

  protected toggleJoinColumn(id: number, name: string): void {
    const join = this.joins().find((item) => item.id === id);

    if (!join) {
      return;
    }

    this.patchJoin(id, {
      chosen: join.chosen.includes(name)
        ? join.chosen.filter((column) => column !== name)
        : [...join.chosen, name],
    });
  }

  protected joinRelation(join: JoinDraft): DatabaseObject | undefined {
    return this.availableRelations().find((node) => node.source.id === join.tableId)?.source;
  }

  protected relationLabel(relation?: DatabaseObject): string {
    if (!relation) {
      return '';
    }

    return relation.schema ? `${relation.schema}.${relation.name}` : relation.name;
  }

  private matchRank(relation: DatabaseObject, term: string): number {
    const label = this.relationLabel(relation).toLowerCase();
    const name = relation.name.toLowerCase();

    if (label.startsWith(term)) {
      return 0;
    }

    if (name.startsWith(term)) {
      return 1;
    }

    return 2;
  }

  protected suggestionLabel(suggestion: JoinSuggestion): string {
    return suggestion.kind === 'schema'
      ? suggestion.schema
      : `${suggestion.schema}.${suggestion.table}`;
  }

  private suggestionRank(suggestion: JoinSuggestion, term: string): number {
    if (suggestion.kind === 'schema') {
      return suggestion.schema.toLowerCase().startsWith(term) ? 0 : 3;
    }

    const relation = this.availableRelations().find(
      (node) => node.source.id === suggestion.tableId,
    );
    return relation ? this.matchRank(relation.source, term) + 1 : 4;
  }

  protected addFilter(): void {
    this.apply(Model.addFilter);
  }

  protected removeFilter(index: number): void {
    this.apply((model) => Model.removeFilter(model, index));
  }

  protected patchFilter(index: number, patch: Partial<QueryFilter>): void {
    this.apply((model) => Model.patchFilter(model, index, patch));
  }

  protected setInSource(index: number, inSource: 'list' | 'query'): void {
    this.patchFilter(index, { inSource, value: null, compareColumn: null });
  }

  protected addUpdateFilter(): void {
    this.invalidateAffected();
    const first = this.columns()[0]?.name ?? '';
    this.updateFilters.update((current) => [
      ...current,
      { column: first, operator: '=', value: null },
    ]);
  }

  protected removeUpdateFilter(index: number): void {
    this.invalidateAffected();
    this.updateFilters.update((current) => current.filter((_, i) => i !== index));
  }

  protected patchUpdateFilter(index: number, patch: Partial<QueryFilter>): void {
    this.invalidateAffected();
    this.updateFilters.update((current) =>
      current.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)),
    );
  }

  /**
   * Con qué control se pide el valor de un filtro.
   *
   * El filtro guarda el nombre de la columna, no su tipo, así que se busca en lo
   * que ya se cargó. `IN` se queda en texto libre a propósito: espera una lista
   * separada por comas, y un calendario no sabe escribir eso.
   */
  protected filterKind(filter: QueryFilter): InputKind {
    return Model.filterKind(filter, this.columns());
  }

  protected draftFor(operation: 'insert' | 'update', name: string): ColumnDraft | undefined {
    return (operation === 'insert' ? this.insertDrafts() : this.updateDrafts()).find(
      (draft) => draft.name === name,
    );
  }

  protected patchDraft(
    operation: 'insert' | 'update',
    name: string,
    patch: Partial<ColumnDraft>,
  ): void {
    const target = operation === 'insert' ? this.insertDrafts : this.updateDrafts;
    target.update((current) =>
      current.map((draft) =>
        draft.name === name
          ? {
              ...draft,
              ...patch,
              text:
                patch.mode === 'value' && draft.mode !== 'value'
                  ? null
                  : (patch.text ?? draft.text),
            }
          : draft,
      ),
    );
  }

  /** `IS NULL` y `IS NOT NULL` no llevan valor: el campo estorba. */
  protected needsValue(operator: FilterOperator): boolean {
    return Model.needsValue(operator);
  }

  /** Si los filtros mezclan AND y OR, que es cuando el orden importa. */
  protected readonly mixesConjunctions = computed(
    () =>
      new Set(
        this.filters()
          .slice(1)
          .map((filter) => filter.conjunction ?? 'AND'),
      ).size > 1,
  );

  /**
   * Lo que se escribió en el campo de valor, tal como lo guarda el filtro.
   *
   * Vaciar el campo de una columna que no es de texto deja el valor pendiente:
   * en un número o una fecha, `''` no es un valor, y escribirlo producía
   * `"id" = ''`. En texto sí lo es, y se respeta.
   */
  protected filterText(filter: QueryFilter, text: string): string | null {
    return Model.filterText(filter, text, this.columns());
  }

  /** Si el operador compara dos cosas, y por tanto admite otra columna. */
  protected isComparison(operator: FilterOperator): boolean {
    return COMPARISON_OPERATORS.includes(operator);
  }

  /**
   * Cambia entre comparar con un valor y con otra columna.
   *
   * Al pasar a columna se propone una distinta de la del filtro: comparar una
   * columna consigo misma no filtra nada.
   */
  protected setCompareTarget(index: number, target: 'value' | 'column'): void {
    const filter = this.filters()[index];

    if (!filter) {
      return;
    }

    if (target === 'value') {
      this.patchFilter(index, { compareColumn: null });
      return;
    }

    const otra =
      this.columns().find((column) => column.name !== filter.column)?.name ?? filter.column;

    this.patchFilter(index, { compareColumn: otra });
  }

  /** Lista separada por comas: se explica en el propio campo. */
  protected isList(operator: FilterOperator): boolean {
    return Model.isList(operator);
  }

  protected setLimit(value: string): void {
    this.apply((model) => Model.setLimit(model, value));
  }

  protected async runPreview(): Promise<void> {
    if (this._destroyed || this.previewRunning() || !this.canPreview()) {
      return;
    }

    const executionId = crypto.randomUUID();
    const sql = this.sql();
    this._previewExecutionId = executionId;
    this.previewRunning.set(true);
    this.previewCanceling.set(false);
    this.previewResult.set(null);

    try {
      const result = await this._store.previewQuery(
        this.connectionId(),
        this.table().database,
        sql,
        executionId,
      );
      // Una consulta cancelada puede responder después de su sustituta.
      if (this._previewExecutionId === executionId) {
        this.previewSql.set(sql);
        this.previewResult.set(result);
      }
    } finally {
      if (this._previewExecutionId === executionId) {
        this._previewExecutionId = null;
        this.previewRunning.set(false);
        this.previewCanceling.set(false);
      }
    }
  }

  protected async cancelQueryPreview(): Promise<void> {
    if (!this._previewExecutionId || this.previewCanceling()) {
      return;
    }

    this.previewCanceling.set(true);
    await this._store.cancelExecution(this._previewExecutionId);
  }

  protected readonly previewSet = computed(() => this.previewResult()?.resultSets[0] ?? null);

  protected saveComposition(): void {
    const name = this.compositionName().trim();
    if (!name) {
      return;
    }

    const saved: SavedComposition = {
      id: crypto.randomUUID(),
      name,
      sql: this.sql(),
      state: this.compositionState(),
    };
    this.savedCompositions.update((current) => [saved, ...current]);
    this.compositionName.set('');
    void this.persistComposition(saved);
  }

  protected async loadComposition(saved: SavedComposition): Promise<void> {
    const state = Model.readCompositionState(saved.state);

    if (!state) {
      this.sqlOverride.set(saved.sql);
      return;
    }

    await this.applyState(state);
  }

  /** Pone el formulario como estaba en `state`. */
  private async applyState(state: CompositionState): Promise<void> {
    this.invalidateAffected();
    this.operation.set('select');
    const { joins: _joins, sqlOverride, layout, version: _version, ...form } = state;
    this._form.set({ ...form, distinct: form.distinct ?? false });
    this._layout.set(layout);
    this.sqlOverride.set(sqlOverride);

    // Los cruces se montan con las columnas que se eligieron, no con las que
    // propondría la tabla al elegirla de nuevo: `loadJoin` las recalcula, y
    // aquí eso desharía lo guardado.
    this.joins.set(
      state.joins.map((join) => ({
        ...join,
        search: `${join.schema ? `${join.schema}.` : ''}${join.table}`,
        columns: [],
        loading: true,
        suggestionsOpen: false,
        highlighted: 0,
      })),
    );

    await Promise.all(state.joins.map((join) => this.restoreJoinColumns(join)));
  }

  /** Lo que se guarda de la composición actual. */
  private compositionState(): CompositionState {
    const joins = this.joins().map<SavedJoin>((join) => {
      const relation = this.joinRelation(join);

      return {
        ...this.toModelJoin(join),
        tableId: join.tableId,
        schema: relation?.schema ?? '',
        // Una tabla que ya no se encuentra se guarda con lo que se escribió:
        // así se reconoce al reabrirla, en vez de quedar un cruce sin nombre.
        table: relation?.name ?? join.search,
      };
    });

    return Model.compositionState(this._form(), joins, this.sqlOverride(), this._layout());
  }

  /** El cruce como lo entiende el modelo: sin tabla conocida, no llega al SQL. */
  private toModelJoin(join: JoinDraft): ModelJoin {
    const relation = this.joinRelation(join);

    return {
      id: join.id,
      type: join.type,
      schema: relation?.schema ?? '',
      table: relation?.name ?? '',
      leftJoinId: join.leftJoinId,
      leftColumn: join.leftColumn,
      rightColumn: join.rightColumn,
      chosen: join.chosen,
    };
  }

  /**
   * Trae las columnas de un cruce restaurado, sin tocar las que se eligieron.
   *
   * Si la tabla ya no existe, el cruce se queda sin columnas y el formulario lo
   * enseña vacío: mejor que quitarlo en silencio y generar otra consulta.
   */
  private async restoreJoinColumns(join: SavedJoin): Promise<void> {
    let columns: readonly KnownColumn[] = [];

    try {
      columns = await this._store.ensureColumnsAsync(
        join.schema || null,
        join.table,
        this.connectionId(),
        this.table().database,
      );
    } catch {
      // Sin columnas: el cruce queda a la vista para corregirlo.
    }

    this.joins.update((current) =>
      current.map((item) => (item.id === join.id ? { ...item, columns, loading: false } : item)),
    );
  }

  protected async removeComposition(id: string): Promise<void> {
    const before = this.savedCompositions();
    this.savedCompositions.update((current) => current.filter((saved) => saved.id !== id));

    try {
      await firstValueFrom(this._gateway.deleteComposition(id));
      this.compositionError.set(null);
    } catch {
      // Se devuelve a la lista: quitarla de la vista sin haberla borrado haría
      // creer que ya no está.
      this.savedCompositions.set(before);
      this.compositionError.set(this._i18n.t('builder.compositionDeleteFailed'));
    }
  }

  protected insertSql(): void {
    // Solo el SELECT se puede reabrir: los de escritura van con sus valores
    // escritos y se ejecutan una vez.
    if (this.operation() === 'select') {
      this.composed.emit({ sql: this.sql(), state: this.compositionState() });
    }

    if (this.purpose() === 'editor') {
      this.insert.emit(this.sql());
    }

    this.closed.emit();
  }

  /** Las plantillas estructurales van directas al editor. */
  protected insertTemplate(kind: 'create' | 'drop'): void {
    const spec = {
      schema: this.table().schema,
      table: this.table().name,
      columns: this.columns(),
    };

    const sql = {
      create: () => buildCreateTable(this.engine(), spec),
      drop: () => buildDropTable(this.engine(), spec),
    }[kind]();

    this.insert.emit(sql);
    this.closed.emit();
  }

  protected close(): void {
    clearTimeout(this._autoPreviewTimer);
    this._previewRefresh += 1;
    if (this._previewExecutionId) {
      void this.cancelQueryPreview();
      this._previewExecutionId = null;
    }
    this.closed.emit();
  }

  private invalidateAffected(): void {
    this._affectedRequest += 1;
    this.affected.set(null);
    this.counting.set(false);
  }

  private toWrites(drafts: readonly ColumnDraft[], allowDefault: boolean): ColumnWrite[] {
    return drafts.flatMap((draft) => {
      const column = this.columns().find((item) => item.name === draft.name);

      if (!column || draft.mode === 'omit') {
        return [];
      }

      const value =
        draft.mode === 'null'
          ? ({ kind: 'null' } as const)
          : draft.mode === 'default' && allowDefault
            ? ({ kind: 'default' } as const)
            : ({ kind: 'value', text: draft.text } as const);

      return [{ column: draft.name, dataType: column.dataType, value }];
    });
  }

  private async loadJoin(id: number, table: DatabaseObject): Promise<void> {
    const columns = await this._store.ensureColumnsAsync(
      table.schema ?? null,
      table.name,
      this.connectionId(),
      table.database,
    );

    const join = this.joins().find((item) => item.id === id);

    // Puede haberse quitado el JOIN o elegido otra tabla mientras cargaba esta.
    if (!join || join.tableId !== table.id) {
      return;
    }

    const leftColumns = this.leftColumns(join);
    const matching = columns.find((column) =>
      leftColumns.some((item) => item.name === column.name),
    );
    const rightColumn = matching?.name ?? columns[0]?.name ?? '';
    const leftColumn =
      matching?.name ?? this.preferredColumn(leftColumns, join.leftColumn, rightColumn);

    this.joins.update((current) =>
      current.map((item) => {
        if (item.id === id) {
          return { ...item, columns, rightColumn, leftColumn, loading: false };
        }

        // Si otra condición parte de esta tabla, no conserva una columna que la
        // nueva tabla ya no tenga.
        return item.leftJoinId === id
          ? {
              ...item,
              leftColumn: this.preferredColumn(columns, item.leftColumn, item.rightColumn),
            }
          : item;
      }),
    );
    this.pruneGrouping();
  }

  private preferredColumn(columns: readonly KnownColumn[], current: string, peer: string): string {
    return (
      columns.find((column) => column.name === current)?.name ??
      columns.find((column) => column.name === peer)?.name ??
      columns[0]?.name ??
      ''
    );
  }

  private pruneGrouping(): void {
    this.apply(Model.pruneGrouping);
  }

  /**
   * Lee las composiciones de esta tabla desde la base de Druse.
   *
   * Las que quedaran en el almacenamiento del navegador —donde vivían antes—
   * se suben la primera vez y solo después se borran de allí: perderlas por el
   * camino sería peor que tenerlas en dos sitios un rato.
   */
  private async loadSavedCompositions(): Promise<void> {
    const table = this.table();

    try {
      const pending = this.legacyCompositions();

      for (const saved of pending) {
        await firstValueFrom(this._gateway.saveComposition(this.toRecord(saved)));
      }

      if (pending.length > 0) {
        this.forgetLegacyCompositions();
      }

      const records = await firstValueFrom(
        this._gateway.getCompositions(
          this.connectionId(),
          table.database ?? '',
          table.schema,
          table.name,
        ),
      );

      this.savedCompositions.set(records.flatMap((record) => fromRecord(record)));
      this.compositionError.set(null);
    } catch {
      // Sin la base, al menos lo que siga en el navegador: mejor que una lista
      // vacía que haga pensar que se perdieron.
      this.savedCompositions.set(this.legacyCompositions());
      this.compositionError.set(this._i18n.t('builder.compositionsReadFailed'));
    }
  }

  private async persistComposition(saved: SavedComposition): Promise<void> {
    try {
      await firstValueFrom(this._gateway.saveComposition(this.toRecord(saved)));
      this.compositionError.set(null);
    } catch {
      this.savedCompositions.update((current) => current.filter((item) => item.id !== saved.id));
      this.compositionError.set(this._i18n.t('builder.compositionSaveFailed'));
    }
  }

  private toRecord(saved: SavedComposition): SavedCompositionRecord {
    const table = this.table();

    return {
      id: saved.id,
      connectionId: this.connectionId(),
      database: table.database ?? '',
      schema: table.schema ?? null,
      table: table.name,
      name: saved.name,
      model: JSON.stringify({ sql: saved.sql, state: saved.state }),
    };
  }

  /** Dónde se guardaban antes, en el almacenamiento del navegador. */
  private legacyStorageKey(): string {
    const table = this.table();

    return `druse.query-builder.v1:${this.connectionId()}:${table.database}:${table.schema ?? ''}:${table.name}`;
  }

  private legacyCompositions(): SavedComposition[] {
    try {
      const raw = localStorage.getItem(this.legacyStorageKey());
      return raw ? (JSON.parse(raw) as SavedComposition[]) : [];
    } catch {
      return [];
    }
  }

  private forgetLegacyCompositions(): void {
    try {
      localStorage.removeItem(this.legacyStorageKey());
    } catch {
      // Si no se puede borrar, la próxima vez se vuelven a subir con el mismo
      // identificador y se reemplazan: no se duplican.
    }
  }
}

/** Lo que llega de la base, de vuelta a la forma del compositor. */
function fromRecord(record: SavedCompositionRecord): SavedComposition[] {
  try {
    const model = JSON.parse(record.model) as { sql?: string; state?: CompositionState };

    return typeof model.sql === 'string'
      ? [{ id: record.id, name: record.name, sql: model.sql, state: model.state }]
      : [];
  } catch {
    // Un modelo ilegible no puede tumbar la lista entera.
    return [];
  }
}

/**
 * Un campo del formulario que se lee y se escribe como una señal propia.
 *
 * El formulario vive entero en una sola señal para que el modelo lo trate de
 * una pieza, pero la plantilla y las pruebas siguen usando cada campo suelto:
 * escribir en uno reemplaza ese campo en el formulario común.
 */
function formField<K extends keyof SelectForm>(
  form: WritableSignal<SelectForm>,
  key: K,
): WritableSignal<SelectForm[K]> {
  const field = computed(() => form()[key]) as Signal<SelectForm[K]> &
    Partial<WritableSignal<SelectForm[K]>>;
  const set = (value: SelectForm[K]) => form.update((current) => ({ ...current, [key]: value }));

  return Object.assign(field, {
    set,
    update: (fn: (value: SelectForm[K]) => SelectForm[K]) => set(fn(form()[key])),
    asReadonly: () => field as Signal<SelectForm[K]>,
  }) as WritableSignal<SelectForm[K]>;
}

function readView(): 'form' | 'canvas' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'canvas' ? 'canvas' : 'form';
  } catch {
    return 'form';
  }
}

function readAutoPreview(): boolean {
  try {
    return localStorage.getItem(AUTO_PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}
