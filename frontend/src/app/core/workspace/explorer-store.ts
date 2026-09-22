import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import {
  DatabaseObject,
  ExplorerNode,
  KnownColumn,
  KnownRelation,
  SchemaIndex,
} from '../../shared/models/workspace';
import { ConnectionStore } from './connection-store';
import { NoticeStore } from './notice-store';
import { describeError } from './errors';
import { formatNumber } from '../i18n/locale-format';

/** Nodo del árbol con su estado de expansión y sus hijos ya cargados. */
interface TreeEntry {
  readonly object: DatabaseObject;
  readonly connectionId: string;
  readonly depth: number;
  expanded: boolean;
  loading: boolean;
  children: TreeEntry[] | null;
}

/**
 * Qué hacer cuando el árbol descubre que una sesión ya no existe.
 *
 * Devuelve `true` si el fallo era eso y ya se contó. Lo instala el área de
 * trabajo al arrancar y no se resuelve aquí a propósito: perder una sesión
 * también deja una conexión que marcar, una transacción que olvidar y un aviso
 * que dar, y esas tres cosas no son del explorador. Si esta pieza llamara a
 * quien sí las conoce, las dos se necesitarían la una a la otra.
 */
export type SessionLossHandler = (connectionId: string, error: unknown) => boolean;

/**
 * El árbol del explorador y el catálogo que alimenta al editor.
 *
 * Salió de `WorkspaceStore` con el plan de mejoras (FE-001/FE-002), y era el
 * bloque más grande: las raíces por conexión, los hijos que se piden una sola
 * vez, las columnas con su tipo y el precalentado que hace que el
 * autocompletado sepa las tablas sin que nadie pasee por el árbol.
 *
 * Los nodos se **mutan en su sitio** —expandir uno no reconstruye el árbol
 * entero— y por eso la señal se avisa a mano con {@link refreshTree}. Es una
 * decisión vieja que se conserva tal cual: con catálogos de cientos de tablas,
 * rehacer el árbol en cada expansión se nota.
 */
@Injectable({ providedIn: 'root' })
export class ExplorerStore {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _connections = inject(ConnectionStore);
  private readonly _notices = inject(NoticeStore);

  /** Lo instala el área de trabajo; hasta entonces, un fallo es solo un fallo. */
  private _onSessionLost: SessionLossHandler = () => false;

  /**
   * Dice quién se ocupa de una sesión perdida.
   *
   * Lo llama el área de trabajo al construirse. Sin esto, el árbol trataría la
   * conexión caída como un error cualquiera y el usuario vería el mensaje
   * genérico en vez del que trae «Reconectar».
   */
  reportSessionLossWith(handler: SessionLossHandler): void {
    this._onSessionLost = handler;
  }

  /** Árbol por conexión, en forma de raíces con hijos perezosos. */
  private readonly _roots = signal<readonly TreeEntry[]>([]);

  /**
   * Tira el árbol y el catálogo de una conexión.
   *
   * Lo llama el área de trabajo cuando la sesión deja de existir —se perdió, se
   * cerró, se reconectó—: lo que había cargado salió de una sesión que ya no
   * responde, y enseñarlo sería ofrecer un catálogo que nadie puede consultar.
   */
  forget(connectionId: string): void {
    this.forgetPrimed(connectionId);
    this._roots.update((roots) => roots.filter((root) => root.connectionId !== connectionId));
  }

  /** Árbol aplanado, listo para pintar. */
  readonly nodes = computed<readonly ExplorerNode[]>(() => {
    const nodes: ExplorerNode[] = [];

    const walk = (entries: readonly TreeEntry[]): void => {
      for (const entry of entries) {
        nodes.push(toExplorerNode(entry));

        if (entry.expanded && entry.children) {
          walk(entry.children);
        }
      }
    };

    walk(this._roots());

    return nodes;
  });

  /**
   * Columnas con su tipo, por tabla calificada.
   *
   * Vive aparte del árbol porque el editor necesita nulabilidad y clave primaria,
   * además del tipo que también se muestra en el explorador.
   */
  private readonly _columns = signal<ReadonlyMap<string, readonly KnownColumn[]>>(new Map());

  /**
   * Lo que el editor sabe del catálogo: esquemas y relaciones con sus columnas.
   *
   * Recibe sobre qué conexión y qué base se está trabajando en vez de deducirlo:
   * eso lo sabe el área de trabajo, y pedírselo aquí obligaría a que esta pieza
   * conociera las pestañas. Se llama desde un `computed`, así que las señales que
   * lee dentro siguen siendo las que lo recalculan.
   */
  buildSchemaIndex(
    connectionId: string | undefined,
    activeDatabase: string | null | undefined,
  ): SchemaIndex {
    const schemas = new Set<string>();
    const relations: KnownRelation[] = [];
    const database = activeDatabase?.toLowerCase();

    const walk = (entries: readonly TreeEntry[]): void => {
      for (const entry of entries) {
        if (connectionId && entry.connectionId !== connectionId) {
          continue;
        }

        const { object } = entry;

        if (database) {
          const entryDatabase = object.kind === 'database' ? object.name : object.database;

          if (entryDatabase?.toLowerCase() !== database) {
            continue;
          }
        }

        if (object.kind === 'schema') {
          schemas.add(object.name);
        }

        if (object.kind === 'table' || object.kind === 'view') {
          relations.push({
            schema: object.schema ?? '',
            connectionId: entry.connectionId,
            connectionName: this._connections.find(entry.connectionId)?.name,
            database: object.database,
            name: object.name,
            kind: object.kind,
            qualified: object.schema ? `${object.schema}.${object.name}` : object.name,
            columns:
              this._columns().get(
                columnKey(entry.connectionId, object.database, object.schema, object.name),
              ) ?? [],
          });
        }

        if (entry.children) {
          walk(entry.children);
        }
      }
    };

    walk(this._roots());

    return { schemas: [...schemas], relations };
  }

  /** Columnas conocidas de una tabla, vacías si nadie las ha pedido todavía. */
  columnsFor(
    connectionId: string,
    database: string | undefined,
    schema: string | undefined,
    name: string,
  ): readonly KnownColumn[] {
    return this._columns().get(columnKey(connectionId, database, schema, name)) ?? [];
  }

  /**
   * Todo el árbol cargado, con las ramas plegadas dentro.
   *
   * Es lo que mira el buscador del explorador, y no {@link explorerNodes}: una
   * tabla que ya está en memoria pero cuelga de un esquema plegado tiene que
   * poder encontrarse, porque buscarla es justo lo que se hace en vez de ir
   * abriendo carpetas.
   */
  readonly catalogNodes = computed<readonly ExplorerNode[]>(() => {
    const nodes: ExplorerNode[] = [];

    const walk = (entries: readonly TreeEntry[]): void => {
      for (const entry of entries) {
        nodes.push(toExplorerNode(entry));

        if (entry.children) {
          walk(entry.children);
        }
      }
    };

    walk(this._roots());

    return nodes;
  });

  /** Relaciones cargadas, aunque su rama del árbol esté plegada. */
  readonly searchableRelations = computed<readonly ExplorerNode[]>(() =>
    this.catalogNodes().filter((node) => node.kind === 'table' || node.kind === 'view'),
  );

  /** Esquemas conocidos, aunque sus tablas todavía no se hayan cargado. */
  readonly searchableSchemas = computed<readonly ExplorerNode[]>(() =>
    this.catalogNodes().filter((node) => node.kind === 'schema'),
  );

  /**
   * Bases de una conexión, tal y como las trajo el explorador al abrirla.
   *
   * Salen del árbol y no de otra consulta: ya se piden al conectar, y volver a
   * preguntarlas para llenar un desplegable sería trabajo repetido.
   */
  databasesFor(connectionId: string): readonly string[] {
    return this._roots()
      .filter((root) => root.connectionId === connectionId && root.object.kind === 'database')
      .map((root) => root.object.name);
  }

  /** Vuelve a pedir el nodo de una tabla, para que su recuento no mienta. */
  async refreshRelationNode(table: DatabaseObject, connectionId?: string): Promise<void> {
    const entry = this.findRelationEntry(
      table.schema ?? null,
      table.name,
      connectionId,
      table.database,
    );

    if (entry?.children !== null && entry !== null) {
      entry.children = null;
      await this.loadChildren(entry, true);
      this.refreshTree();
    }
  }

  // --- Explorador ------------------------------------------------------------

  /** Pliega o despliega un nodo, cargando sus hijos la primera vez. */
  async toggleNode(nodeId: string): Promise<void> {
    const entry = this.findEntry(nodeId);

    if (!entry || !entry.object.hasChildren) {
      return;
    }

    if (entry.expanded) {
      entry.expanded = false;
      this.refreshTree();
      return;
    }

    entry.expanded = true;

    // Los hijos se piden una sola vez; para volver a leerlos hay que actualizar
    // el nodo explícitamente.
    if (entry.children === null) {
      await this.loadChildren(entry);
    }

    this.refreshTree();
  }

  /**
   * Carga las columnas de una tabla o vista si todavía no se conocen.
   *
   * El autocompletado se alimenta del árbol ya cargado, y eso deja fuera el caso
   * más común en una base grande: nadie va a expandir cientos de tablas en el
   * explorador para que el editor sepa sus columnas. Con esto, pedir sugerencias
   * sobre una tabla la carga **una vez**, y a partir de ahí sale del árbol como
   * cualquier otra.
   *
   * Sigue sin consultarse el catálogo en cada pulsación: solo la primera vez que
   * se pregunta por una tabla concreta.
   */
  async ensureColumnsAsync(
    schema: string | null,
    name: string,
    connectionId?: string,
    database?: string,
  ): Promise<readonly KnownColumn[]> {
    const entry = this.findRelationEntry(schema, name, connectionId, database);

    if (!entry) {
      return [];
    }

    if (entry.children === null) {
      await this.loadChildren(entry, true);
    }

    return (
      this._columns().get(
        columnKey(
          entry.connectionId,
          entry.object.database,
          entry.object.schema,
          entry.object.name,
        ),
      ) ?? []
    );
  }

  /**
   * Carga las tablas y vistas de un esquema si todavía no se conocen.
   *
   * Es la salida para las bases que superan el tope del precalentado: escribir
   * `esquema.` trae ese esquema y solo ese.
   */
  async ensureRelationsAsync(
    schemaName: string,
    connectionId?: string,
    database?: string,
  ): Promise<void> {
    const wanted = schemaName.toLowerCase();

    const findSchema = (entries: readonly TreeEntry[]): TreeEntry | null => {
      for (const entry of entries) {
        if (connectionId && entry.connectionId !== connectionId) {
          continue;
        }

        if (database && entry.object.database?.toLowerCase() !== database.toLowerCase()) {
          const found = entry.children ? findSchema(entry.children) : null;

          if (found) {
            return found;
          }

          continue;
        }

        if (entry.object.kind === 'schema' && entry.object.name.toLowerCase() === wanted) {
          return entry;
        }

        const found = entry.children ? findSchema(entry.children) : null;

        if (found) {
          return found;
        }
      }

      return null;
    };

    const schema = findSchema(this._roots());

    if (schema) {
      await this.loadSchemaRelationsAsync(schema);
    }
  }

  /** Busca en el árbol la tabla o vista a la que apunta una referencia del SQL. */
  private findRelationEntry(
    schema: string | null,
    name: string,
    connectionId?: string,
    database?: string,
  ): TreeEntry | null {
    const wanted = name.toLowerCase();
    const wantedSchema = schema?.toLowerCase() ?? null;
    let fallback: TreeEntry | null = null;

    const walk = (entries: readonly TreeEntry[]): TreeEntry | null => {
      for (const entry of entries) {
        const { object } = entry;

        if (connectionId && entry.connectionId !== connectionId) {
          continue;
        }

        if (
          (object.kind === 'table' || object.kind === 'view') &&
          object.name.toLowerCase() === wanted &&
          (!database || object.database?.toLowerCase() === database.toLowerCase())
        ) {
          if (!wantedSchema || object.schema?.toLowerCase() === wantedSchema) {
            return entry;
          }

          // Sin esquema que la distinga, vale la primera; con él manda el esquema.
          fallback ??= entry;
        }

        const found = entry.children ? walk(entry.children) : null;

        if (found) {
          return found;
        }
      }

      return null;
    };

    return walk(this._roots()) ?? fallback;
  }

  /** Vuelve a pedir los hijos de un nodo, descartando lo que ya tenía. */
  async refreshNode(nodeId: string): Promise<void> {
    const entry = this.findEntry(nodeId);

    if (!entry) {
      return;
    }

    entry.children = null;
    entry.expanded = true;

    await this.loadChildren(entry);
    this.refreshTree();
  }

  /**
   * Trae las bases de una conexión recién abierta y las deja como raíces.
   *
   * La llama el área de trabajo al conectar y al rehacer el árbol tras un cambio
   * de estructura: es ella quien sabe cuándo hay sesión nueva de la que colgar.
   */
  async loadDatabases(connectionId: string, sessionId: string): Promise<void> {
    try {
      const databases = await firstValueFrom(this._gateway.getDatabases(sessionId));

      // Los nodos de antes se van con sus hijos: lo precalentado deja de estar.
      this.forgetPrimed(connectionId);

      this._roots.update((roots) => [
        ...roots.filter((root) => root.connectionId !== connectionId),
        ...databases.map((database) => ({
          object: database,
          connectionId,
          depth: 1,
          expanded: false,
          loading: false,
          children: null,
        })),
      ]);
    } catch (error) {
      this._notices.set(describeError(error));
    }
  }

  private async loadChildren(entry: TreeEntry, quiet = false): Promise<void> {
    const connection = this._connections.find(entry.connectionId);

    if (!connection?.sessionId) {
      return;
    }

    entry.loading = true;
    this.refreshTree();

    try {
      const children = await this.fetchChildren(
        connection.sessionId,
        entry.connectionId,
        entry.object,
      );

      entry.children = children.map((child) => ({
        object: child,
        connectionId: entry.connectionId,
        depth: entry.depth + 1,
        expanded: false,
        loading: false,
        children: null,
      }));
    } catch (error) {
      entry.children = [];

      // Que el árbol falle por una sesión perdida se cuenta siempre, aunque el
      // precalentado fuera silencioso: la conexión entera dejó de servir, y
      // callarlo solo retrasa el momento de enterarse.
      if (this._onSessionLost(entry.connectionId, error)) {
        return;
      }

      // El precalentado no debe interrumpir a nadie: si una parte del catálogo
      // no se puede leer, el autocompletado tendrá menos, y ya está. Cuando el
      // usuario abra ese nodo a mano sí verá el motivo.
      if (!quiet) {
        this._notices.set(describeError(error));
      }
    } finally {
      entry.loading = false;
      this.refreshTree();
    }
  }

  /**
   * Pide los hijos de un nodo.
   *
   * Las tablas y las vistas se piden por `getColumns` en lugar de por el camino
   * genérico: devuelve lo mismo que se ve en el árbol **y además** el tipo, la
   * nulabilidad y la clave primaria de cada columna. Una sola petición sirve
   * así para el explorador y para las ayudas del editor.
   */
  private async fetchChildren(
    sessionId: string,
    connectionId: string,
    parent: DatabaseObject,
  ): Promise<readonly DatabaseObject[]> {
    if (parent.kind !== 'table' && parent.kind !== 'view') {
      return await firstValueFrom(this._gateway.getChildren(sessionId, parent));
    }

    const columns = await firstValueFrom(this._gateway.getColumns(sessionId, parent));

    this._columns.update((current) => {
      const next = new Map(current);
      next.set(
        columnKey(connectionId, parent.database, parent.schema, parent.name),
        columns.map((column) => ({
          name: column.name,
          dataType: column.dataType,
          // Sin esto el compositor pide todo con un campo de texto: la columna
          // sabe que es una fecha, pero esa parte se quedaba por el camino.
          inputKind: column.inputKind,
          isNullable: column.isNullable,
          isPrimaryKey: column.isPrimaryKey,
          isGenerated: column.isGenerated,
          defaultValue: column.defaultValue,
        })),
      );

      return next;
    });

    return columns.map((column) => ({
      id: `column:${parent.schema}.${parent.name}.${column.name}`,
      name: column.name,
      kind: 'column' as const,
      database: parent.database,
      schema: parent.schema,
      dataType: column.dataType,
      hasChildren: false,
    }));
  }

  /**
   * Máximo de esquemas que se precargan al conectar.
   *
   * Un catálogo con decenas de esquemas convertiría el precalentado en una
   * ráfaga de peticiones al abrir la conexión. Pasado el tope, el
   * autocompletado sigue funcionando: los esquemas se ofrecen igual y las
   * tablas de uno concreto se cargan la primera vez que se escribe `esquema.`.
   */
  private static readonly PreloadedSchemaLimit = 20;

  /**
   * Bases cuyo catálogo ya se precalentó, para no repetirlo.
   *
   * La clave lleva **la base**, no solo la conexión. Cuando llevaba solo la
   * conexión, cambiar de base en la misma conexión daba por precalentado un
   * catálogo que era el de la base anterior: el editor se quedaba sin esquemas
   * ni tablas y no había forma de recuperarlo salvo reconectar. Le pasaba lo
   * mismo a la relectura tras un cambio de estructura, que rehace el árbol
   * entero.
   */
  private readonly _primed = new Map<string, Promise<void>>();

  /** El identificador de conexión es un GUID, así que `::` no se confunde. */
  private static primedKey(connectionId: string, database: string): string {
    return `${connectionId}::${database}`;
  }

  /**
   * Olvida lo precalentado de una conexión.
   *
   * Se llama allí donde el árbol de la conexión se vacía o se rehace: lo que
   * había cargado ya no está, así que darlo por hecho dejaría el autocompletado
   * en blanco hasta reconectar.
   */
  private forgetPrimed(connectionId: string): void {
    for (const key of this._primed.keys()) {
      if (key.startsWith(`${connectionId}::`)) {
        this._primed.delete(key);
      }
    }
  }

  /**
   * Carga el catálogo de la base de la sesión sin esperar a que nadie abra el
   * árbol.
   *
   * El autocompletado se alimenta de lo que el explorador tiene cargado, y eso
   * obligaba a pasear por el árbol —base, esquema, carpeta— antes de que el
   * editor supiera una sola tabla. Aquí se hace ese recorrido solo, al conectar
   * y en segundo plano: nadie espera a que termine, y los nodos quedan
   * plegados, solo con sus hijos ya traídos.
   */
  async primeSchemaIndexAsync(connectionId: string, database: string): Promise<void> {
    const key = ExplorerStore.primedKey(connectionId, database);
    const existing = this._primed.get(key);

    if (existing) {
      return existing;
    }

    const databaseEntry = this._roots().find(
      (entry) => entry.connectionId === connectionId && entry.object.name === database,
    );

    // Sin nodo no hay nada que recorrer, y darlo por precalentado impediría
    // volver a intentarlo cuando el árbol sí lo tenga.
    if (!databaseEntry) {
      return;
    }

    const priming = (async () => {
      if (databaseEntry.children === null) {
        await this.loadChildren(databaseEntry, true);
      }

      const schemas = (databaseEntry.children ?? []).filter(
        (entry) => entry.object.kind === 'schema',
      );

      for (const schema of schemas.slice(0, ExplorerStore.PreloadedSchemaLimit)) {
        await this.loadSchemaRelationsAsync(schema);
      }
    })();

    this._primed.set(key, priming);

    try {
      await priming;
    } catch {
      // Un fallo transitorio se puede volver a intentar. Los detalles ya los
      // registra la carga del nodo cuando corresponde.
      this._primed.delete(key);
    }
  }

  /** Trae las tablas y vistas de un esquema, sin desplegarlo. */
  private async loadSchemaRelationsAsync(schema: TreeEntry): Promise<void> {
    if (schema.children === null) {
      await this.loadChildren(schema, true);
    }

    // Solo tablas y vistas: funciones y procedimientos no aportan nada al
    // autocompletado y duplicarían las peticiones.
    const folders = (schema.children ?? []).filter(
      (entry) => entry.object.kind === 'folder' && /:(tables|views)$/.test(entry.object.id),
    );

    // Una detrás de otra, nunca en paralelo. Al otro lado hay **una sola
    // conexión**, y dos peticiones a la vez la rompen: SQL Server responde que
    // no es compatible con MultipleActiveResultSets. El servidor ahora las pone
    // en cola, pero encolarlas desde aquí es lo honesto: no se gana nada
    // lanzándolas juntas si van a ejecutarse en fila igualmente.
    for (const folder of folders) {
      if (folder.children === null) {
        await this.loadChildren(folder, true);
      }
    }
  }

  private findEntry(nodeId: string): TreeEntry | null {
    const search = (entries: readonly TreeEntry[]): TreeEntry | null => {
      for (const entry of entries) {
        if (nodeKey(entry) === nodeId) {
          return entry;
        }

        const found = entry.children ? search(entry.children) : null;

        if (found) {
          return found;
        }
      }

      return null;
    };

    return search(this._roots());
  }

  /**
   * Fuerza el recálculo del árbol aplanado.
   *
   * Los nodos se mutan en su sitio para no reconstruir el árbol entero en cada
   * expansión; a cambio hay que avisar a la señal explícitamente.
   */
  private refreshTree(): void {
    this._roots.update((roots) => [...roots]);
  }
}

/** Clave de columnas: el mismo nombre puede existir en varias conexiones y bases. */
function columnKey(
  connectionId: string,
  database: string | undefined,
  schema: string | undefined,
  name: string,
): string {
  return [connectionId, database ?? '', schema ?? '', name]
    .map((part) => part.toLowerCase())
    .join('|');
}

function nodeKey(entry: TreeEntry): string {
  return `${entry.connectionId}|${entry.object.database ?? ''}|${entry.object.id}`;
}

function toExplorerNode(entry: TreeEntry): ExplorerNode {
  const { object } = entry;

  return {
    id: nodeKey(entry),
    label: object.name,
    kind: object.kind,
    depth: entry.depth,
    expandable: object.hasChildren,
    expanded: entry.expanded,
    loading: entry.loading,
    badge:
      object.approximateRowCount === undefined
        ? undefined
        : formatNumber(object.approximateRowCount),
    hint: object.kind === 'column' ? object.dataType : undefined,
    source: object,
    connectionId: entry.connectionId,
  };
}
