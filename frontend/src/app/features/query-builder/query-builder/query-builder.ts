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
  signal,
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
  AggregateFilter,
  AggregateFunction,
  ColumnWrite,
  FilterOperator,
  DatePeriod,
  JoinType,
  QueryFilter,
  QueryJoin,
  SelectAggregate,
  SelectColumn,
  SelectOrder,
  buildCreateTable,
  buildDropTable,
  buildDeleteCount,
  buildDeleteValues,
  buildInsertValues,
  buildSelect,
  buildUpdateValues,
  inSubquery,
  COMPARISON_OPERATORS,
} from '../../query-editor/sql-language/sql-writer';
import { SQL_DIALECTS } from '../../query-editor/sql-language/sql-dialects';
import { MAX_JOIN_HOPS, findJoinPath } from './join-path';
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

interface QueryColumnOption {
  readonly key: string;
  readonly label: string;
  readonly reference: string | SelectColumn;
  readonly column: KnownColumn;
}

interface AggregateDraft {
  readonly id: number;
  readonly function: AggregateFunction;
  readonly columnKey: '*' | string;
  readonly alias: string;
  readonly distinct: boolean;
}

interface HavingDraft {
  readonly id: number;
  readonly aggregateId: number;
  readonly operator: FilterOperator;
  readonly value: string | null;
  readonly conjunction: 'AND' | 'OR';
}

interface OrderDraft {
  readonly id: number;
  readonly target: string;
  readonly descending: boolean;
}

/** Un cruce tal como se guarda: lo justo para volver a montarlo. */
interface SavedJoin {
  readonly id: number;
  readonly type: JoinType;
  readonly tableId: string;
  readonly schema: string;
  readonly table: string;
  readonly leftJoinId: number | null;
  readonly leftColumn: string;
  readonly rightColumn: string;
  readonly chosen: readonly string[];
}

/**
 * El formulario de un SELECT, para poder volver a él.
 *
 * Antes solo se guardaba el SQL, y cargar una composición la dejaba como texto:
 * cambiar un filtro obligaba a rehacerla entera desde el formulario vacío.
 */
interface CompositionState {
  readonly chosen: readonly string[];
  readonly joins: readonly SavedJoin[];
  readonly filters: readonly QueryFilter[];
  readonly grouped: boolean;
  readonly groupByKeys: readonly string[];
  readonly groupPeriods: Readonly<Record<string, DatePeriod | 'none' | undefined>>;
  readonly aggregates: readonly AggregateDraft[];
  readonly having: readonly HavingDraft[];
  readonly orders: readonly OrderDraft[];
  readonly limit: number | null;
  /** Falta en las guardadas antes de que existiera. */
  readonly distinct?: boolean;
  /** El SQL retocado a mano, si lo estaba al guardar. */
  readonly sqlOverride: string | null;
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
  imports: [Icon, DialogBackdrop, DialogFocus, ValueInput, ResultsGrid, TranslatePipe],
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

  protected readonly chosen = signal<readonly string[]>([]);
  protected readonly columnSearch = signal('');
  protected readonly visibleColumns = computed(() => {
    const search = this.columnSearch().trim().toLocaleLowerCase();
    return this.columns().filter((column) =>
      `${column.name} ${column.dataType}`.toLocaleLowerCase().includes(search),
    );
  });
  protected readonly joins = signal<readonly JoinDraft[]>([]);
  protected readonly filters = signal<readonly QueryFilter[]>([]);
  protected readonly grouped = signal(false);
  protected readonly groupByKeys = signal<readonly string[]>([]);
  protected readonly groupPeriods = signal<
    Readonly<Record<string, DatePeriod | 'none' | undefined>>
  >({});
  protected readonly aggregates = signal<readonly AggregateDraft[]>([]);
  protected readonly having = signal<readonly HavingDraft[]>([]);
  protected readonly orders = signal<readonly OrderDraft[]>([
    { id: 1, target: '', descending: false },
  ]);
  protected readonly limit = signal<number | null>(100);
  protected readonly distinct = signal(false);
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
  protected readonly hasPendingValues = computed(() =>
    [...this.filters(), ...(this.grouped() ? this.having() : [])].some(
      (filter) =>
        this.needsValue(filter.operator) &&
        !(filter as QueryFilter).compareColumn &&
        (filter.value === null ||
          (this.isList(filter.operator) && !filter.value?.trim()) ||
          (filter.operator === 'BETWEEN' && (filter as QueryFilter).valueTo == null)),
    ),
  );

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

    const initial = this.initialState();

    if (initial) {
      await this.applyState(initial as CompositionState);
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
        const joins = this.joins();
        const queryJoins = this.toQueryJoins(joins);
        const grouped = this.grouped();
        const aggregates = grouped ? this.toAggregates() : [];
        return buildSelect(this.engine(), {
          ...base,
          alias: queryJoins.length > 0 ? 't0' : undefined,
          columns: grouped
            ? this.groupByKeys().flatMap((key) => {
                const option = this.queryColumns().find((column) => column.key === key);
                return option && (this.groupPeriods()[key] ?? 'none') === 'none'
                  ? [option.reference]
                  : [];
              })
            : queryJoins.length > 0
              ? this.selectedColumns(joins)
              : this.chosen(),
          joins: queryJoins,
          filters: this.filters().filter((filter) => filter.column.length > 0),
          groupBy: grouped
            ? this.groupByKeys().flatMap((key) => {
                const option = this.queryColumns().find((column) => column.key === key);
                return option && (this.groupPeriods()[key] ?? 'none') === 'none'
                  ? [option.reference]
                  : [];
              })
            : undefined,
          dateGroups: grouped
            ? this.groupByKeys().flatMap((key) => {
                const option = this.queryColumns().find((column) => column.key === key);
                const period = this.groupPeriods()[key] ?? 'none';
                return option && period !== 'none'
                  ? [{ column: option.reference, period, alias: `${option.column.name}_${period}` }]
                  : [];
              })
            : undefined,
          aggregates,
          having: grouped ? this.toHaving() : undefined,
          orders: this.toOrders(),
          limit: this.limit(),
          // Con GROUP BY cada grupo ya sale una sola vez: DISTINCT no añadiría nada.
          distinct: !grouped && this.distinct(),
        });
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
    this.sqlOverride.set(value);
  }

  protected resetSql(): void {
    this.sqlOverride.set(null);
  }

  protected isChosen(name: string): boolean {
    return this.chosen().includes(name);
  }

  /** Sin ninguna marcada se escribe `*`, que es lo que se quiere al empezar. */
  protected toggleColumn(name: string): void {
    this.chosen.update((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  protected selectVisibleColumns(): void {
    this.chosen.update((current) => [
      ...new Set([...current, ...this.visibleColumns().map((column) => column.name)]),
    ]);
  }

  /** Columnas disponibles para agrupar, incluidas las de los JOIN válidos. */
  protected readonly queryColumns = computed<readonly QueryColumnOption[]>(() => {
    const joins = this.joins();
    const aliases = this.toQueryJoins(joins).length > 0;
    const base = this.columns().map((column) => ({
      key: `base:${column.name}`,
      label: aliases ? `t0 · ${column.name}` : column.name,
      reference: aliases ? ({ alias: 't0', column: column.name } as SelectColumn) : column.name,
      column,
    }));
    const joined = joins.flatMap((join, index) =>
      this.joinRelation(join)
        ? join.columns.map((column) => ({
            key: `join:${join.id}:${column.name}`,
            label: `t${index + 1} · ${column.name}`,
            reference: { alias: `t${index + 1}`, column: column.name },
            column,
          }))
        : [],
    );

    return [...base, ...joined];
  });

  protected readonly groupedOrderColumns = computed(() => {
    const chosen = new Set(this.groupByKeys());
    return this.queryColumns().filter((column) => chosen.has(column.key));
  });

  protected readonly orderOptions = computed(() => {
    if (!this.grouped()) {
      return this.columns().map((column) => ({
        value: `column:${column.name}`,
        label: column.name,
      }));
    }

    return [
      ...this.groupedOrderColumns().map((column) => ({
        value: `group:${column.key}`,
        label: column.label,
      })),
      ...this.aggregates().map((aggregate) => ({
        value: `aggregate:${aggregate.id}`,
        label: aggregateLabelForOrder(aggregate, this.queryColumns()),
      })),
    ];
  });

  protected readonly validationMessages = computed(() => {
    const messages: string[] = [];

    for (const filter of this.filters()) {
      if (
        this.isList(filter.operator) &&
        filter.inSource === 'query' &&
        filter.value?.trim() &&
        !inSubquery(filter.value)
      ) {
        messages.push(this._i18n.t('builder.inQueryInvalid'));
      }
    }

    if (!this.grouped()) {
      return [...new Set(messages)];
    }

    if (this.grouped() && this.groupByKeys().length === 0 && this.aggregates().length === 0) {
      messages.push(this._i18n.t('builder.needsGroupOrAggregate'));
    }

    for (const aggregate of this.aggregates()) {
      const column = this.queryColumns().find(
        (option) => option.key === aggregate.columnKey,
      )?.column;

      if (
        column &&
        (aggregate.function === 'SUM' || aggregate.function === 'AVG') &&
        !isNumericColumn(column)
      ) {
        messages.push(
          this._i18n.t('builder.needsNumeric', {
            function: aggregate.function,
            column: column.name,
          }),
        );
      }

      if (aggregate.distinct && aggregate.columnKey === '*') {
        messages.push(this._i18n.t('builder.needsConcreteColumn'));
      }
    }

    for (const key of this.groupByKeys()) {
      const period = this.groupPeriods()[key] ?? 'none';
      const column = this.queryColumns().find((option) => option.key === key)?.column;
      if (period !== 'none' && column && !isDateColumn(column)) {
        // El período se dice como en el desplegable que lo eligió, no con el
        // nombre del contrato: «Por mes» y no «month».
        messages.push(
          this._i18n.t('builder.needsDate', {
            period: this._i18n
              .t(`builder.period.${period}`)
              .toLocaleLowerCase(this._i18n.intlLocale()),
            column: column.name,
          }),
        );
      }
    }

    return [...new Set(messages)];
  });

  protected toggleGrouping(): void {
    const grouped = !this.grouped();
    this.grouped.set(grouped);
    this.orders.set([{ id: 1, target: '', descending: false }]);

    if (!grouped) {
      return;
    }

    if (this.groupByKeys().length === 0) {
      const selected = this.chosen()
        .map((name) => `base:${name}`)
        .filter((key) => this.queryColumns().some((column) => column.key === key));
      const first = this.queryColumns()[0]?.key;
      this.groupByKeys.set(selected.length > 0 ? selected : first ? [first] : []);
    }

    if (this.aggregates().length === 0) {
      this.addAggregate();
    }
  }

  protected isGrouped(key: string): boolean {
    return this.groupByKeys().includes(key);
  }

  protected clearGroupColumns(): void {
    this.groupByKeys.set([]);
    this.orders.update((current) =>
      current.map((order) =>
        order.target.startsWith('group:') ? { ...order, target: '' } : order,
      ),
    );
  }

  protected toggleGroupColumn(key: string): void {
    this.groupByKeys.update((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

    this.orders.update((current) =>
      current.map((order) =>
        order.target === `group:${key}` && !this.groupByKeys().includes(key)
          ? { ...order, target: '' }
          : order,
      ),
    );
  }

  protected setGroupPeriod(key: string, period: DatePeriod | 'none'): void {
    this.groupPeriods.update((current) => ({ ...current, [key]: period }));
  }

  protected canGroupByDate(option: QueryColumnOption): boolean {
    return isDateColumn(option.column);
  }

  protected addAggregate(fn: AggregateFunction = 'COUNT'): void {
    // Los accesos directos calculan un total global; GROUP BY se elige por separado.
    if (!this.grouped()) {
      this.grouped.set(true);
      this.groupByKeys.set([]);
      this.orders.set([{ id: 1, target: '', descending: false }]);
    }
    const id = Math.max(0, ...this.aggregates().map((aggregate) => aggregate.id)) + 1;
    this.aggregates.update((current) => [
      ...current,
      {
        id,
        function: fn,
        columnKey: fn === 'COUNT' ? '*' : this.preferredAggregateColumn(fn),
        alias: id === 1 ? this.defaultAlias() : `${this.defaultAlias()}_${id}`,
        distinct: false,
      },
    ]);
  }

  private preferredAggregateColumn(fn: AggregateFunction): string {
    const columns = this.queryColumns();
    const preferred =
      fn === 'SUM' || fn === 'AVG'
        ? (columns.find(
            (option) => isNumericColumn(option.column) && !option.column.isPrimaryKey,
          ) ?? columns.find((option) => isNumericColumn(option.column)))
        : columns.find((option) => this.chosen().includes(option.column.name));
    return preferred?.key ?? columns[0]?.key ?? '';
  }

  protected patchAggregate(id: number, patch: Partial<AggregateDraft>): void {
    this.aggregates.update((current) =>
      current.map((aggregate) => (aggregate.id === id ? { ...aggregate, ...patch } : aggregate)),
    );
  }

  protected changeAggregateFunction(id: number, value: AggregateFunction): void {
    const aggregate = this.aggregates().find((item) => item.id === id);

    if (!aggregate) {
      return;
    }

    this.patchAggregate(id, {
      function: value,
      columnKey:
        value !== 'COUNT' && aggregate.columnKey === '*'
          ? this.preferredAggregateColumn(value)
          : aggregate.columnKey,
    });
  }

  protected removeAggregate(id: number): void {
    this.aggregates.update((current) => current.filter((aggregate) => aggregate.id !== id));
    this.having.update((current) => current.filter((filter) => filter.aggregateId !== id));
    this.orders.update((current) =>
      current.map((order) =>
        order.target === `aggregate:${id}` ? { ...order, target: '' } : order,
      ),
    );
  }

  protected aggregateLabel(aggregate: AggregateDraft): string {
    const column =
      aggregate.columnKey === '*'
        ? '*'
        : (this.queryColumns().find((option) => option.key === aggregate.columnKey)?.label ?? '?');

    return `${aggregate.function}(${column})${aggregate.alias ? ` · ${aggregate.alias}` : ''}`;
  }

  protected addHaving(): void {
    const aggregate = this.aggregates()[0];

    if (!aggregate) {
      return;
    }

    const id = Math.max(0, ...this.having().map((filter) => filter.id)) + 1;
    this.having.update((current) => [
      ...current,
      { id, aggregateId: aggregate.id, operator: '>', value: null, conjunction: 'AND' },
    ]);
  }

  protected patchHaving(id: number, patch: Partial<HavingDraft>): void {
    this.having.update((current) =>
      current.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)),
    );
  }

  protected removeHaving(id: number): void {
    this.having.update((current) => current.filter((filter) => filter.id !== id));
  }

  protected addOrder(): void {
    const id = Math.max(0, ...this.orders().map((order) => order.id)) + 1;
    this.orders.update((current) => [...current, { id, target: '', descending: false }]);
  }

  protected patchOrder(id: number, patch: Partial<OrderDraft>): void {
    this.orders.update((current) =>
      current.map((order) => (order.id === id ? { ...order, ...patch } : order)),
    );
  }

  protected removeOrder(id: number): void {
    this.orders.update((current) => current.filter((order) => order.id !== id));
  }

  protected havingKind(filter: HavingDraft): InputKind {
    const aggregate = this.aggregates().find((item) => item.id === filter.aggregateId);

    if (!aggregate || aggregate.function === 'COUNT') {
      return 'integer';
    }

    if (aggregate.function === 'SUM' || aggregate.function === 'AVG') {
      return 'decimal';
    }

    return (
      this.queryColumns().find((column) => column.key === aggregate.columnKey)?.column.inputKind ??
      'text'
    );
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

  protected addJoin(): void {
    const relation = this.availableRelations()[0];

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
    const primera = this.columns()[0]?.name ?? '';

    this.filters.update((current) => [
      ...current,
      // `null` y no `''`: sin rellenar, el SQL lo marca como pendiente. Con
      // cadena vacía salía `"id" = ''`, una condición que parece completa.
      { column: primera, operator: '=', value: null, conjunction: 'AND' },
    ]);
  }

  protected removeFilter(index: number): void {
    this.filters.update((current) => current.filter((_, i) => i !== index));
  }

  protected patchFilter(index: number, patch: Partial<QueryFilter>): void {
    this.filters.update((current) =>
      current.map((filter, i) => {
        if (i !== index) return filter;
        if (patch.operator && this.isList(patch.operator) !== this.isList(filter.operator)) {
          return { ...filter, ...patch, value: null, compareColumn: null, inSource: 'list' };
        }
        return { ...filter, ...patch };
      }),
    );
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
    if (filter.operator === 'IN' || filter.operator === 'NOT IN') {
      return 'text';
    }

    return this.columns().find((column) => column.name === filter.column)?.inputKind ?? 'text';
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
    return operator !== 'IS NULL' && operator !== 'IS NOT NULL';
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
    if (this.isList(filter.operator) && !text.trim()) return null;
    return text === '' && this.filterKind(filter) !== 'text' ? null : text;
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
    return operator === 'IN' || operator === 'NOT IN';
  }

  protected setLimit(value: string): void {
    const numero = Number.parseInt(value, 10);

    this.limit.set(Number.isFinite(numero) && numero > 0 ? numero : null);
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
    if (!saved.state) {
      this.sqlOverride.set(saved.sql);
      return;
    }

    await this.applyState(saved.state);
  }

  /** Pone el formulario como estaba en `state`. */
  private async applyState(state: CompositionState): Promise<void> {
    this.invalidateAffected();
    this.operation.set('select');
    this.chosen.set(state.chosen);
    this.filters.set(state.filters);
    this.grouped.set(state.grouped);
    this.groupByKeys.set(state.groupByKeys);
    this.groupPeriods.set(state.groupPeriods);
    this.aggregates.set(state.aggregates);
    this.having.set(state.having);
    this.orders.set(state.orders);
    this.limit.set(state.limit);
    this.distinct.set(state.distinct ?? false);
    this.sqlOverride.set(state.sqlOverride);

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
    return {
      chosen: this.chosen(),
      joins: this.joins().map((join) => {
        const relation = this.availableRelations().find((node) => node.source.id === join.tableId);

        return {
          id: join.id,
          type: join.type,
          tableId: join.tableId,
          schema: relation?.source.schema ?? '',
          table: relation?.source.name ?? join.search,
          leftJoinId: join.leftJoinId,
          leftColumn: join.leftColumn,
          rightColumn: join.rightColumn,
          chosen: join.chosen,
        };
      }),
      filters: this.filters(),
      grouped: this.grouped(),
      groupByKeys: this.groupByKeys(),
      groupPeriods: this.groupPeriods(),
      aggregates: this.aggregates(),
      having: this.having(),
      orders: this.orders(),
      limit: this.limit(),
      distinct: this.distinct(),
      sqlOverride: this.sqlOverride(),
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

    this.insert.emit(this.sql());
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

  private selectedColumns(joins: readonly JoinDraft[]): readonly (string | SelectColumn)[] {
    if (joins.length === 0) {
      return this.chosen();
    }

    return [
      ...this.chosen().map((column) => ({ alias: 't0', column })),
      ...joins.flatMap((join, index) =>
        join.chosen.map((column) => ({ alias: `t${index + 1}`, column })),
      ),
    ];
  }

  private toQueryJoins(joins: readonly JoinDraft[]): QueryJoin[] {
    return joins.flatMap((join, index) => {
      const relation = this.joinRelation(join);

      if (!relation) {
        return [];
      }

      return [
        {
          type: join.type,
          schema: relation.schema,
          table: relation.name,
          alias: `t${index + 1}`,
          leftAlias:
            join.leftJoinId === null
              ? 't0'
              : `t${joins.findIndex((candidate) => candidate.id === join.leftJoinId) + 1}`,
          leftColumn: join.leftColumn,
          rightColumn: join.rightColumn,
        },
      ];
    });
  }

  private toAggregates(): SelectAggregate[] {
    return this.aggregates().flatMap((aggregate) => {
      const converted = this.toAggregate(aggregate);
      return converted ? [converted] : [];
    });
  }

  private toHaving(): AggregateFilter[] {
    return this.having().flatMap((filter) => {
      const draft = this.aggregates().find((aggregate) => aggregate.id === filter.aggregateId);
      const aggregate = draft ? this.toAggregate(draft) : undefined;

      return aggregate
        ? [
            {
              aggregate,
              operator: filter.operator,
              value: filter.value,
              conjunction: filter.conjunction,
            },
          ]
        : [];
    });
  }

  private toAggregate(aggregate: AggregateDraft): SelectAggregate | undefined {
    const column =
      aggregate.columnKey === '*'
        ? '*'
        : this.queryColumns().find((option) => option.key === aggregate.columnKey)?.reference;

    return column
      ? {
          function: aggregate.function,
          column,
          alias: aggregate.alias.trim() || undefined,
          distinct: aggregate.distinct,
        }
      : undefined;
  }

  private toOrders(): SelectOrder[] {
    const result: SelectOrder[] = [];

    for (const order of this.orders()) {
      if (!order.target) {
        continue;
      }

      if (order.target.startsWith('column:')) {
        result.push({
          expression: order.target.slice('column:'.length),
          descending: order.descending,
        });
        continue;
      }

      if (order.target.startsWith('aggregate:')) {
        const id = Number(order.target.slice('aggregate:'.length));
        const draft = this.aggregates().find((aggregate) => aggregate.id === id);
        const aggregate = draft ? this.toAggregate(draft) : undefined;
        if (aggregate) {
          result.push({ expression: aggregate, descending: order.descending });
        }
        continue;
      }

      const key = order.target.slice('group:'.length);
      const option = this.queryColumns().find((column) => column.key === key);
      const period = this.groupPeriods()[key] ?? 'none';

      if (!option) {
        continue;
      }

      result.push({
        expression:
          period === 'none'
            ? option.reference
            : { column: option.reference, period, alias: `${option.column.name}_${period}` },
        descending: order.descending,
      });
    }

    return result;
  }

  private pruneGrouping(): void {
    const validKeys = new Set(this.queryColumns().map((column) => column.key));
    this.groupByKeys.update((current) => current.filter((key) => validKeys.has(key)));
    const removed = new Set(
      this.aggregates()
        .filter((aggregate) => aggregate.columnKey !== '*' && !validKeys.has(aggregate.columnKey))
        .map((aggregate) => aggregate.id),
    );
    this.aggregates.update((current) => current.filter((aggregate) => !removed.has(aggregate.id)));
    this.having.update((current) => current.filter((filter) => !removed.has(filter.aggregateId)));
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

function isNumericColumn(column: KnownColumn): boolean {
  return /\b(tinyint|smallint|integer|int|int2|int4|int8|bigint|serial|decimal|numeric|number|real|float|float4|float8|double|money)\b/i.test(
    column.dataType,
  );
}

function isDateColumn(column: KnownColumn): boolean {
  return (
    column.inputKind === 'date' ||
    column.inputKind === 'datetime' ||
    column.inputKind === 'datetimeOffset' ||
    /(date|datetime2?|smalldatetime|timestamp)/i.test(column.dataType)
  );
}

function aggregateLabelForOrder(
  aggregate: AggregateDraft,
  columns: readonly QueryColumnOption[],
): string {
  const column =
    aggregate.columnKey === '*'
      ? '*'
      : (columns.find((option) => option.key === aggregate.columnKey)?.label ?? '?');
  return `${aggregate.function}(${aggregate.distinct ? 'DISTINCT ' : ''}${column})`;
}

function readAutoPreview(): boolean {
  try {
    return localStorage.getItem(AUTO_PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}
