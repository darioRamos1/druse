import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject, ExplorerNode, SchemaGraph } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { DiagramCanvas } from '../diagram-canvas/diagram-canvas';

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

  private async load(
    connectionId: string,
    sessionId: string,
    node: DatabaseObject,
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const tables = await this.tablesUnder(sessionId, node);

      if (tables.length === 0) {
        this.graph.set({ tables: [], missing: [] });
        this.error.set('Aquí no hay tablas que dibujar.');
        return;
      }

      if (tables.length > MAX_TABLES) {
        this.error.set(
          `Son ${tables.length} tablas y no se pueden leer más de ${MAX_TABLES} de una vez. ` +
            'Abre el diagrama sobre una tabla y trae sus vecinas desde ahí.',
        );
        return;
      }

      const graph = await this._store.schemaGraph(connectionId, tables);

      if (graph === null) {
        this.error.set('No se pudo leer el catálogo.');
        return;
      }

      this.graph.set(graph);
    } catch (error) {
      this.error.set(
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
