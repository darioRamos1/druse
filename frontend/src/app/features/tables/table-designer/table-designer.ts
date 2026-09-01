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
  CheckConstraintDesign,
  ColumnAlteration,
  DatabaseColumn,
  DatabaseObject,
  ForeignKeyAction,
  ForeignKeyDesign,
  IndexAlteration,
  IndexCapabilities,
  IndexDesign,
  IndexDirection,
  PrimaryKeyDesign,
  TableAlteration,
  TableColumnDesign,
  TableDesign,
  UniqueConstraintDesign,
} from '../../../shared/models/workspace';

/** Pestañas del diseñador. */
export type DesignerSection = 'columns' | 'indexes' | 'keys' | 'constraints';

/**
 * Un índice dentro del diseñador.
 *
 * Igual que una columna, lleva de dónde viene: sin `origin` no habría forma de
 * distinguir un índice nuevo de otro que ya existía y se ha editado, y esa
 * diferencia decide si se escribe un `CREATE` o un `DROP` seguido de un `CREATE`.
 */
interface IndexRow {
  readonly origin?: string;
  /** Cómo estaba al abrir el diálogo, para mandar solo lo que de verdad cambió. */
  readonly before?: string;
  /** Lo sostiene una restricción: se enseña, pero no se toca desde aquí. */
  readonly locked?: boolean;
  name: string;
  columns: string;
  direction: IndexDirection;
  isUnique: boolean;
  includedColumns: string;
  filter: string;
  method: string;
  dropped: boolean;
}

interface ForeignKeyRow {
  readonly origin?: string;
  name: string;
  columns: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string;
  onDelete: ForeignKeyAction;
  onUpdate: ForeignKeyAction;
  dropped: boolean;
}

interface ConstraintRow {
  readonly origin?: string;
  readonly kind: 'unique' | 'check';
  name: string;
  /** Columnas en las de unicidad; condición en las de comprobación. */
  body: string;
  dropped: boolean;
}

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

  /**
   * Una clave foránea ya escrita, para abrir el diseñador con ella puesta.
   *
   * Es como llega una sugerencia del diagrama: Druse cree que una columna apunta
   * a otra tabla, y aceptarlo **no la crea** —abre este formulario con los
   * campos rellenos, y de ahí sale por la misma previsualización del DDL que
   * todo lo demás—.
   */
  readonly initialForeignKey = input<ForeignKeyDesign | null>(null);

  readonly closed = output<void>();

  /** Está modificando una tabla que ya existe. */
  protected readonly editing = computed(() => this.target().kind === 'table');

  protected readonly name = signal('');
  protected readonly rows = signal<DesignRow[]>([]);
  protected readonly dataTypes = signal<readonly string[]>([]);
  protected readonly openTypeIndex = signal<number | null>(null);
  protected readonly highlightedType = signal(0);

  protected readonly section = signal<DesignerSection>('columns');
  protected readonly indexes = signal<IndexRow[]>([]);
  protected readonly foreignKeys = signal<ForeignKeyRow[]>([]);
  protected readonly constraints = signal<ConstraintRow[]>([]);

  /**
   * Qué admite el motor. Empieza en lo más restrictivo porque el formulario se
   * dibuja antes de que llegue la respuesta.
   */
  protected readonly capabilities = signal<IndexCapabilities>({
    supportsIncludedColumns: false,
    supportsFilter: false,
    supportsSortDirection: true,
    supportsCheckConstraints: true,
    methods: [],
    foreignKeyActions: ['noAction', 'cascade', 'setNull', 'setDefault'],
  });

  /** Clave primaria tal y como está hoy, para saber si hay que soltarla. */
  private currentPrimaryKey: { name: string; columns: readonly string[] } | null = null;

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

  /**
   * Hay algo que no se deshace con otro `ALTER`.
   *
   * Borrar una columna se lleva sus datos; quitar un índice o una restricción no,
   * pero rehacerlo sobre una tabla grande puede tardar y bloquearla, y soltar una
   * restricción deja pasar datos que hoy no entran. Todo eso se confirma aparte.
   */
  protected readonly destructive = computed(
    () =>
      this.rows().some((row) => row.dropped && row.origin) ||
      this.indexes().some((row) => row.origin && (row.dropped || this.indexChanged(row))) ||
      this.foreignKeys().some((row) => row.dropped && row.origin) ||
      this.constraints().some((row) => row.dropped && row.origin) ||
      this.primaryKeyChanged(),
  );

  /** Estructuras que ofrece el motor; vacío significa que no se elige. */
  protected readonly methods = computed(() => this.capabilities().methods);

  protected select(section: DesignerSection): void {
    this.openTypeIndex.set(null);
    this.section.set(section);
  }

  /** Sugerencias del motor, filtradas sin convertirlas en una lista cerrada. */
  protected typeSuggestions(row: DesignRow): readonly string[] {
    const types = this.dataTypes();
    const term = row.dataType.trim().toLowerCase();

    if (!term || types.some((type) => type.toLowerCase() === term)) {
      return types.slice(0, 30);
    }

    return types
      .filter((type) => type.toLowerCase().includes(term))
      .sort((left, right) => {
        const leftStarts = left.toLowerCase().startsWith(term);
        const rightStarts = right.toLowerCase().startsWith(term);

        return leftStarts === rightStarts ? 0 : leftStarts ? -1 : 1;
      })
      .slice(0, 30);
  }

  protected openTypeSuggestions(index: number, row: DesignRow): void {
    const current = row.dataType.trim().toLowerCase();
    const exact = this.typeSuggestions(row).findIndex((type) => type.toLowerCase() === current);

    this.openTypeIndex.set(index);
    this.highlightedType.set(Math.max(0, exact));
  }

  protected onDataTypeInput(event: Event, index: number): void {
    const value = (event.target as HTMLInputElement).value;

    this.rows.update((rows) =>
      rows.map((row, position) => (position === index ? { ...row, dataType: value } : row)),
    );
    this.openTypeIndex.set(index);
    this.highlightedType.set(0);
    this.touched();
  }

  protected closeTypeSuggestions(index: number): void {
    if (this.openTypeIndex() === index) {
      this.openTypeIndex.set(null);
    }
  }

  protected chooseDataType(event: Event, index: number, type: string): void {
    event.preventDefault();
    this.rows.update((rows) =>
      rows.map((row, position) => (position === index ? { ...row, dataType: type } : row)),
    );
    this.openTypeIndex.set(null);
    this.touched();
  }

  protected onDataTypeKeydown(event: KeyboardEvent, index: number, row: DesignRow): void {
    const suggestions = this.typeSuggestions(row);
    const open = this.openTypeIndex() === index;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();

        if (!open) {
          this.openTypeSuggestions(index, row);
        } else {
          this.highlightedType.update((current) =>
            Math.min(current + 1, Math.max(0, suggestions.length - 1)),
          );
        }
        break;
      case 'ArrowUp':
        event.preventDefault();

        if (!open) {
          this.openTypeSuggestions(index, row);
          this.highlightedType.set(Math.max(0, suggestions.length - 1));
        } else {
          this.highlightedType.update((current) => Math.max(0, current - 1));
        }
        break;
      case 'Enter': {
        const selected = suggestions[this.highlightedType()];

        if (open && selected) {
          event.preventDefault();
          this.chooseDataType(event, index, selected);
        }
        break;
      }
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          this.openTypeIndex.set(null);
        }
        break;
    }
  }

  /**
   * Las acciones referenciales, contadas por lo que hacen.
   *
   * «CASCADE» no dice nada a quien no lo haya sufrido; «Borrar también las filas
   * hijas» sí, y es exactamente lo que va a pasar.
   */
  protected actionLabel(action: ForeignKeyAction): string {
    switch (action) {
      case 'cascade':
        return 'Aplicar el mismo cambio a las filas hijas';
      case 'setNull':
        return 'Dejar la columna a nulo';
      case 'setDefault':
        return 'Dejar su valor por defecto';
      default:
        return 'Impedirlo';
    }
  }

  protected addIndex(): void {
    this.indexes.update((rows) => [
      ...rows,
      {
        name: this.suggest('ix'),
        columns: '',
        direction: 'asc',
        isUnique: false,
        includedColumns: '',
        filter: '',
        method: '',
        dropped: false,
      },
    ]);

    this.touched();
  }

  protected addForeignKey(): void {
    this.foreignKeys.update((rows) => [
      ...rows,
      {
        name: this.suggest('fk'),
        columns: '',
        referencedSchema: '',
        referencedTable: '',
        referencedColumns: '',
        onDelete: 'noAction',
        onUpdate: 'noAction',
        dropped: false,
      },
    ]);

    this.touched();
  }

  protected addConstraint(kind: 'unique' | 'check'): void {
    this.constraints.update((rows) => [
      ...rows,
      { kind, name: this.suggest(kind === 'unique' ? 'uq' : 'ck'), body: '', dropped: false },
    ]);

    this.touched();
  }

  /**
   * Quitar algo nuevo lo borra de la lista; quitar algo que ya existe solo lo
   * marca, porque eso es una instrucción que hay que confirmar aparte.
   */
  protected removeIndex(index: number): void {
    this.indexes.update((rows) => this.discard(rows, index));
    this.touched();
  }

  protected removeForeignKey(index: number): void {
    this.foreignKeys.update((rows) => this.discard(rows, index));
    this.touched();
  }

  protected removeConstraint(index: number): void {
    this.constraints.update((rows) => this.discard(rows, index));
    this.touched();
  }

  private discard<T extends { origin?: string; dropped: boolean }>(
    rows: readonly T[],
    index: number,
  ): T[] {
    const row = rows[index];

    if (!row?.origin) {
      return rows.filter((_, position) => position !== index);
    }

    return rows.map((current, position) =>
      position === index ? { ...current, dropped: !current.dropped } : current,
    );
  }

  /** Un nombre de partida que sigue la convención más extendida. */
  private suggest(prefix: string): string {
    const table = this.name().trim() || this.target().name;
    const taken = new Set([
      ...this.indexes().map((row) => row.name),
      ...this.foreignKeys().map((row) => row.name),
      ...this.constraints().map((row) => row.name),
    ]);

    let candidate = `${prefix}_${table}`;
    let suffix = 2;

    while (taken.has(candidate)) {
      candidate = `${prefix}_${table}_${suffix++}`;
    }

    return candidate;
  }

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
    this.openTypeIndex.set(null);
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
    this.capabilities.set(await this._store.tableCapabilities(this.connectionId()));

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

    // La estructura se pide después de las columnas y no a la vez: la conexión
    // no ejecuta dos cosas al mismo tiempo, y lanzarlas en paralelo es
    // exactamente el fallo que se arregló en el precalentado del catálogo.
    const structure = await this._store.tableStructure(this.connectionId(), target);

    if (!structure) {
      return;
    }

    this.currentPrimaryKey = structure.primaryKey
      ? { name: structure.primaryKey.name, columns: structure.primaryKey.columns }
      : null;

    this.indexes.set(
      structure.indexes.map((index) => ({
        origin: index.name,
        before: this.signature(
          index.name,
          index.columns.map((column) => column.name).join(', '),
          index.isUnique,
          index.includedColumns.join(', '),
          index.filter ?? '',
          index.method ?? '',
        ),
        // Un índice que sostiene una clave primaria o una restricción no se
        // borra suelto: los tres motores lo rechazan. Se enseña para que se vea
        // que está, y se quita desde la restricción que lo creó.
        locked: index.isConstraintIndex,
        name: index.name,
        columns: index.columns.map((column) => column.name).join(', '),
        direction: index.columns[0]?.direction ?? 'asc',
        isUnique: index.isUnique,
        includedColumns: index.includedColumns.join(', '),
        filter: index.filter ?? '',
        method: index.method ?? '',
        dropped: false,
      })),
    );

    this.foreignKeys.set(
      structure.foreignKeys.map((key) => ({
        origin: key.name,
        name: key.name,
        columns: key.columns.join(', '),
        referencedSchema: key.referencedSchema ?? '',
        referencedTable: key.referencedTable,
        referencedColumns: key.referencedColumns.join(', '),
        onDelete: key.onDelete,
        onUpdate: key.onUpdate,
        dropped: false,
      })),
    );

    // Una clave que llega ya escrita —una sugerencia del diagrama que alguien
    // aceptó— entra como una fila nueva más, y el formulario se abre por ella:
    // sin esto habría que buscarla entre las pestañas para ver qué se aceptó.
    const suggested = this.initialForeignKey();

    if (suggested !== null) {
      this.foreignKeys.update((rows) => [
        ...rows,
        {
          name: suggested.name,
          columns: suggested.columns.join(', '),
          referencedSchema: suggested.referencedSchema ?? '',
          referencedTable: suggested.referencedTable,
          referencedColumns: suggested.referencedColumns.join(', '),
          onDelete: suggested.onDelete ?? 'noAction',
          onUpdate: suggested.onUpdate ?? 'noAction',
          dropped: false,
        },
      ]);

      this.section.set('keys');
    }

    this.constraints.set([
      ...structure.uniqueConstraints.map(
        (unique): ConstraintRow => ({
          origin: unique.name,
          kind: 'unique',
          name: unique.name,
          body: unique.columns.join(', '),
          dropped: false,
        }),
      ),
      ...structure.checkConstraints.map(
        (check): ConstraintRow => ({
          origin: check.name,
          kind: 'check',
          name: check.name,
          body: check.expression ?? '',
          dropped: false,
        }),
      ),
    ]);
  }

  /** Huella de un índice, para comparar sin recorrer campo por campo. */
  private signature(
    name: string,
    columns: string,
    unique: boolean,
    included: string,
    filter: string,
    method: string,
  ): string {
    return [name, columns, String(unique), included, filter, method].join('');
  }

  private indexChanged(row: IndexRow): boolean {
    if (!row.before) {
      return false;
    }

    return (
      row.before !==
      this.signature(
        row.name.trim(),
        this.list(row.columns).join(', '),
        row.isUnique,
        this.list(row.includedColumns).join(', '),
        row.filter.trim(),
        row.method.trim(),
      )
    );
  }

  /**
   * La clave primaria cambió respecto a lo que hay hoy.
   *
   * Se compara con el orden incluido: en una clave compuesta, `(a, b)` y `(b, a)`
   * no son la misma clave y producen índices distintos.
   */
  private primaryKeyChanged(): boolean {
    if (!this.editing()) {
      return false;
    }

    const wanted = this.rows()
      .filter((row) => !row.dropped && row.isPrimaryKey)
      .map((row) => row.name.trim());

    const current = this.currentPrimaryKey?.columns ?? [];

    return (
      wanted.length !== current.length ||
      wanted.some((column, position) => column !== current[position])
    );
  }

  /** Parte una lista escrita a mano, tolerando espacios y comas de más. */
  private list(value: string): string[] {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
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

    const complaint = this.incomplete();

    if (complaint) {
      this.error.set(complaint);
      return null;
    }

    return this.editing() ? this.alteration(rows) : this.creation(live);
  }

  /**
   * Lo que falta por rellenar, en palabras.
   *
   * El servidor volvería a comprobarlo —las reglas viven en el caso de uso, no
   * aquí— pero decirlo antes de la ida y vuelta señala la casilla concreta en vez
   * de devolver una lista de errores al pie del diálogo.
   */
  private incomplete(): string | null {
    for (const row of this.indexes()) {
      if (row.dropped || row.locked) {
        continue;
      }

      if (!row.name.trim()) {
        return 'Cada índice necesita un nombre.';
      }

      if (this.list(row.columns).length === 0) {
        return `El índice «${row.name.trim()}» necesita al menos una columna.`;
      }
    }

    for (const row of this.foreignKeys()) {
      if (row.dropped || row.origin) {
        continue;
      }

      if (!row.name.trim() || !row.referencedTable.trim()) {
        return 'Cada clave foránea necesita un nombre y una tabla a la que apuntar.';
      }

      const columns = this.list(row.columns);
      const referenced = this.list(row.referencedColumns);

      if (columns.length === 0 || referenced.length === 0) {
        return `La clave foránea «${row.name.trim()}» necesita columnas a los dos lados.`;
      }

      // Emparejan por posición, así que distinta cantidad no es un descuido: es
      // una clave que el motor rechazaría sin decir cuál de las dos sobra.
      if (columns.length !== referenced.length) {
        return (
          `La clave foránea «${row.name.trim()}» empareja ${columns.length} columnas ` +
          `con ${referenced.length}: tienen que ser las mismas.`
        );
      }
    }

    for (const row of this.constraints()) {
      if (row.dropped || row.origin) {
        continue;
      }

      if (!row.name.trim() || !row.body.trim()) {
        return row.kind === 'unique'
          ? 'Cada restricción de unicidad necesita un nombre y sus columnas.'
          : 'Cada restricción de comprobación necesita un nombre y una condición.';
      }
    }

    return null;
  }

  private creation(rows: DesignRow[]): TableDesign {
    const target = this.target();

    return {
      database: target.database,
      // El nodo elegido es el esquema, así que su nombre es dónde va la tabla.
      schema: target.kind === 'schema' ? target.name : target.schema,
      name: this.name().trim(),
      columns: rows.map((row) => this.toColumn(row)),
      indexes: this.indexes()
        .filter((row) => !row.dropped)
        .map((row) => this.toIndex(row)),
      foreignKeys: this.foreignKeys()
        .filter((row) => !row.dropped)
        .map((row) => this.toForeignKey(row)),
      uniqueConstraints: this.uniqueDesigns(),
      checkConstraints: this.checkDesigns(),
    };
  }

  private toIndex(row: IndexRow): IndexDesign {
    const supportsDirection = this.capabilities().supportsSortDirection;

    return {
      name: row.name.trim(),
      columns: this.list(row.columns).map((name) => ({
        name,
        direction: supportsDirection ? row.direction : 'asc',
      })),
      isUnique: row.isUnique,
      // Lo que el motor no admite no se manda: el servidor lo rechazaría, y con
      // razón, pero el mensaje sería más difícil de relacionar con la casilla.
      includedColumns: this.capabilities().supportsIncludedColumns
        ? this.list(row.includedColumns)
        : undefined,
      filter: this.capabilities().supportsFilter ? row.filter.trim() || undefined : undefined,
      method: row.method.trim() || undefined,
    };
  }

  private toForeignKey(row: ForeignKeyRow): ForeignKeyDesign {
    return {
      name: row.name.trim(),
      columns: this.list(row.columns),
      referencedSchema: row.referencedSchema.trim() || undefined,
      referencedTable: row.referencedTable.trim(),
      referencedColumns: this.list(row.referencedColumns),
      onDelete: row.onDelete,
      onUpdate: row.onUpdate,
    };
  }

  private uniqueDesigns(): UniqueConstraintDesign[] {
    return this.constraints()
      .filter((row) => row.kind === 'unique' && !row.dropped)
      .map((row) => ({ name: row.name.trim(), columns: this.list(row.body) }));
  }

  private checkDesigns(): CheckConstraintDesign[] {
    return this.constraints()
      .filter((row) => row.kind === 'check' && !row.dropped)
      .map((row) => ({ name: row.name.trim(), expression: row.body.trim() }));
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

    const addedIndexes: IndexDesign[] = [];
    const alteredIndexes: IndexAlteration[] = [];
    const droppedIndexes: string[] = [];

    for (const row of this.indexes()) {
      // Un índice que sostiene una restricción no se toca por su cuenta: sale de
      // aquí y se gestiona desde la restricción que lo creó.
      if (row.locked) {
        continue;
      }

      if (row.dropped && row.origin) {
        droppedIndexes.push(row.origin);
        continue;
      }

      if (!row.origin) {
        addedIndexes.push(this.toIndex(row));
        continue;
      }

      if (this.indexChanged(row)) {
        alteredIndexes.push({ currentName: row.origin, index: this.toIndex(row) });
      }
    }

    const addedForeignKeys: ForeignKeyDesign[] = [];
    const droppedForeignKeys: string[] = [];

    for (const row of this.foreignKeys()) {
      if (row.dropped && row.origin) {
        droppedForeignKeys.push(row.origin);
        continue;
      }

      if (!row.origin) {
        addedForeignKeys.push(this.toForeignKey(row));
      }
    }

    const addedUnique: UniqueConstraintDesign[] = [];
    const addedChecks: CheckConstraintDesign[] = [];
    const droppedUnique: string[] = [];
    const droppedChecks: string[] = [];

    for (const row of this.constraints()) {
      if (row.dropped && row.origin) {
        (row.kind === 'unique' ? droppedUnique : droppedChecks).push(row.origin);
        continue;
      }

      if (row.origin) {
        continue;
      }

      if (row.kind === 'unique') {
        addedUnique.push({ name: row.name.trim(), columns: this.list(row.body) });
      } else {
        addedChecks.push({ name: row.name.trim(), expression: row.body.trim() });
      }
    }

    const primaryKey = this.primaryKey();

    return {
      table: this.target(),
      newName: renamed ? this.name().trim() : undefined,
      addedColumns: added,
      alteredColumns: altered,
      droppedColumns: dropped,
      addedIndexes,
      alteredIndexes,
      droppedIndexes,
      addedForeignKeys,
      droppedForeignKeys,
      addedUniqueConstraints: addedUnique,
      droppedUniqueConstraints: droppedUnique,
      addedCheckConstraints: addedChecks,
      droppedCheckConstraints: droppedChecks,
      newPrimaryKey: primaryKey.next,
      droppedPrimaryKeyName: primaryKey.dropped,
    };
  }

  /**
   * Qué hacer con la clave primaria.
   *
   * Poner una donde ya hay otra son dos operaciones, no una: primero se suelta la
   * que existe —por su nombre, que es lo que el motor pide— y después se pone la
   * nueva. Si no cambió nada, no se manda ninguna de las dos.
   */
  private primaryKey(): { next?: PrimaryKeyDesign; dropped?: string } {
    if (!this.primaryKeyChanged()) {
      return {};
    }

    const columns = this.rows()
      .filter((row) => !row.dropped && row.isPrimaryKey)
      .map((row) => row.name.trim());

    return {
      next: columns.length > 0 ? { columns } : undefined,
      dropped: this.currentPrimaryKey?.name,
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
