import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, Observable, Subject, takeUntil } from 'rxjs';
import { ApplicationGateway } from '../application-gateway/application-gateway';
import { I18nService } from '../i18n/i18n.service';
import { describeError } from '../workspace/errors';
import { AiSource } from '../../shared/models/ai';
import { DatabaseObject, TableDetail } from '../../shared/models/workspace';
import { describeSelectedTables, qualifiedName } from './ai-context';

export interface AiCatalogTarget {
  readonly source: AiSource;
  readonly sessionId: string;
  readonly revision?: number;
}

export interface AiSelectedTable {
  readonly table: DatabaseObject;
  readonly detail?: TableDetail;
  readonly loading: boolean;
  readonly error?: string;
}

export function aiTableKey(table: DatabaseObject): string {
  return JSON.stringify([table.database, table.schema ?? '', table.name, table.kind]);
}

/** La selección vive por base; las respuestas del catálogo pertenecen a una sesión concreta. */
@Injectable({ providedIn: 'root' })
export class AiCatalog {
  private readonly gateway = inject(ApplicationGateway);
  private readonly i18n = inject(I18nService);
  private target: AiCatalogTarget | null = null;
  private signature = '';
  private generation = 0;
  private selectionVersion = 0;
  private readonly remembered = new Map<string, readonly DatabaseObject[]>();
  private readonly listing = new Subject<void>();
  private listed = false;
  private readonly tasks = new Map<string, { stop: Subject<void>; done: Promise<void> }>();
  private readonly _selected = signal<readonly AiSelectedTable[]>([]);
  private readonly _catalog = signal<readonly DatabaseObject[]>([]);
  readonly selected = this._selected.asReadonly();
  readonly catalog = this._catalog.asReadonly();
  readonly catalogLoading = signal(false);
  readonly catalogError = signal('');
  readonly allowPartial = signal(false);
  readonly loading = computed(() => this.selected().some((item) => item.loading));
  readonly failures = computed(() => this.selected().filter((item) => !!item.error));
  readonly described = computed(() =>
    describeSelectedTables(this.selected().flatMap((item) => (item.detail ? [item.detail] : []))),
  );
  readonly names = computed(() => this.selected().map((item) => qualifiedName(item.table)));
  readonly warnings = computed(() =>
    this.failures().map((item) =>
      this.i18n.t('ai.catalog.missingMetadata', { table: qualifiedName(item.table) }),
    ),
  );
  readonly suggestions = computed(() => {
    const selected = new Set(this.selected().map((item) => aiTableKey(item.table)));
    return this.catalog().filter(
      (table) =>
        !selected.has(aiTableKey(table)) &&
        this.selected().some((item) =>
          item.detail?.structure.foreignKeys.some(
            (key) =>
              key.referencedTable === table.name &&
              (key.referencedSchema ?? item.table.schema ?? '') === (table.schema ?? ''),
          ),
        ),
    );
  });

  activate(target: AiCatalogTarget): boolean {
    const signature = JSON.stringify(target);
    if (signature === this.signature) return false;
    this.pause();
    this.target = target;
    this.selectionVersion++;
    this.signature = signature;
    this._catalog.set([]);
    this.listed = false;
    this.catalogError.set('');
    this.allowPartial.set(false);
    const tables = this.remembered.get(this.scope()) ?? [];
    this._selected.set(tables.map((table) => ({ table, loading: false })));
    if (target.sessionId) void this.refreshSelected();
    return true;
  }

  pause(): void {
    this.generation++;
    this.signature = '';
    this.listing.next();
    this.catalogLoading.set(false);
    this.cancelLoads();
  }

  private scope(): string {
    return JSON.stringify([this.target?.source.connectionId, this.target?.source.database]);
  }

  isSelected(table: DatabaseObject): boolean {
    return this.selected().some((item) => aiTableKey(item.table) === aiTableKey(table));
  }

  add(table: DatabaseObject): void {
    if (!this.target?.sessionId || !['table', 'view'].includes(table.kind)) return;
    const normalized = { ...table, database: table.database ?? this.target.source.database };
    if (normalized.database !== this.target.source.database || this.isSelected(normalized)) return;
    this.allowPartial.set(false);
    this._selected.update((items) => [...items, { table: normalized, loading: false }]);
    this.selectionVersion++;
    this.remember();
    void this.load(normalized);
  }

  remove(table: DatabaseObject): void {
    this.selectionVersion++;
    const key = aiTableKey(table);
    this.tasks.get(key)?.stop.next();
    this.tasks.delete(key);
    this._selected.update((items) => items.filter((item) => aiTableKey(item.table) !== key));
    this.allowPartial.set(false);
    this.remember();
  }

  private remember(): void {
    this.remembered.set(
      this.scope(),
      this.selected().map((item) => item.table),
    );
  }

  cancelLoads(): void {
    for (const task of this.tasks.values()) task.stop.next();
    this.tasks.clear();
    this._selected.update((items) =>
      items.map((item) =>
        item.loading
          ? {
              ...item,
              loading: false,
              error: this.i18n.t('ai.catalog.cancelled'),
            }
          : item,
      ),
    );
  }

  /** Al enviar se relee: también puede haber cambiado el DDL desde otra aplicación. */
  async refreshSelected(): Promise<boolean> {
    if (!this.target?.sessionId) return this.selected().length === 0;
    const generation = this.generation;
    const selectionVersion = this.selectionVersion;
    this.cancelLoads();
    await Promise.all(this.selected().map((item) => this.load(item.table)));
    return generation === this.generation && selectionVersion === this.selectionVersion;
  }

  private load(table: DatabaseObject): Promise<void> {
    const target = this.target!;
    const generation = this.generation;
    const key = aiTableKey(table);
    const task = { stop: new Subject<void>(), done: Promise.resolve() };
    this.tasks.get(key)?.stop.next();
    this.tasks.set(key, task);
    const wasFailure = this.selected().find((item) => aiTableKey(item.table) === key)?.error;
    this.patch(key, { loading: true, detail: undefined, error: undefined });
    task.done = (async () => {
      try {
        const columns = await this.read(
          this.gateway.getColumns(target.sessionId, table),
          task.stop,
        );
        if (generation !== this.generation || this.tasks.get(key) !== task) return;
        if (!columns.length) throw new Error(this.i18n.t('ai.catalog.noColumns'));
        const structure =
          table.kind === 'view'
            ? {
                indexes: [],
                foreignKeys: [],
                uniqueConstraints: [],
                checkConstraints: [],
              }
            : await this.read(this.gateway.getTableStructure(target.sessionId, table), task.stop);
        if (generation === this.generation && this.tasks.get(key) === task) {
          this.patch(key, { detail: { table, columns, structure }, loading: false });
        }
      } catch (error) {
        if (generation === this.generation && this.tasks.get(key) === task) {
          if (!wasFailure) this.allowPartial.set(false);
          this.patch(key, {
            loading: false,
            error:
              error instanceof HttpErrorResponse
                ? describeError(error, this.i18n)
                : error instanceof Error
                  ? error.message
                  : this.i18n.t('error.unexpected'),
          });
        }
      } finally {
        if (this.tasks.get(key) === task) this.tasks.delete(key);
      }
    })();
    return task.done;
  }

  private patch(key: string, patch: Partial<AiSelectedTable>): void {
    this._selected.update((items) =>
      items.map((item) => (aiTableKey(item.table) === key ? { ...item, ...patch } : item)),
    );
  }

  async loadCatalog(force = false): Promise<void> {
    if (!this.target?.sessionId || this.catalogLoading() || (this.listed && !force)) return;
    this.listing.next();
    const generation = this.generation;
    const target = this.target;
    this.catalogLoading.set(true);
    this.catalogError.set('');
    const found: DatabaseObject[] = [];
    const visited = new Set<string>();
    const errors: string[] = [];
    const walk = async (parent: DatabaseObject, depth: number): Promise<void> => {
      if (generation !== this.generation) return;
      const identity = JSON.stringify([parent.kind, parent.id, parent.schema, parent.database]);
      if (depth > 8 || visited.has(identity)) {
        errors.push(this.i18n.t('ai.catalog.incomplete'));
        return;
      }
      visited.add(identity);
      try {
        const children = await this.read(
          this.gateway.getChildren(target.sessionId, parent),
          this.listing,
        );
        for (const child of children) {
          if (generation !== this.generation) return;
          const table = {
            ...child,
            database: child.database ?? parent.database,
            schema: child.schema ?? (parent.kind === 'schema' ? parent.name : parent.schema),
          };
          if (table.kind === 'table' || table.kind === 'view') found.push(table);
          else if (table.kind === 'schema' || table.kind === 'folder') await walk(table, depth + 1);
        }
      } catch (error) {
        errors.push(describeError(error, this.i18n));
      }
    };
    try {
      const databases = await this.read(this.gateway.getDatabases(target.sessionId), this.listing);
      if (generation !== this.generation) return;
      const database = databases.find(
        (item) => item.name === target.source.database || item.database === target.source.database,
      );
      if (!database) throw new Error(this.i18n.t('ai.catalog.databaseMissing'));
      await walk({ ...database, database: target.source.database }, 0);
      if (generation !== this.generation) return;
      this._catalog.set([...new Map(found.map((table) => [aiTableKey(table), table])).values()]);
      this.listed = errors.length === 0;
      this.catalogError.set(errors.join('\n'));
    } catch (error) {
      if (generation === this.generation)
        this.catalogError.set(
          error instanceof Error ? error.message : describeError(error, this.i18n),
        );
    } finally {
      if (generation === this.generation) this.catalogLoading.set(false);
    }
  }

  private read<T>(source: Observable<T>, stop: Subject<void>): Promise<T> {
    return firstValueFrom(source.pipe(takeUntil(stop)));
  }
}
