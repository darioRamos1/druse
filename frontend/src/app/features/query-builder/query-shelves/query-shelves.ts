import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ValueInput } from '../../../shared/ui/value-input/value-input';
import {
  AggregateFunction,
  DatePeriod,
  FilterOperator,
  QueryFilter,
} from '../../query-editor/sql-language/sql-writer';
import * as Model from '../query-model';
import { ModelCatalog, QueryColumnOption, SelectModel } from '../query-model';

/** Una operación del modelo; quien la recibe la aplica a su consulta. */
export type ModelEdit = (model: SelectModel, catalog: ModelCatalog) => SelectModel;

export type ShelfId = 'group' | 'value' | 'filter' | 'order';

const FUNCTIONS: readonly AggregateFunction[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
const PERIODS: readonly (DatePeriod | 'none')[] = ['none', 'day', 'month', 'quarter', 'year'];
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

/**
 * Los estantes del lienzo: agrupar, valores, filtros y orden.
 *
 * Son otra vista del mismo modelo que el formulario: cada pastilla es un grupo,
 * un cálculo, un filtro o un orden de la consulta. Se llenan soltando columnas
 * del lienzo o, con el teclado, desde el desplegable «Añadir» de cada estante.
 *
 * No guardan nada: devuelven operaciones del modelo y el compositor las aplica.
 */
@Component({
  selector: 'app-query-shelves',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ValueInput],
  templateUrl: './query-shelves.html',
  styleUrl: './query-shelves.scss',
})
export class QueryShelves {
  private readonly _i18n = inject(I18nService);

  readonly model = input.required<SelectModel>();
  readonly catalog = input.required<ModelCatalog>();
  /** Se está arrastrando una columna desde el lienzo: los estantes se marcan para soltarla. */
  readonly dragging = input(false);
  /** Por qué no se aceptó lo último que se soltó, si no se aceptó. */
  readonly notice = input<string | null>(null);

  readonly edit = output<ModelEdit>();

  protected readonly functions = FUNCTIONS;
  protected readonly periods = PERIODS;
  protected readonly operators = OPERATORS;

  protected readonly options = computed(() => Model.queryColumns(this.model(), this.catalog()));

  /** Lo que está en «Agrupar por», con la columna a la que apunta. */
  protected readonly groups = computed(() => {
    const options = this.options();
    return this.model().groupByKeys.flatMap((key) => {
      const option = options.find((item) => item.key === key);
      return option ? [option] : [];
    });
  });

  protected readonly groupable = computed(() => {
    const used = new Set(this.model().groupByKeys);
    return this.options().filter((option) => !used.has(option.key));
  });

  protected readonly orders = computed(() => {
    const labels = new Map(
      Model.orderOptions(this.model(), this.catalog()).map((option) => [
        option.value,
        option.label,
      ]),
    );

    return Model.activeOrders(this.model()).map((order) => ({
      ...order,
      label: labels.get(order.target) ?? order.target,
    }));
  });

  protected readonly orderable = computed(() => {
    const used = new Set(Model.activeOrders(this.model()).map((order) => order.target));
    return Model.orderOptions(this.model(), this.catalog()).filter(
      (option) => !used.has(option.value),
    );
  });

  private defaultAlias(): string {
    return this._i18n.t('builder.aliasDefault');
  }

  // ── Agrupar por ─────────────────────────────────────────────────────────

  protected addGroup(key: string): void {
    if (key) {
      const alias = this.defaultAlias();
      this.edit.emit((model, catalog) => Model.groupBy(model, catalog, key, alias));
    }
  }

  protected removeGroup(key: string): void {
    this.edit.emit((model) => Model.toggleGroupColumn(model, key));
  }

  protected setPeriod(key: string, period: DatePeriod | 'none'): void {
    this.edit.emit((model) => Model.setGroupPeriod(model, key, period));
  }

  protected period(key: string): DatePeriod | 'none' {
    return this.model().groupPeriods[key] ?? 'none';
  }

  protected isDate(option: QueryColumnOption): boolean {
    return Model.isDateColumn(option.column);
  }

  // ── Valores ─────────────────────────────────────────────────────────────

  /** `*` cuenta filas; cualquier otra clave es una columna. */
  protected addValue(key: string): void {
    if (!key) {
      return;
    }

    const alias = this.defaultAlias();
    this.edit.emit((model, catalog) =>
      key === '*'
        ? Model.addAggregate(model, catalog, 'COUNT', alias)
        : Model.addValue(model, catalog, key, alias),
    );
  }

  protected setFunction(id: number, value: AggregateFunction): void {
    this.edit.emit((model, catalog) => Model.changeAggregateFunction(model, catalog, id, value));
  }

  protected setAlias(id: number, alias: string): void {
    this.edit.emit((model) => Model.patchAggregate(model, id, { alias }));
  }

  protected removeValue(id: number): void {
    this.edit.emit((model) => Model.removeAggregate(model, id));
  }

  protected columnLabel(key: string): string {
    return key === '*' ? '*' : (this.options().find((option) => option.key === key)?.label ?? '?');
  }

  // ── Filtros ─────────────────────────────────────────────────────────────

  protected addFilter(column: string): void {
    if (column) {
      this.edit.emit((model) => Model.addFilterOn(model, column));
    }
  }

  protected patchFilter(index: number, patch: Partial<QueryFilter>): void {
    this.edit.emit((model) => Model.patchFilter(model, index, patch));
  }

  protected setValue(index: number, filter: QueryFilter, text: string, field: 'value' | 'valueTo') {
    const value = Model.filterText(filter, text, this.catalog().columns);
    this.patchFilter(index, { [field]: value });
  }

  protected removeFilter(index: number): void {
    this.edit.emit((model) => Model.removeFilter(model, index));
  }

  protected kind(filter: QueryFilter) {
    return Model.filterKind(filter, this.catalog().columns);
  }

  protected dataType(filter: QueryFilter): string {
    return this.catalog().columns.find((column) => column.name === filter.column)?.dataType ?? '';
  }

  protected needsValue(operator: FilterOperator): boolean {
    return Model.needsValue(operator);
  }

  protected isList(operator: FilterOperator): boolean {
    return Model.isList(operator);
  }

  // ── Orden ───────────────────────────────────────────────────────────────

  protected addOrder(target: string): void {
    if (target) {
      this.edit.emit((model) => Model.addOrderFor(model, target));
    }
  }

  protected flipOrder(id: number, descending: boolean): void {
    this.edit.emit((model) => Model.patchOrder(model, id, { descending: !descending }));
  }

  protected removeOrder(id: number): void {
    this.edit.emit((model) => Model.clearOrder(model, id));
  }

  // ── SQL a mano ──────────────────────────────────────────────────────────

  protected addExpression(aggregate: boolean): void {
    this.edit.emit((model) => Model.addExpression(model, aggregate));
  }

  protected patchExpression(id: number, patch: Partial<Model.ExpressionDraft>): void {
    this.edit.emit((model) => Model.patchExpression(model, id, patch));
  }

  protected removeExpression(id: number): void {
    this.edit.emit((model) => Model.removeExpression(model, id));
  }

  protected addCondition(): void {
    this.edit.emit(Model.addCondition);
  }

  protected patchCondition(id: number, patch: Partial<Model.ConditionDraft>): void {
    this.edit.emit((model) => Model.patchCondition(model, id, patch));
  }

  protected removeCondition(id: number): void {
    this.edit.emit((model) => Model.removeCondition(model, id));
  }

  protected expressionAlias(expression: Model.ExpressionDraft): string {
    return Model.expressionAlias(expression);
  }

  /** Un desplegable «Añadir» vuelve a su texto tras elegir: es un botón, no un valor. */
  protected reset(event: Event): void {
    (event.target as HTMLSelectElement).value = '';
  }
}
