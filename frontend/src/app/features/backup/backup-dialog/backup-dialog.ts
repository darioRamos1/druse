import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';

import {
  ApplicationGateway,
  BackupDataFormat,
  BackupDataMode,
  BackupLayout,
  BackupRequest,
  BackupTable,
} from '../../../core/application-gateway/application-gateway';
import { DesktopHost } from '../../../core/application-gateway/desktop-host';
import { BackupStore, outcomeLabel } from '../../../core/backup/backup.store';
import { DatabaseObject, ExplorerNode } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { OperationProgress } from '../../../shared/ui/operation-progress/operation-progress';

/** Hasta dónde se baja buscando tablas. Con margen sobre el árbol más hondo. */
const MAX_DEPTH = 6;

/** Los cuatro pasos del asistente, en orden. */
export type BackupStepId = 'what' | 'data' | 'how' | 'review';

/** Una tabla dentro del árbol de selección. */
interface Candidate {
  readonly key: string;
  readonly source: DatabaseObject;
  readonly schema: string;
  readonly rows?: number;
}

/**
 * Arma un respaldo: qué se lleva, con datos o sin ellos, en qué forma y adónde.
 *
 * Cuatro pasos, y **ninguno oculta lo que hará el siguiente**. El de guardar como
 * perfil va al final y no al principio: solo cuando ya está todo elegido se sabe
 * qué se estaría guardando.
 *
 * El caso que justifica la función es «todo sin datos, salvo estas tres tablas»,
 * así que el interruptor general y las anulaciones por tabla conviven en la misma
 * pantalla, y las que se salen de la regla se ven de un vistazo: sin eso, nadie
 * sabe qué va a obtener.
 */
@Component({
  selector: 'app-backup-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, OperationProgress],
  templateUrl: './backup-dialog.html',
  styleUrl: './backup-dialog.scss',
})
export class BackupDialog {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _desktop = inject(DesktopHost);

  protected readonly store = inject(BackupStore);

  /** Nodo desde el que se abrió: una base, un esquema o una tabla. */
  readonly target = input.required<ExplorerNode>();

  readonly sessionId = input.required<string>();

  readonly closed = output<void>();

  protected readonly step = signal<BackupStepId>('what');
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  /** Tablas que se pueden elegir, ya resueltas contra el catálogo. */
  protected readonly candidates = signal<readonly Candidate[]>([]);

  /** Las marcadas. Empieza con todo lo que colgaba del nodo de origen. */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  protected readonly dataMode = signal<BackupDataMode>('StructureAndData');

  /** Las que se salen del interruptor general. */
  protected readonly overrides = signal<ReadonlyMap<string, BackupDataMode>>(new Map());

  protected readonly layout = signal<BackupLayout>('SingleFile');
  protected readonly dataFormat = signal<BackupDataFormat>('Inserts');
  protected readonly compress = signal(false);
  protected readonly destination = signal('');

  protected readonly outcomeLabel = outcomeLabel;

  constructor() {
    effect(() => {
      const node = this.target();
      const session = this.sessionId();

      void this.load(session, node);
    });
  }

  // --- Paso 1: qué entra ----------------------------------------------------

  /** Esquemas presentes, para poder marcar de golpe. */
  protected readonly schemas = computed(() => [
    ...new Set(this.candidates().map((candidate) => candidate.schema)),
  ]);

  protected tablesOf(schema: string): readonly Candidate[] {
    return this.candidates().filter((candidate) => candidate.schema === schema);
  }

  /**
   * Estado de la casilla de un esquema: marcado, sin marcar o **parcial**.
   *
   * El tercer estado no es un adorno: sin él, un esquema con la mitad de sus
   * tablas marcadas se vería igual que uno vacío.
   */
  protected schemaState(schema: string): 'all' | 'none' | 'some' {
    const tables = this.tablesOf(schema);
    const marked = tables.filter((table) => this.selected().has(table.key)).length;

    if (marked === 0) {
      return 'none';
    }

    return marked === tables.length ? 'all' : 'some';
  }

  protected toggleSchema(schema: string): void {
    const tables = this.tablesOf(schema);
    const next = new Set(this.selected());
    const all = this.schemaState(schema) === 'all';

    for (const table of tables) {
      if (all) {
        next.delete(table.key);
      } else {
        next.add(table.key);
      }
    }

    this.selected.set(next);
  }

  protected toggle(key: string): void {
    const next = new Set(this.selected());

    if (!next.delete(key)) {
      next.add(key);
    }

    this.selected.set(next);
  }

  protected isSelected(key: string): boolean {
    return this.selected().has(key);
  }

  protected readonly selectedCount = computed(() => this.selected().size);

  // --- Paso 2: con datos o sin ellos ---------------------------------------

  /** Lo que se lleva una tabla: su anulación si la tiene, o la regla general. */
  protected modeOf(key: string): BackupDataMode {
    return this.overrides().get(key) ?? this.dataMode();
  }

  protected setMode(key: string, mode: BackupDataMode): void {
    const next = new Map(this.overrides());

    if (mode === this.dataMode()) {
      next.delete(key);
    } else {
      next.set(key, mode);
    }

    this.overrides.set(next);
  }

  /**
   * Las que rompen la regla general.
   *
   * La interfaz las señala porque son justo lo que el usuario no recuerda al
   * revisar: «todo sin datos» con tres excepciones sigue siendo tres excepciones.
   */
  protected readonly exceptions = computed(() =>
    [...this.overrides().entries()]
      .filter(([key, mode]) => this.selected().has(key) && mode !== this.dataMode())
      .map(([key, mode]) => ({ key, mode })),
  );

  protected readonly withData = computed(
    () => this.chosen().filter((table) => this.modeOf(table.key) !== 'StructureOnly').length,
  );

  // --- Paso 3: cómo sale ----------------------------------------------------

  /** Los datos en CSV necesitan carpetas: un archivo suelto no los admite. */
  protected readonly outputValid = computed(
    () => this.dataFormat() !== 'Csv' || this.layout() === 'FolderByKind',
  );

  protected setDataFormat(format: BackupDataFormat): void {
    this.dataFormat.set(format);

    // Elegir CSV implica carpetas. Se cambia en vez de dejar una combinación que
    // el servidor va a rechazar después.
    if (format === 'Csv') {
      this.layout.set('FolderByKind');
    }
  }

  protected readonly canChoosePath = computed(() => this._desktop.isDesktop);

  /**
   * Elige el destino con el diálogo del sistema.
   *
   * Fuera del envoltorio no hay selector nativo, así que la ruta se escribe a
   * mano: es lo que ya pasa con el resto de rutas en desarrollo.
   */
  protected async choose(): Promise<void> {
    if (!this._desktop.isDesktop) {
      return;
    }

    const suggested = this.suggestedName();
    const chosen = this.layout() === 'FolderByKind' && !this.compress()
      ? await this._desktop.chooseBackupFolder()
      : await this._desktop.chooseBackupFile(suggested);

    if (chosen) {
      this.destination.set(chosen);
    }
  }

  protected readonly suggestedName = computed(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `respaldo-${this.target().source.database ?? 'base'}-${stamp}`;

    return this.compress() ? `${base}.zip` : `${base}.sql`;
  });

  // --- Paso 4: revisar y lanzar --------------------------------------------

  protected readonly chosen = computed(() =>
    this.candidates().filter((candidate) => this.selected().has(candidate.key)),
  );

  protected readonly request = computed<BackupRequest>(() => ({
    sessionId: this.sessionId(),
    tables: this.chosen().map<BackupTable>((candidate) => ({
      id: candidate.source.id,
      name: candidate.source.name,
      database: candidate.source.database,
      schema: candidate.source.schema,
      approximateRowCount: candidate.rows,
    })),
    dataMode: this.dataMode(),
    dataOverrides: Object.fromEntries(
      [...this.overrides().entries()].filter(([key]) => this.selected().has(key)),
    ),
    layout: this.layout(),
    dataFormat: this.dataFormat(),
    compress: this.compress(),
    destination: this.destination(),
  }));

  protected readonly canRun = computed(
    () => this.selectedCount() > 0 && this.destination().trim().length > 0 && this.outputValid(),
  );

  protected preview(): Promise<void> {
    return this.store.previewBackup(this.request());
  }

  protected run(): Promise<void> {
    return this.store.start(this.request());
  }

  protected cancel(): Promise<void> {
    return this.store.cancel();
  }

  /**
   * Cierra el asistente **sin parar el respaldo**.
   *
   * El trabajo sigue en el proceso local y el indicador de la barra de estado lo
   * cuenta: un respaldo de media hora no puede secuestrar la aplicación.
   */
  protected close(): void {
    this.closed.emit();
  }

  protected dismiss(): void {
    this.store.dismiss();
    this.closed.emit();
  }

  protected async copyReport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.store.report());
    } catch {
      // Sin portapapeles no se puede hacer nada mejor: el texto sigue a la vista
      // para copiarlo a mano.
    }
  }

  protected go(step: BackupStepId): void {
    this.step.set(step);
  }

  // --- Carga de candidatos --------------------------------------------------

  /**
   * Resuelve qué tablas cuelgan del nodo desde el que se abrió.
   *
   * Se recorren las carpetas del esquema en lugar de adivinar cuál es la de
   * tablas: el nombre lo pone cada proveedor, y buscar «Tables» funcionaría hasta
   * el primer motor que lo llame de otra forma.
   */
  private async load(sessionId: string, node: ExplorerNode): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);

    try {
      const tables = await this.tablesUnder(sessionId, node.source);

      const candidates = tables.map<Candidate>((table) => ({
        key: keyOf(table),
        source: table,
        schema: table.schema ?? table.database ?? '',
        rows: table.approximateRowCount,
      }));

      this.candidates.set(candidates);
      this.selected.set(new Set(candidates.map((candidate) => candidate.key)));
    } catch (error) {
      this.loadError.set(
        error instanceof Error ? error.message : 'No se pudieron leer las tablas.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async tablesUnder(
    sessionId: string,
    node: DatabaseObject,
    depth = 0,
  ): Promise<readonly DatabaseObject[]> {
    if (node.kind === 'table') {
      return [node];
    }

    // El árbol más hondo es base → esquema → carpeta → tabla. El tope está para
    // que un catálogo que devuelva un hijo igual a su padre no cuelgue la
    // ventana bajando para siempre.
    if (depth >= MAX_DEPTH) {
      return [];
    }

    const children = await this.children(sessionId, node);
    const found: DatabaseObject[] = [];

    for (const child of children) {
      if (child.kind === 'table') {
        found.push(child);
        continue;
      }

      // Carpetas y esquemas se abren; lo demás —vistas, rutinas— no entra
      // todavía: solo se sabe guionizar una tabla.
      if (child.kind === 'folder' || child.kind === 'schema') {
        found.push(...(await this.tablesUnder(sessionId, child, depth + 1)));
      }
    }

    return found;
  }

  private children(sessionId: string, parent: DatabaseObject): Promise<readonly DatabaseObject[]> {
    return new Promise((resolve, reject) => {
      this._gateway.getChildren(sessionId, parent).subscribe({
        next: (nodes) => resolve(nodes),
        error: (error: unknown) => reject(error),
      });
    });
  }
}

/**
 * Nombre con el que una tabla se identifica dentro de la selección.
 *
 * Es el mismo criterio que usa el servidor: el esquema cuando lo hay y, si no, la
 * base. Sin eso, las anulaciones no encontrarían su tabla.
 */
function keyOf(table: DatabaseObject): string {
  const container = table.schema?.trim() ? table.schema : table.database;

  return container ? `${container}.${table.name}` : table.name;
}
