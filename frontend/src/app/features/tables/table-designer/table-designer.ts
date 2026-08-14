import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import {
  ColumnAlteration,
  DatabaseColumn,
  DatabaseObject,
  TableAlteration,
  TableColumnDesign,
  TableDesign,
} from '../../../shared/models/workspace';

/**
 * Una fila del diseñador.
 *
 * Lleva de dónde viene además de cómo debe quedar: sin `origin` no habría forma
 * de distinguir una columna renombrada de otra nueva, y esa diferencia es la que
 * separa un `RENAME` de un `DROP` seguido de un `ADD` que se lleva los datos.
 */
interface DesignRow {
  /** Nombre con el que la columna existe hoy; ausente si es nueva. */
  readonly origin?: string;
  /**
   * Cómo estaba la columna al abrir el diálogo.
   *
   * Es lo que permite mandar solo lo que de verdad cambió: sin esta foto habría
   * que enviar un `ALTER` por columna, y en MySQL cada uno la reescribe entera.
   */
  readonly before?: Omit<DesignRow, 'origin' | 'before' | 'dropped'>;
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  defaultValue: string;
  /** Marcada para borrar. Se conserva en pantalla, tachada, hasta aplicar. */
  dropped: boolean;
}

/**
 * Crear y modificar tablas.
 *
 * El diálogo no aplica nada sin enseñar antes el SQL exacto que va a ejecutar,
 * por la misma razón que la edición de filas: un `ALTER TABLE` mal entendido no
 * falla, funciona, y se lleva por delante una columna con datos dentro.
 */
@Component({
  selector: 'app-table-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './table-designer.html',
  styleUrl: './table-designer.scss',
})
export class TableDesigner {
  private readonly _store = inject(WorkspaceStore);

  readonly connectionId = input.required<string>();

  /** Esquema donde crear la tabla, o la tabla que se está modificando. */
  readonly target = input.required<DatabaseObject>();

  readonly closed = output<void>();

  /** Está modificando una tabla que ya existe. */
  protected readonly editing = computed(() => this.target().kind === 'table');

  protected readonly name = signal('');
  protected readonly rows = signal<DesignRow[]>([]);
  protected readonly dataTypes = signal<readonly string[]>([]);

  protected readonly statements = signal<readonly string[]>([]);
  protected readonly applied = signal<readonly string[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Nombre original, para saber si el usuario lo cambió. */
  private original = '';

  constructor() {
    // La carga se lanza desde un efecto y no desde el constructor porque las
    // entradas todavía no están vinculadas cuando el componente se construye.
    // Una sola vez: después manda lo que el usuario esté escribiendo.
    let loaded = false;

    effect(() => {
      const target = this.target();

      if (loaded || !target) {
        return;
      }

      loaded = true;
      void this.load();
    });
  }

  /** Se van a borrar columnas, y con ellas lo que contienen. */
  protected readonly destructive = computed(() =>
    this.rows().some((row) => row.dropped && row.origin),
  );

  protected addColumn(): void {
    this.rows.update((rows) => [
      ...rows,
      {
        name: '',
        dataType: this.dataTypes()[0] ?? '',
        isNullable: true,
        isPrimaryKey: false,
        isIdentity: false,
        defaultValue: '',
        dropped: false,
      },
    ]);

    this.statements.set([]);
  }

  /**
   * Quitar una columna nueva la borra de la lista; quitar una que ya existe solo
   * la marca, porque eso es una instrucción que hay que confirmar aparte.
   */
  protected removeColumn(index: number): void {
    this.rows.update((rows) => {
      const row = rows[index];

      if (!row.origin) {
        return rows.filter((_, position) => position !== index);
      }

      return rows.map((current, position) =>
        position === index ? { ...current, dropped: !current.dropped } : current,
      );
    });

    this.statements.set([]);
  }

  /** Cualquier cambio invalida el SQL que hubiera en pantalla. */
  protected touched(): void {
    this.statements.set([]);
    this.error.set(null);
  }

  protected async preview(): Promise<void> {
    const design = this.design();

    if (!design) {
      return;
    }

    this.busy.set(true);

    try {
      const statements = await this._store.previewTable(this.connectionId(), design);

      this.statements.set(statements);

      if (statements.length === 0) {
        this.error.set(this._store.notice() ?? 'No hay ningún cambio que aplicar.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async apply(): Promise<void> {
    const design = this.design();

    if (!design) {
      return;
    }

    this.busy.set(true);

    try {
      const statements =
        'table' in design
          ? await this._store.alterTable(this.connectionId(), design, this.destructive())
          : await this._store.createTable(this.connectionId(), design);

      if (statements) {
        this.applied.set(statements);
      } else {
        this.error.set(this._store.notice() ?? 'No se pudo aplicar el cambio.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  /** Título y verbo del botón, que cambian entre crear y modificar. */
  protected title(): string {
    return this.editing() ? `Modificar ${this.target().name}` : 'Crear tabla';
  }

  protected qualifiedTarget(): string {
    const target = this.target();
    const schema = this.editing() ? target.schema : target.name;

    return schema ? `${schema}` : (target.database ?? '');
  }

  private async load(): Promise<void> {
    this.dataTypes.set(await this._store.tableDataTypes(this.connectionId()));

    if (!this.editing()) {
      // Una tabla nueva empieza con una columna de identidad, que es como
      // empiezan casi todas y ahorra el paso más repetido.
      this.rows.set([
        {
          name: 'id',
          dataType: this.dataTypes()[0] ?? '',
          isNullable: false,
          isPrimaryKey: true,
          isIdentity: true,
          defaultValue: '',
          dropped: false,
        },
      ]);

      return;
    }

    const target = this.target();

    this.original = target.name;
    this.name.set(target.name);

    const columns = await this._store.tableColumns(this.connectionId(), target);

    this.rows.set(columns.map((column) => this.toRow(column)));
  }

  private toRow(column: DatabaseColumn): DesignRow {
    const state = {
      name: column.name,
      dataType: column.dataType,
      isNullable: column.isNullable,
      isPrimaryKey: column.isPrimaryKey,
      // Lo que el motor genera se marca, pero no se puede añadir ni quitar desde
      // aquí: cambiar una identidad exige recrear la columna entera.
      isIdentity: column.isGenerated ?? false,
      defaultValue: column.defaultValue ?? '',
    };

    return { origin: column.name, before: state, ...state, dropped: false };
  }

  /** Lo que se va a pedir al servidor, o `null` si falta algo por rellenar. */
  private design(): TableDesign | TableAlteration | null {
    this.error.set(null);

    const rows = this.rows();

    if (!this.name().trim()) {
      this.error.set('Escribe un nombre para la tabla.');
      return null;
    }

    const live = rows.filter((row) => !row.dropped);

    if (live.some((row) => !row.name.trim() || !row.dataType.trim())) {
      this.error.set('Cada columna necesita un nombre y un tipo.');
      return null;
    }

    if (live.length === 0) {
      this.error.set('La tabla necesita al menos una columna.');
      return null;
    }

    return this.editing() ? this.alteration(rows) : this.creation(live);
  }

  private creation(rows: DesignRow[]): TableDesign {
    const target = this.target();

    return {
      database: target.database,
      // El nodo elegido es el esquema, así que su nombre es dónde va la tabla.
      schema: target.kind === 'schema' ? target.name : target.schema,
      name: this.name().trim(),
      columns: rows.map((row) => this.toColumn(row)),
    };
  }

  private alteration(rows: DesignRow[]): TableAlteration {
    const added: TableColumnDesign[] = [];
    const altered: ColumnAlteration[] = [];
    const dropped: string[] = [];

    for (const row of rows) {
      if (row.dropped && row.origin) {
        dropped.push(row.origin);
        continue;
      }

      if (!row.origin) {
        added.push(this.toColumn(row));
        continue;
      }

      if (this.changed(row)) {
        altered.push({ currentName: row.origin, column: this.toColumn(row) });
      }
    }

    const renamed = this.name().trim() !== this.original;

    return {
      table: this.target(),
      newName: renamed ? this.name().trim() : undefined,
      addedColumns: added,
      alteredColumns: altered,
      droppedColumns: dropped,
    };
  }

  /**
   * Solo viajan las columnas que de verdad cambiaron.
   *
   * Mandarlas todas generaría un `ALTER` por cada una, y en MySQL cada uno
   * reescribe la columna entera: tocar lo que nadie pidió tocar es la forma más
   * fácil de perder algo por el camino.
   */
  private changed(row: DesignRow): boolean {
    const before = row.before;

    if (!before) {
      return true;
    }

    return (
      row.name !== before.name ||
      row.dataType !== before.dataType ||
      row.isNullable !== before.isNullable ||
      row.isPrimaryKey !== before.isPrimaryKey ||
      row.defaultValue !== before.defaultValue
    );
  }

  private toColumn(row: DesignRow): TableColumnDesign {
    return {
      name: row.name.trim(),
      dataType: row.dataType.trim(),
      isNullable: row.isNullable,
      isPrimaryKey: row.isPrimaryKey,
      isIdentity: row.isIdentity,
      defaultValue: row.defaultValue.trim() || undefined,
    };
  }
}
