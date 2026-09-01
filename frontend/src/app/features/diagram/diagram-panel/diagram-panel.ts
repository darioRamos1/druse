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

import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  SavedDiagram,
} from '../../../core/application-gateway/application-gateway';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject, ExplorerNode, SchemaGraph } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { DiagramCanvas } from '../diagram-canvas/diagram-canvas';
import { tableKey } from '../diagram-layout';

/**
 * El árbol más hondo es base → esquema → carpeta → tabla. El tope está para que
 * un catálogo que devuelva un hijo igual a su padre no baje para siempre.
 */
const MAX_DEPTH = 4;

/**
 * Tope de tablas por diagrama.
 *
 * El mismo que aplica la API. Aquí sirve para decirlo antes de pedir nada, con
 * el número delante, en vez de dejar que el servidor lo rechace.
 */
const MAX_TABLES = 300;

/**
 * Lo que se guarda de un diagrama.
 *
 * Ni columnas ni tipos: qué esquema o tabla es, qué tablas entran y dónde las
 * dejó el usuario. El resto se relee del catálogo al abrirlo.
 */
interface DiagramModel {
  readonly target: string;
  readonly tables: readonly string[];
  readonly positions?: Record<string, { x: number; y: number }>;
}

/**
 * Lo que envuelve al lienzo: resuelve qué tablas entran y las lee.
 *
 * El lienzo no sabe de sesiones ni de conexiones —recibe un grafo ya leído—, y
 * esa separación es lo que permite probarlo sin servidor.
 */
@Component({
  selector: 'app-diagram-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DiagramCanvas, Icon],
  templateUrl: './diagram-panel.html',
  styleUrl: './diagram-panel.scss',
})
export class DiagramPanel {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _store = inject(WorkspaceStore);

  readonly connectionId = input.required<string>();
  readonly sessionId = input.required<string>();

  /** Esquema o tabla desde donde se pidió el diagrama. */
  readonly target = input.required<ExplorerNode>();

  readonly closed = output<void>();

  /** Alguien quiere abrir una tabla del diagrama en el diseñador. */
  readonly openTable = output<DatabaseObject>();

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly graph = signal<SchemaGraph | null>(null);

  protected readonly title = signal('');

  /**
   * Las tablas que hay debajo del nodo, para elegir cuáles entran.
   *
   * Se pregunta siempre que haya más de una: un esquema entero dibujado de golpe
   * es una tela de araña y una espera, y quien abre el diagrama casi nunca
   * quiere verlo entero. Sobre una tabla suelta no hay nada que preguntar.
   */
  protected readonly candidates = signal<readonly DatabaseObject[]>([]);
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly choosing = signal(false);

  /** Un aviso que no impide seguir mirando el diagrama. */
  protected readonly notice = signal<string | null>(null);

  /** Dónde puso el usuario cada tabla. Es la mitad de lo que se guarda. */
  protected readonly positions = signal<ReadonlyMap<string, { x: number; y: number }>>(new Map());

  /** Hay cambios sin guardar. */
  protected readonly dirty = signal(false);

  /** El diagrama guardado que corresponde a este esquema o tabla, si lo hay. */
  private readonly _saved = signal<SavedDiagram | null>(null);

  /**
   * El esquema entero, cuando ha hecho falta leerlo para saber quién apunta a
   * quién. Se recuerda mientras el diagrama esté abierto.
   */
  private readonly _whole = signal<SchemaGraph | null>(null);

  protected readonly allChosen = computed(
    () => this.candidates().length > 0 && this.chosen().size === this.candidates().length,
  );

  protected readonly someChosen = computed(
    () => this.chosen().size > 0 && !this.allChosen(),
  );

  /** Lo que dice el pie mientras se elige. */
  protected readonly chosenLabel = computed(
    () => `${this.chosen().size} de ${this.candidates().length} tablas elegidas`,
  );

  constructor() {
    effect(() => {
      const target = this.target();
      const connectionId = this.connectionId();
      const sessionId = this.sessionId();

      this.title.set(
        target.source.kind === 'table'
          ? `${target.source.schema ?? ''}.${target.source.name}`.replace(/^\./, '')
          : (target.source.schema ?? target.source.name),
      );

      void this.load(connectionId, sessionId, target.source);
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected retry(): void {
    void this.load(this.connectionId(), this.sessionId(), this.target().source);
  }

  /** Marca o desmarca una tabla de la selección. */
  protected toggle(table: DatabaseObject): void {
    const key = tableKey(table);
    const next = new Set(this.chosen());

    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    this.chosen.set(next);
  }

  protected chooseAll(): void {
    this.chosen.set(new Set(this.candidates().map((table) => tableKey(table))));
  }

  protected chooseNone(): void {
    this.chosen.set(new Set());
  }

  protected isChosen(table: DatabaseObject): boolean {
    return this.chosen().has(tableKey(table));
  }

  /** Vuelve a la selección sin perder lo elegido. */
  protected back(): void {
    this.choosing.set(true);
  }

  protected draw(): void {
    const chosen = this.chosen();

    void this.read(
      this.connectionId(),
      this.candidates().filter((table) => chosen.has(tableKey(table))),
    );
  }

  /**
   * Añade al lienzo las tablas que se relacionan con la elegida, en los dos
   * sentidos.
   *
   * Las que ella apunta salen del grafo dibujado, pero **las que apuntan a ella
   * no**: para saberlas hay que mirar el esquema entero. Se lee una sola vez y
   * se recuerda, porque leerlo cuesta las mismas cuatro consultas que leer dos
   * tablas y así tirar del hilo es instantáneo a partir de la segunda vez.
   */
  protected async bringNeighbours(key: string): Promise<void> {
    const whole = await this.wholeSchema();

    if (whole === null) {
      return;
    }

    const near = new Set<string>([key]);

    for (const detail of whole.tables) {
      const own = tableKey(detail.table);

      for (const foreign of detail.structure.foreignKeys) {
        const target = tableKey({
          schema: foreign.referencedSchema ?? detail.table.schema,
          name: foreign.referencedTable,
        });

        if (own === key) { near.add(target); }
        if (target === key) { near.add(own); }
      }
    }

    const next = new Set(this.chosen());
    let added = 0;

    for (const neighbour of near) {
      if (!next.has(neighbour)) {
        next.add(neighbour);
        added++;
      }
    }

    if (added === 0) {
      this.notice.set('Esa tabla no se relaciona con ninguna otra que no esté ya en el lienzo.');
      return;
    }

    this.notice.set(null);
    this.chosen.set(next);
    this.draw();
  }

  /** Una tabla cambió de sitio: se recuerda para poder guardarlo. */
  protected moved(move: { key: string; x: number; y: number }): void {
    const next = new Map(this.positions());
    next.set(move.key, { x: move.x, y: move.y });

    this.positions.set(next);
    this.dirty.set(true);
  }

  /**
   * Guarda el diagrama: qué tablas entran y dónde están.
   *
   * **Nunca el esquema.** Las columnas y los tipos se releen del catálogo cada
   * vez que se abre, que es lo que evita que un diagrama de hace seis meses siga
   * enseñando una columna borrada.
   */
  protected async save(): Promise<void> {
    const model: DiagramModel = {
      target: this.targetKey(),
      tables: [...this.chosen()],
      positions: Object.fromEntries(this.positions()),
    };

    const existing = this._saved();

    const diagram: SavedDiagram = {
      id: existing?.id ?? crypto.randomUUID(),
      connectionId: this.connectionId(),
      name: this.title(),
      model: JSON.stringify(model),
      createdAtUtc: existing?.createdAtUtc,
    };

    try {
      await firstValueFrom(this._gateway.saveDiagram(diagram));

      this._saved.set(diagram);
      this.dirty.set(false);
      this.notice.set(null);
    } catch {
      this.notice.set('No se pudo guardar el diagrama.');
    }
  }

  /** Hay un diagrama guardado para este esquema o tabla. */
  protected readonly saved = computed(() => this._saved() !== null);

  /**
   * Olvida el diagrama guardado.
   *
   * Sin esto, guardar sería irreversible: el diagrama se abriría siempre como se
   * dejó y no habría forma de volver a elegir desde cero. No borra ninguna
   * tabla, solo el dibujo.
   */
  protected async forget(): Promise<void> {
    const saved = this._saved();

    if (saved === null) {
      return;
    }

    try {
      await firstValueFrom(this._gateway.deleteDiagram(saved.id));

      this._saved.set(null);
      this.positions.set(new Map());
      this.dirty.set(false);
      this.notice.set('Se olvidó el diagrama guardado. Las tablas siguen donde estaban.');
    } catch {
      this.notice.set('No se pudo olvidar el diagrama guardado.');
    }
  }

  /** Lo guardado para este mismo esquema o tabla, si lo hay. */
  private async restore(connectionId: string): Promise<DiagramModel | null> {
    try {
      const saved = await firstValueFrom(this._gateway.getDiagrams(connectionId));
      const target = this.targetKey();

      for (const diagram of saved) {
        const model = JSON.parse(diagram.model) as DiagramModel;

        if (model.target === target) {
          this._saved.set(diagram);

          return model;
        }
      }
    } catch {
      // Que no haya diagramas guardados, o que el archivo local no responda, no
      // impide dibujar: se sigue como la primera vez.
    }

    return null;
  }

  /** Qué esquema o tabla es este diagrama, para reconocer el suyo al abrirlo. */
  private targetKey(): string {
    const source = this.target().source;

    return source.kind === 'table'
      ? `table:${tableKey(source)}`
      : `schema:${source.schema ?? source.name}`;
  }

  /** El grafo del esquema entero, leído una sola vez y recordado. */
  private async wholeSchema(): Promise<SchemaGraph | null> {
    const known = this._whole();

    if (known !== null) {
      return known;
    }

    const candidates = this.candidates();

    if (candidates.length > MAX_TABLES) {
      this.notice.set(
        `El esquema tiene ${candidates.length} tablas y no se pueden leer más de ${MAX_TABLES} ` +
          'de una vez, así que no se puede saber cuáles apuntan a esta.',
      );
      return null;
    }

    this.loading.set(true);

    try {
      const whole = await this._store.schemaGraph(this.connectionId(), candidates);
      this._whole.set(whole);

      return whole;
    } finally {
      this.loading.set(false);
    }
  }

  private async load(
    connectionId: string,
    sessionId: string,
    node: DatabaseObject,
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.graph.set(null);

    try {
      const tables = await this.tablesUnder(sessionId, node);

      this.candidates.set(tables);
      this.chosen.set(new Set(tables.map((table) => tableKey(table))));
      this._whole.set(null);
      this._saved.set(null);
      this.positions.set(new Map());
      this.dirty.set(false);
      this.notice.set(null);

      if (tables.length === 0) {
        this.choosing.set(false);
        this.error.set('Aquí no hay tablas que dibujar.');
        return;
      }

      // Lo guardado manda: si este esquema ya tiene diagrama, se abre como se
      // dejó y no se vuelve a preguntar.
      const model = await this.restore(connectionId);

      if (model !== null) {
        const known = new Set(tables.map((table) => tableKey(table)));

        // Solo se recuperan las tablas que siguen existiendo. Las que no,
        // desaparecen del lienzo, y la lectura del catálogo dirá cuáles faltan.
        this.chosen.set(new Set(model.tables.filter((key) => known.has(key))));
        this.positions.set(new Map(Object.entries(model.positions ?? {})));

        this.choosing.set(false);
        await this.read(connectionId, tables.filter((table) => this.chosen().has(tableKey(table))));
        return;
      }

      // Una sola tabla no se pregunta: se dibuja, y desde ella se traen sus
      // vecinas.
      if (tables.length === 1) {
        this.choosing.set(false);
        await this.read(connectionId, tables);
        return;
      }

      this.choosing.set(true);
    } catch (error) {
      this.choosing.set(false);
      this.error.set(
        error instanceof Error ? error.message : 'No se pudieron leer las tablas.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  /** Lee el catálogo de las tablas elegidas y las dibuja. */
  private async read(
    connectionId: string,
    tables: readonly DatabaseObject[],
  ): Promise<void> {
    if (tables.length === 0) {
      return;
    }

    if (tables.length > MAX_TABLES) {
      this.error.set(
        `Son ${tables.length} tablas y no se pueden leer más de ${MAX_TABLES} de una vez.`,
      );
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.choosing.set(false);

    try {
      const graph = await this._store.schemaGraph(connectionId, tables);

      if (graph === null) {
        this.error.set('No se pudo leer el catálogo.');
        return;
      }

      this.graph.set(graph);
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'No se pudo leer el catálogo.',
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

      // Las vistas no entran: no tienen claves foráneas que dibujar. Están
      // previstas como contexto en gris, y eso llega con la fase del lienzo
      // editable.
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
