import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

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
} from '../../query-editor/sql-language/sql-writer';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';

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

interface SavedComposition {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
}

const MAX_JOIN_SUGGESTIONS = 40;

/** Operadores que se ofrecen, en el orden en que se usan. */
const OPERATORS: readonly FilterOperator[] = [
  '=',
  '<>',
  '>',
  '>=',
  '<',
  '<=',
  'LIKE',
  'IN',
  'IS NULL',
  'IS NOT NULL',
];

const HAVING_OPERATORS: readonly FilterOperator[] = ['=', '<>', '>', '>=', '<', '<='];
const AGGREGATE_FUNCTIONS: readonly AggregateFunction[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
const DATE_PERIODS: readonly { readonly value: DatePeriod | 'none'; readonly label: string }[] = [
  { value: 'none', label: 'Valor completo' },
  { value: 'day', label: 'Por día' },
  { value: 'month', label: 'Por mes' },
  { value: 'quarter', label: 'Por trimestre' },
  { value: 'year', label: 'Por año' },
];

/**
 * Compone una consulta sin escribirla.
 *
 * No pretende sustituir al editor: **produce un punto de partida** que se
 * inserta y se sigue trabajando a mano, con el autocompletado y el resto de
 * ayudas. Por eso enseña el SQL mientras se compone, en vez de esconderlo
 * detrás de una interfaz que haya que aprender.
 *
 * Los JOIN son explícitos: se eligen las dos tablas y ambas columnas porque
 * Druse todavía no lee claves foráneas del catálogo y no debe inventar una
 * relación.
 */
@Component({
  selector: 'app-query-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogFocus, ValueInput, ResultsGrid],
  templateUrl: './query-builder.html',
  styleUrl: './query-builder.scss',
})
export class QueryBuilder implements OnInit {
  private readonly _store = inject(WorkspaceStore);

  readonly table = input.required<DatabaseObject>();
  readonly engine = input.required<DatabaseEngine>();
  readonly connectionId = input.required<string>();

  readonly closed = output<void>();
  readonly insert = output<string>();

  protected readonly operators = OPERATORS;
  protected readonly havingOperators = HAVING_OPERATORS;
  protected readonly aggregateFunctions = AGGREGATE_FUNCTIONS;
  protected readonly datePeriods = DATE_PERIODS;
  /**
   * Tipos de unión que ofrece el compositor.
   *
   * Ni MySQL ni Informix tienen `FULL OUTER JOIN`, así que allí no se enseña:
   * ofrecerlo produciría SQL que el servidor rechaza, y el usuario buscaría el
   * error en su consulta en vez de en el motor.
   */
  protected readonly joinTypes = computed<readonly JoinType[]>(() =>
    this.engine() === 'mysql' || this.engine() === 'informix'
      ? ['INNER', 'LEFT', 'RIGHT', 'CROSS']
      : ['INNER', 'LEFT', 'RIGHT', 'FULL OUTER', 'CROSS'],
  );

  /** Columnas de la tabla, según lo que el catálogo ya sabe. */
  protected readonly columns = signal<readonly KnownColumn[]>([]);
  protected readonly loading = signal(true);
  protected readonly templatesReady = computed(() => !this.loading() && this.columns().length > 0);
  protected readonly operation = signal<Operation>('select');
  protected readonly sqlOverride = signal<string | null>(null);

  protected readonly chosen = signal<readonly string[]>([]);
  protected readonly joins = signal<readonly JoinDraft[]>([]);
  protected readonly filters = signal<readonly QueryFilter[]>([]);
  protected readonly grouped = signal(false);
  protected readonly groupByKeys = signal<readonly string[]>([]);
  protected readonly groupPeriods = signal<Readonly<Record<string, DatePeriod | 'none'>>>({});
  protected readonly aggregates = signal<readonly AggregateDraft[]>([]);
  protected readonly having = signal<readonly HavingDraft[]>([]);
  protected readonly orders = signal<readonly OrderDraft[]>([
    { id: 1, target: '', descending: false },
  ]);
  protected readonly limit = signal<number | null>(100);
  protected readonly insertDrafts = signal<readonly ColumnDraft[]>([]);
  protected readonly updateDrafts = signal<readonly ColumnDraft[]>([]);
  protected readonly updateFilters = signal<readonly QueryFilter[]>([]);
  protected readonly foreignKeys = signal<readonly DatabaseForeignKey[]>([]);
  protected readonly previewResult = signal<QueryResult | null>(null);
  protected readonly previewRunning = signal(false);
  protected readonly previewCanceling = signal(false);
  protected readonly savedCompositions = signal<readonly SavedComposition[]>([]);
  protected readonly compositionName = signal('');
  private _previewExecutionId: string | null = null;

  ngOnInit(): void {
    // Las columnas hacen falta para todo lo de aquí; se piden una vez.
    void this.load();
    this.loadSavedCompositions();
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
      return this.columns().map((column) => ({ value: `column:${column.name}`, label: column.name }));
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

    if (this.grouped() && this.groupByKeys().length === 0 && this.aggregates().length === 0) {
      messages.push('Elige una columna de agrupación o al menos un cálculo agregado.');
    }

    for (const aggregate of this.aggregates()) {
      const column = this.queryColumns().find((option) => option.key === aggregate.columnKey)?.column;

      if (
        column &&
        (aggregate.function === 'SUM' || aggregate.function === 'AVG') &&
        !isNumericColumn(column)
      ) {
        messages.push(`${aggregate.function} requiere una columna numérica: ${column.name}.`);
      }

      if (aggregate.distinct && aggregate.columnKey === '*') {
        messages.push('COUNT DISTINCT necesita una columna concreta, no *.');
      }
    }

    for (const key of this.groupByKeys()) {
      const period = this.groupPeriods()[key] ?? 'none';
      const column = this.queryColumns().find((option) => option.key === key)?.column;
      if (period !== 'none' && column && !isDateColumn(column)) {
        messages.push(`La agrupación por ${period} requiere una fecha: ${column.name}.`);
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

  protected addAggregate(): void {
    const id = Math.max(0, ...this.aggregates().map((aggregate) => aggregate.id)) + 1;
    this.aggregates.update((current) => [
      ...current,
      {
        id,
        function: 'COUNT',
        columnKey: '*',
        alias: id === 1 ? 'cantidad' : `cantidad_${id}`,
        distinct: false,
      },
    ]);
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
          ? (this.queryColumns()[0]?.key ?? '*')
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
      (node) =>
        node.source.schema === schema && node.source.name === key.referencedTable,
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
      referenced = structure?.primaryKey?.columns.length === 1
        ? structure.primaryKey.columns[0]
        : undefined;
    }

    if (referenced) {
      this.patchJoin(id, { leftColumn: key.columns[0], rightColumn: referenced });
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
                leftColumn: this.preferredColumn(
                  this.columns(),
                  join.leftColumn,
                  join.rightColumn,
                ),
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
    const schemas = this.availableSchemas()
      .map<JoinSuggestion>((node) => ({
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

    const relation = this.availableRelations().find((node) => node.source.id === suggestion.tableId);
    return relation ? this.matchRank(relation.source, term) + 1 : 4;
  }

  protected addFilter(): void {
    const primera = this.columns()[0]?.name ?? '';

    this.filters.update((current) => [
      ...current,
      { column: primera, operator: '=', value: '', conjunction: 'AND' },
    ]);
  }

  protected removeFilter(index: number): void {
    this.filters.update((current) => current.filter((_, i) => i !== index));
  }

  protected patchFilter(index: number, patch: Partial<QueryFilter>): void {
    this.filters.update((current) =>
      current.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)),
    );
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
    if (filter.operator === 'IN') {
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
              text: patch.mode === 'value' && draft.mode !== 'value' ? null : (patch.text ?? draft.text),
            }
          : draft,
      ),
    );
  }

  /** `IS NULL` y `IS NOT NULL` no llevan valor: el campo estorba. */
  protected needsValue(operator: FilterOperator): boolean {
    return operator !== 'IS NULL' && operator !== 'IS NOT NULL';
  }

  protected setLimit(value: string): void {
    const numero = Number.parseInt(value, 10);

    this.limit.set(Number.isFinite(numero) && numero > 0 ? numero : null);
  }

  protected async runPreview(): Promise<void> {
    if (this.previewRunning() || this.validationMessages().length > 0) {
      return;
    }

    const executionId = crypto.randomUUID();
    this._previewExecutionId = executionId;
    this.previewRunning.set(true);
    this.previewCanceling.set(false);
    this.previewResult.set(null);

    try {
      this.previewResult.set(
        await this._store.previewQuery(
          this.connectionId(),
          this.table().database,
          this.sql(),
          executionId,
        ),
      );
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

    const saved: SavedComposition = { id: crypto.randomUUID(), name, sql: this.sql() };
    this.savedCompositions.update((current) => [saved, ...current]);
    this.compositionName.set('');
    this.persistSavedCompositions();
  }

  protected loadComposition(saved: SavedComposition): void {
    this.sqlOverride.set(saved.sql);
  }

  protected removeComposition(id: string): void {
    this.savedCompositions.update((current) => current.filter((saved) => saved.id !== id));
    this.persistSavedCompositions();
  }

  protected insertSql(): void {
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
    if (this._previewExecutionId) {
      void this.cancelQueryPreview();
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

  private preferredColumn(
    columns: readonly KnownColumn[],
    current: string,
    peer: string,
  ): string {
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

  private compositionStorageKey(): string {
    const table = this.table();
    return `druse.query-builder.v1:${this.connectionId()}:${table.database}:${table.schema ?? ''}:${table.name}`;
  }

  private loadSavedCompositions(): void {
    try {
      const raw = localStorage.getItem(this.compositionStorageKey());
      this.savedCompositions.set(raw ? (JSON.parse(raw) as SavedComposition[]) : []);
    } catch {
      this.savedCompositions.set([]);
    }
  }

  private persistSavedCompositions(): void {
    try {
      localStorage.setItem(this.compositionStorageKey(), JSON.stringify(this.savedCompositions()));
    } catch {
      // Guardar una composición no debe impedir seguir componiendo SQL.
    }
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
