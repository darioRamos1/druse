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
  DatabaseObject,
  InputKind,
  KnownColumn,
} from '../../../shared/models/workspace';
import {
  ColumnWrite,
  FilterOperator,
  JoinType,
  QueryFilter,
  QueryJoin,
  SelectColumn,
  buildCreateTable,
  buildDropTable,
  buildInsertValues,
  buildSelect,
  buildUpdateValues,
} from '../../query-editor/sql-language/sql-writer';

type Operation = 'select' | 'insert' | 'update';
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
  readonly leftColumn: string;
  readonly rightColumn: string;
  readonly columns: readonly KnownColumn[];
  readonly chosen: readonly string[];
  readonly loading: boolean;
  readonly suggestionsOpen: boolean;
  readonly highlighted: number;
}

interface JoinSuggestion {
  readonly id: string;
  readonly kind: 'schema' | 'table';
  readonly schema: string;
  readonly tableId?: string;
  readonly table?: string;
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

/**
 * Compone una consulta sin escribirla.
 *
 * No pretende sustituir al editor: **produce un punto de partida** que se
 * inserta y se sigue trabajando a mano, con el autocompletado y el resto de
 * ayudas. Por eso enseña el SQL mientras se compone, en vez de esconderlo
 * detrás de una interfaz que haya que aprender.
 *
 * Los JOIN son explícitos: se eligen ambas columnas porque Druse todavía no lee
 * claves foráneas del catálogo y no debe inventar una relación.
 */
@Component({
  selector: 'app-query-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ValueInput],
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
  protected readonly orderBy = signal('');
  protected readonly descending = signal(false);
  protected readonly limit = signal<number | null>(100);
  protected readonly insertDrafts = signal<readonly ColumnDraft[]>([]);
  protected readonly updateDrafts = signal<readonly ColumnDraft[]>([]);
  protected readonly updateFilters = signal<readonly QueryFilter[]>([]);

  ngOnInit(): void {
    // Las columnas hacen falta para todo lo de aquí; se piden una vez.
    void this.load();
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
      default:
        const joins = this.joins();
        const queryJoins = this.toQueryJoins(joins);
        return buildSelect(this.engine(), {
          ...base,
          alias: queryJoins.length > 0 ? 't0' : undefined,
          columns: queryJoins.length > 0 ? this.selectedColumns(joins) : this.chosen(),
          joins: queryJoins,
          filters: this.filters().filter((filter) => filter.column.length > 0),
          orderBy: this.orderBy() || undefined,
          descending: this.descending(),
          limit: this.limit(),
        });
    }
  });

  protected readonly sql = computed(() => this.sqlOverride() ?? this.generatedSql());

  protected setOperation(operation: Operation): void {
    this.operation.set(operation);
    this.sqlOverride.set(null);
  }

  protected patchSql(value: string): void {
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

  protected removeJoin(id: number): void {
    this.joins.update((current) => current.filter((join) => join.id !== id));
  }

  protected patchJoin(id: number, patch: Partial<JoinDraft>): void {
    this.joins.update((current) =>
      current.map((join) => (join.id === id ? { ...join, ...patch } : join)),
    );
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
        event.preventDefault();
        this.closeJoinSuggestions(join.id);
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

    this.filters.update((current) => [...current, { column: primera, operator: '=', value: '' }]);
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
    const first = this.columns()[0]?.name ?? '';
    this.updateFilters.update((current) => [
      ...current,
      { column: first, operator: '=', value: null },
    ]);
  }

  protected removeUpdateFilter(index: number): void {
    this.updateFilters.update((current) => current.filter((_, i) => i !== index));
  }

  protected patchUpdateFilter(index: number, patch: Partial<QueryFilter>): void {
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
    this.closed.emit();
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

    const matching = columns.find((column) => this.columns().some((item) => item.name === column.name));
    this.patchJoin(id, {
      columns,
      rightColumn: matching?.name ?? columns[0]?.name ?? '',
      leftColumn:
        matching?.name ?? this.joins().find((join) => join.id === id)?.leftColumn ?? '',
      loading: false,
    });
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
          leftAlias: 't0',
          leftColumn: join.leftColumn,
          rightColumn: join.rightColumn,
        },
      ];
    });
  }
}
