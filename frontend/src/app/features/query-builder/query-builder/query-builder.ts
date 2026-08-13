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
import { DatabaseEngine, DatabaseObject, KnownColumn } from '../../../shared/models/workspace';
import {
  FilterOperator,
  QueryFilter,
  buildCreateTable,
  buildDropTable,
  buildInsert,
  buildSelect,
  buildUpdate,
} from '../../query-editor/sql-language/sql-writer';

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
 * Trabaja sobre una sola tabla a propósito. Un constructor de JOIN necesita
 * saber por qué columnas se relacionan las tablas, y eso Druse todavía no lo
 * lee del catálogo: ofrecerlo a ciegas sería pedirle al usuario que teclee la
 * condición dentro de un formulario, que es más trabajo que escribirla.
 */
@Component({
  selector: 'app-query-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  /** Columnas de la tabla, según lo que el catálogo ya sabe. */
  protected readonly columns = signal<readonly KnownColumn[]>([]);
  protected readonly loading = signal(true);
  protected readonly templatesReady = computed(() => !this.loading() && this.columns().length > 0);

  protected readonly chosen = signal<readonly string[]>([]);
  protected readonly filters = signal<readonly QueryFilter[]>([]);
  protected readonly orderBy = signal('');
  protected readonly descending = signal(false);
  protected readonly limit = signal<number | null>(100);

  ngOnInit(): void {
    // Las columnas hacen falta para todo lo de aquí; se piden una vez.
    void this.load();
  }

  private async load(): Promise<void> {
    const table = this.table();

    try {
      this.columns.set(
        await this._store.ensureColumnsAsync(
          table.schema ?? null,
          table.name,
          this.connectionId(),
          table.database,
        ),
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected readonly sql = computed(() =>
    buildSelect(this.engine(), {
      schema: this.table().schema,
      table: this.table().name,
      columns: this.chosen(),
      filters: this.filters().filter((filter) => filter.column.length > 0),
      orderBy: this.orderBy() || undefined,
      descending: this.descending(),
      limit: this.limit(),
    }),
  );

  protected isChosen(name: string): boolean {
    return this.chosen().includes(name);
  }

  /** Sin ninguna marcada se escribe `*`, que es lo que se quiere al empezar. */
  protected toggleColumn(name: string): void {
    this.chosen.update((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
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

  /** `IS NULL` y `IS NOT NULL` no llevan valor: el campo estorba. */
  protected needsValue(operator: FilterOperator): boolean {
    return operator !== 'IS NULL' && operator !== 'IS NOT NULL';
  }

  protected setLimit(value: string): void {
    const numero = Number.parseInt(value, 10);

    this.limit.set(Number.isFinite(numero) && numero > 0 ? numero : null);
  }

  protected insertSelect(): void {
    this.insert.emit(this.sql());
    this.closed.emit();
  }

  /** Las plantillas van directas al editor: no hay nada que componer en ellas. */
  protected insertTemplate(kind: 'insert' | 'update' | 'create' | 'drop'): void {
    const spec = {
      schema: this.table().schema,
      table: this.table().name,
      columns: this.columns(),
    };

    const sql = {
      insert: () => buildInsert(this.engine(), spec),
      update: () => buildUpdate(this.engine(), spec),
      create: () => buildCreateTable(this.engine(), spec),
      drop: () => buildDropTable(this.engine(), spec),
    }[kind]();

    this.insert.emit(sql);
    this.closed.emit();
  }

  protected close(): void {
    this.closed.emit();
  }
}
