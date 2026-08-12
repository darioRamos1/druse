import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  ConnectRequest,
  ExportFormat,
  QueryRejected,
} from '../application-gateway/application-gateway';
import {
  ConnectionForm,
  ConnectionSummary,
  DatabaseObject,
  ExplorerNode,
  QueryHistoryEntry,
  QueryResult,
  KnownRelation,
  QueryTab,
  ResultSet,
  SavedConnection,
  SchemaIndex,
  SecretStoreStatus,
  SessionStatus,
} from '../../shared/models/workspace';

/** Nodo del árbol con su estado de expansión y sus hijos ya cargados. */
interface TreeEntry {
  readonly object: DatabaseObject;
  readonly connectionId: string;
  readonly depth: number;
  expanded: boolean;
  loading: boolean;
  children: TreeEntry[] | null;
}

/** Clave con la que se guarda el tiempo máximo de ejecución. */
const TIMEOUT_PREFERENCE = 'query.timeoutSeconds';

let tabCounter = 1;

/**
 * Estado del área de trabajo: conexiones, explorador, pestañas y resultados.
 *
 * Es el sustituto de los datos simulados de la Fase 1. Vive en un servicio y no
 * en el componente porque ahora hay operaciones asíncronas y varias vistas que
 * comparten el mismo estado.
 *
 * Se apoya en Signals sin NgRx, según la decisión del plan §6: mientras el estado
 * quepa aquí de forma legible, añadir una biblioteca de estado no aporta.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly _gateway = inject(ApplicationGateway);

  // --- Conexiones ------------------------------------------------------------
  private readonly _connections = signal<readonly ConnectionSummary[]>([]);
  readonly connections = this._connections.asReadonly();

  /** Árbol por conexión, en forma de raíces con hijos perezosos. */
  private readonly _roots = signal<readonly TreeEntry[]>([]);

  // --- Pestañas --------------------------------------------------------------
  private readonly _tabs = signal<readonly QueryTab[]>([
    { id: 'q1', title: 'Query 1', active: true, dirty: false, sql: '' },
  ]);
  readonly tabs = this._tabs.asReadonly();

  // --- Ejecución -------------------------------------------------------------
  private readonly _result = signal<QueryResult | null>(null);
  readonly result = this._result.asReadonly();

  private readonly _running = signal(false);
  readonly running = this._running.asReadonly();

  private readonly _currentExecutionId = signal<string | null>(null);

  /** Rechazo pendiente de confirmar por el usuario. */
  private readonly _rejection = signal<QueryRejected | null>(null);
  readonly rejection = this._rejection.asReadonly();

  private readonly _notice = signal<string | null>(null);
  readonly notice = this._notice.asReadonly();

  /**
   * Tiempo máximo de ejecución, en segundos.
   *
   * Se guarda en preferencias: es de las cosas que un usuario ajusta una vez y
   * espera no volver a tocar.
   */
  private readonly _timeoutSeconds = signal(30);
  readonly timeoutSeconds = this._timeoutSeconds.asReadonly();

  /** Muestra un aviso al usuario. */
  notify(message: string): void {
    this._notice.set(message);
  }

  async setTimeout(seconds: number): Promise<void> {
    const clamped = Math.min(3600, Math.max(1, Math.round(seconds)));

    this._timeoutSeconds.set(clamped);

    try {
      await firstValueFrom(this._gateway.setPreference(TIMEOUT_PREFERENCE, String(clamped)));
    } catch {
      // La preferencia no se pudo guardar, pero el valor ya está aplicado en
      // esta sesión: interrumpir al usuario por esto sería desproporcionado.
    }
  }

  /** Carga las preferencias guardadas. */
  async loadPreferences(): Promise<void> {
    try {
      const preferences = await firstValueFrom(this._gateway.getPreferences());
      const stored = Number.parseInt(preferences[TIMEOUT_PREFERENCE] ?? '', 10);

      if (Number.isFinite(stored) && stored > 0) {
        this._timeoutSeconds.set(stored);
      }
    } catch {
      // Se sigue con los valores por defecto.
    }
  }

  /** Quita el indicador de cambios sin guardar de la pestaña activa. */
  markTabSaved(): void {
    this._tabs.update((tabs) => tabs.map((tab) => (tab.active ? { ...tab, dirty: false } : tab)));
  }

  private readonly _exporting = signal(false);
  readonly exporting = this._exporting.asReadonly();

  /**
   * Exporta el resultado de la consulta activa.
   *
   * Se manda el SQL al servidor en lugar de las filas que hay en pantalla: la
   * cuadrícula solo tiene las primeras 500 y quien exporta espera el resultado
   * completo.
   */
  async export(format: ExportFormat, confirmDestructive = false): Promise<void> {
    const connection = this.activeConnection();
    const tab = this.activeTab();
    const sql = (tab?.sql ?? '').trim();

    if (!connection?.sessionId) {
      this._notice.set('No hay ninguna conexión abierta.');
      return;
    }

    if (!sql) {
      this._notice.set('No hay ninguna consulta que exportar.');
      return;
    }

    this._exporting.set(true);
    this._rejection.set(null);

    try {
      const blob = await firstValueFrom(
        this._gateway.exportQuery({
          sessionId: connection.sessionId,
          sql,
          format,
          fileName: tab?.title,
          confirmDestructive,
        }),
      );

      download(blob, `${sanitizeFileName(tab?.title ?? 'druse')}.${format}`);
      this._notice.set(`Exportado a ${format.toUpperCase()}.`);
    } catch (error) {
      const rejection = await asRejectionFromBlob(error);

      if (rejection) {
        this._rejection.set(rejection);
      } else {
        this._notice.set(describeError(error));
      }
    } finally {
      this._exporting.set(false);
    }
  }

  // --- Sesión activa ---------------------------------------------------------
  private readonly _session = signal<SessionStatus | null>(null);
  readonly session = this._session.asReadonly();

  // --- Persistencia ----------------------------------------------------------
  private readonly _secretStore = signal<SecretStoreStatus | null>(null);
  readonly secretStore = this._secretStore.asReadonly();

  private readonly _history = signal<readonly QueryHistoryEntry[]>([]);
  readonly history = this._history.asReadonly();

  /**
   * Carga los perfiles guardados.
   *
   * Se llama al arrancar: sin esto, las conexiones que el usuario guardó en una
   * sesión anterior no aparecerían hasta volver a crearlas.
   */
  async loadSavedConnections(): Promise<void> {
    try {
      const [saved, secretStore] = await Promise.all([
        firstValueFrom(this._gateway.getSavedConnections()),
        firstValueFrom(this._gateway.getSecretStoreStatus()),
      ]);

      this._secretStore.set(secretStore);

      // Los perfiles guardados aparecen desconectados: abrir todas las
      // conexiones al arrancar sería lento y podría despertar servidores que el
      // usuario no pensaba tocar.
      this._connections.update((current) => {
        const live = current.filter((connection) => connection.sessionId);
        const liveIds = new Set(live.map((connection) => connection.id));

        const restored = saved
          .filter((profile) => !liveIds.has(profile.id))
          .map<ConnectionSummary>((profile) => ({
            id: profile.id,
            name: profile.name,
            engine: profile.engine,
            state: 'disconnected',
            expanded: false,
            environment: profile.environment,
            readOnly: profile.readOnly,
            saved: true,
            hasStoredPassword: profile.hasStoredPassword,
            database: profile.database,
          }));

        return [...live, ...restored];
      });
    } catch (error) {
      this._notice.set(describeError(error));
    }
  }

  /** Abre una sesión con un perfil ya guardado. */
  async connectSaved(connectionId: string, password?: string): Promise<boolean> {
    const connection = this.findConnection(connectionId);

    if (!connection) {
      return false;
    }

    this.patchConnection(connectionId, { state: 'connecting', error: undefined });

    try {
      const session = await firstValueFrom(
        this._gateway.openSavedSession(connectionId, password),
      );

      this.patchConnection(connectionId, {
        state: 'connected',
        expanded: true,
        sessionId: session.sessionId,
        error: undefined,
      });

      this._session.set({
        connected: true,
        engine: session.engine,
        engineVersion: describeVersion(session.engine, session.serverVersion),
        database: session.database,
        user: connection.name,
        lastDurationMs: null,
      });

      await this.loadDatabases(connectionId, session.sessionId);

      // Sin `await`: el editor queda usable de inmediato y el catálogo va
      // llegando por detrás.
      void this.primeSchemaIndexAsync(connectionId, session.database);

      return true;
    } catch (error) {
      // 428: la conexión no tiene contraseña guardada y hay que pedirla.
      if (error instanceof HttpErrorResponse && error.status === 428) {
        this.patchConnection(connectionId, { state: 'disconnected' });
        return false;
      }

      this.patchConnection(connectionId, { state: 'error', error: describeError(error) });
      this._notice.set(describeError(error));

      return false;
    }
  }

  /** Borra un perfil guardado y su contraseña. */
  async forget(connectionId: string): Promise<void> {
    // Cierra la sesión si estaba abierta. Para un perfil guardado, `disconnect`
    // lo deja en la lista como desconectado, así que hay que retirarlo después.
    await this.disconnect(connectionId);

    try {
      await firstValueFrom(this._gateway.deleteConnection(connectionId));
    } catch (error) {
      this._notice.set(describeError(error));
      return;
    }

    this._connections.update((connections) =>
      connections.filter((connection) => connection.id !== connectionId),
    );
    this._roots.update((roots) => roots.filter((root) => root.connectionId !== connectionId));
  }

  async loadHistory(search?: string): Promise<void> {
    try {
      this._history.set(await firstValueFrom(this._gateway.getHistory(search)));
    } catch (error) {
      this._notice.set(describeError(error));
    }
  }

  async clearHistory(): Promise<void> {
    try {
      await firstValueFrom(this._gateway.clearHistory());
      this._history.set([]);
    } catch (error) {
      this._notice.set(describeError(error));
    }
  }

  // --- Derivados -------------------------------------------------------------

  readonly activeTab = computed(() => this._tabs().find((tab) => tab.active) ?? null);

  readonly activeConnection = computed(
    () => this._connections().find((connection) => connection.sessionId) ?? null,
  );

  /** Árbol aplanado, listo para pintar. */
  readonly explorerNodes = computed<readonly ExplorerNode[]>(() => {
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

  /** Primer conjunto de resultados, que es el que muestra la cuadrícula. */
  readonly resultSet = computed<ResultSet | null>(
    () => this._result()?.resultSets[0] ?? null,
  );

  /**
   * Lo que el editor sabe del esquema, para el autocompletado.
   *
   * Se construye desde el árbol ya cargado: si el usuario no ha expandido una
   * tabla, sus columnas no se sugieren. Consultar el catálogo en cada pulsación
   * para completar sería mucho peor que sugerir de menos.
   */
  readonly schemaIndex = computed<SchemaIndex>(() => {
    const schemas = new Set<string>();
    const relations: KnownRelation[] = [];

    const walk = (entries: readonly TreeEntry[]): void => {
      for (const entry of entries) {
        const { object } = entry;

        if (object.kind === 'schema') {
          schemas.add(object.name);
        }

        if (object.kind === 'table' || object.kind === 'view') {
          const columns = (entry.children ?? [])
            .filter((child) => child.object.kind === 'column')
            .map((child) => child.object.name);

          relations.push({
            schema: object.schema ?? '',
            name: object.name,
            kind: object.kind,
            qualified: object.schema ? `${object.schema}.${object.name}` : object.name,
            columns,
          });
        }

        if (entry.children) {
          walk(entry.children);
        }
      }
    };

    walk(this._roots());

    return { schemas: [...schemas], relations };
  });

  // --- Conexiones ------------------------------------------------------------

  /**
   * Abre una conexión y carga el primer nivel del explorador.
   *
   * La contraseña se pasa al gateway y no se guarda en ningún sitio: si el
   * usuario cierra y reabre, vuelve a pedirse. El almacén seguro llega en la
   * Fase 3.
   */
  async connect(form: ConnectionForm): Promise<boolean> {
    let id = form.id ?? crypto.randomUUID();

    // Guardar el perfil antes de conectar hace que sobreviva aunque la conexión
    // falle: casi siempre se falla por un dato del propio perfil, y perderlo
    // obligaría a escribirlo todo otra vez.
    if (form.save) {
      const saved = await this.persist(form, id);

      if (saved) {
        id = saved.id;
      }
    }

    this._connections.update((connections) => [
      ...connections.filter((connection) => connection.id !== id),
      {
        id,
        name: form.name || `${form.host}:${form.port}`,
        engine: form.engine,
        state: 'connecting',
        expanded: false,
        environment: form.environment,
        readOnly: form.readOnly,
        saved: form.save,
        hasStoredPassword: form.save && form.storePassword,
        database: form.database,
      },
    ]);

    try {
      const session = await firstValueFrom(this._gateway.openSession(toRequest(form)));

      this.patchConnection(id, {
        state: 'connected',
        expanded: true,
        sessionId: session.sessionId,
        error: undefined,
      });

      this._session.set({
        connected: true,
        engine: form.engine,
        engineVersion: describeVersion(form.engine, session.serverVersion),
        database: session.database,
        user: `${form.username}@${form.host}`,
        lastDurationMs: null,
      });

      await this.loadDatabases(id, session.sessionId);

      // Igual que al abrir un perfil guardado: el catálogo se precalienta por
      // detrás para que el autocompletado no dependa de pasear por el árbol.
      void this.primeSchemaIndexAsync(id, session.database);

      return true;
    } catch (error) {
      this.patchConnection(id, { state: 'error', error: describeError(error) });
      this._notice.set(describeError(error));

      return false;
    }
  }

  /**
   * Cierra la sesión.
   *
   * Un perfil guardado no desaparece de la lista: se queda desconectado, listo
   * para volver a abrirse. Para eliminarlo está {@link forget}.
   */
  async disconnect(connectionId: string): Promise<void> {
    const connection = this.findConnection(connectionId);

    if (connection?.sessionId) {
      try {
        await firstValueFrom(this._gateway.closeSession(connection.sessionId));
      } catch {
        // Si el servidor ya la cerró, el resultado local es el mismo.
      }
    }

    if (connection?.saved) {
      this.patchConnection(connectionId, {
        state: 'disconnected',
        expanded: false,
        sessionId: undefined,
      });
    } else {
      this._connections.update((connections) =>
        connections.filter((item) => item.id !== connectionId),
      );
    }

    this._roots.update((roots) => roots.filter((root) => root.connectionId !== connectionId));

    if (!this._connections().some((item) => item.sessionId)) {
      this._session.set(null);
    }
  }

  /** Guarda el perfil en la base local; la contraseña va al almacén del sistema. */
  private async persist(form: ConnectionForm, id: string): Promise<SavedConnection | null> {
    const request = {
      profile: { ...toRequest(form).profile, id },
      password: form.password,
      storePassword: form.storePassword,
    };

    try {
      return form.id
        ? await firstValueFrom(this._gateway.updateConnection(form.id, request))
        : await firstValueFrom(this._gateway.saveConnection(request));
    } catch (error) {
      this._notice.set(describeError(error));
      return null;
    }
  }

  async testConnection(form: ConnectionForm): Promise<string> {
    try {
      const result = await firstValueFrom(this._gateway.testConnection(toRequest(form)));

      return result.succeeded
        ? `Conexión correcta con ${describeVersion(form.engine, result.serverVersion ?? '')} en ${result.durationMs} ms.`
        : (result.errorMessage ?? 'No se pudo conectar.');
    } catch (error) {
      return describeError(error);
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
  async ensureColumnsAsync(schema: string | null, name: string): Promise<readonly string[]> {
    const entry = this.findRelationEntry(schema, name);

    if (!entry) {
      return [];
    }

    if (entry.children === null) {
      await this.loadChildren(entry);
    }

    return (entry.children ?? [])
      .filter((child) => child.object.kind === 'column')
      .map((child) => child.object.name);
  }

  /**
   * Carga las tablas y vistas de un esquema si todavía no se conocen.
   *
   * Es la salida para las bases que superan el tope del precalentado: escribir
   * `esquema.` trae ese esquema y solo ese.
   */
  async ensureRelationsAsync(schemaName: string): Promise<void> {
    const wanted = schemaName.toLowerCase();

    const findSchema = (entries: readonly TreeEntry[]): TreeEntry | null => {
      for (const entry of entries) {
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
  private findRelationEntry(schema: string | null, name: string): TreeEntry | null {
    const wanted = name.toLowerCase();
    const wantedSchema = schema?.toLowerCase() ?? null;
    let fallback: TreeEntry | null = null;

    const walk = (entries: readonly TreeEntry[]): TreeEntry | null => {
      for (const entry of entries) {
        const { object } = entry;

        if (
          (object.kind === 'table' || object.kind === 'view') &&
          object.name.toLowerCase() === wanted
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

  private async loadDatabases(connectionId: string, sessionId: string): Promise<void> {
    try {
      const databases = await firstValueFrom(this._gateway.getDatabases(sessionId));

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
      this._notice.set(describeError(error));
    }
  }

  private async loadChildren(entry: TreeEntry, quiet = false): Promise<void> {
    const connection = this.findConnection(entry.connectionId);

    if (!connection?.sessionId) {
      return;
    }

    entry.loading = true;
    this.refreshTree();

    try {
      const children = await firstValueFrom(
        this._gateway.getChildren(connection.sessionId, entry.object),
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

      // El precalentado no debe interrumpir a nadie: si una parte del catálogo
      // no se puede leer, el autocompletado tendrá menos, y ya está. Cuando el
      // usuario abra ese nodo a mano sí verá el motivo.
      if (!quiet) {
        this._notice.set(describeError(error));
      }
    } finally {
      entry.loading = false;
      this.refreshTree();
    }
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

  /** Sesiones cuyo catálogo ya se precalentó, para no repetirlo. */
  private readonly _primed = new Set<string>();

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
  private async primeSchemaIndexAsync(connectionId: string, database: string): Promise<void> {
    if (this._primed.has(connectionId)) {
      return;
    }

    this._primed.add(connectionId);

    const databaseEntry = this._roots().find(
      (entry) => entry.connectionId === connectionId && entry.object.name === database,
    );

    if (!databaseEntry) {
      return;
    }

    if (databaseEntry.children === null) {
      await this.loadChildren(databaseEntry, true);
    }

    const schemas = (databaseEntry.children ?? []).filter(
      (entry) => entry.object.kind === 'schema',
    );

    for (const schema of schemas.slice(0, WorkspaceStore.PreloadedSchemaLimit)) {
      await this.loadSchemaRelationsAsync(schema);
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

    await Promise.all(
      folders
        .filter((folder) => folder.children === null)
        .map((folder) => this.loadChildren(folder, true)),
    );
  }

  toggleConnection(connectionId: string): void {
    const connection = this.findConnection(connectionId);

    if (connection) {
      this.patchConnection(connectionId, { expanded: !connection.expanded });
    }
  }

  // --- Pestañas --------------------------------------------------------------

  selectTab(id: string): void {
    this._tabs.update((tabs) => tabs.map((tab) => ({ ...tab, active: tab.id === id })));
  }

  closeTab(id: string): void {
    this._tabs.update((tabs) => {
      const remaining = tabs.filter((tab) => tab.id !== id);

      if (remaining.length > 0 && !remaining.some((tab) => tab.active)) {
        return remaining.map((tab, index) => ({ ...tab, active: index === 0 }));
      }

      return remaining;
    });
  }

  createTab(sql = ''): void {
    tabCounter++;

    this._tabs.update((tabs) => [
      ...tabs.map((tab) => ({ ...tab, active: false })),
      { id: `q${tabCounter}`, title: `Query ${tabCounter}`, active: true, dirty: false, sql },
    ]);
  }

  updateSql(sql: string): void {
    this._tabs.update((tabs) =>
      tabs.map((tab) => (tab.active ? { ...tab, sql, dirty: true } : tab)),
    );
  }

  /** Abre una pestaña con un SELECT sobre la tabla indicada. */
  openSelectFor(node: ExplorerNode): void {
    if (node.kind !== 'table' && node.kind !== 'view') {
      return;
    }

    const qualified = node.source.schema
      ? `${node.source.schema}.${node.source.name}`
      : node.source.name;

    this.createTab(`SELECT *\nFROM ${qualified}\nLIMIT 100;\n`);
  }

  // --- Ejecución -------------------------------------------------------------

  /**
   * Ejecuta el SQL de la pestaña activa.
   *
   * `sqlOverride` sirve para ejecutar solo la selección del editor sin tocar el
   * contenido de la pestaña.
   */
  async execute(sqlOverride?: string, confirmDestructive = false): Promise<void> {
    const connection = this.activeConnection();
    const tab = this.activeTab();

    if (!connection?.sessionId) {
      this._notice.set('No hay ninguna conexión abierta.');
      return;
    }

    const sql = (sqlOverride ?? tab?.sql ?? '').trim();

    if (!sql) {
      this._notice.set('No hay ninguna instrucción que ejecutar.');
      return;
    }

    this._running.set(true);
    this._rejection.set(null);
    this._notice.set(null);

    // El identificador se genera aquí y se envía con la petición: cancelar exige
    // conocerlo mientras la consulta corre, y si lo pusiera el servidor solo
    // llegaría con la respuesta, cuando ya no hay nada que cancelar.
    const executionId = crypto.randomUUID();
    this._currentExecutionId.set(executionId);

    try {
      const result = await firstValueFrom(
        this._gateway.executeQuery({
          sessionId: connection.sessionId,
          executionId,
          sql,
          maxRows: 500,
          timeoutSeconds: this._timeoutSeconds(),
          confirmDestructive,
        }),
      );

      this._result.set(result);

      this._session.update((session) =>
        session ? { ...session, lastDurationMs: result.durationMs } : session,
      );

      if (result.state === 'failed' && result.error) {
        this._notice.set(result.error.message);
      }
    } catch (error) {
      // Un 409 no es un fallo de transporte: es la API pidiendo confirmación.
      const rejection = asRejection(error);

      if (rejection) {
        this._rejection.set(rejection);
      } else {
        this._notice.set(describeError(error));
      }
    } finally {
      this._running.set(false);
      this._currentExecutionId.set(null);
    }
  }

  /** Repite la última ejecución asumiendo el riesgo que la bloqueó. */
  async confirmAndExecute(sqlOverride?: string): Promise<void> {
    this._rejection.set(null);
    await this.execute(sqlOverride, true);
  }

  dismissRejection(): void {
    this._rejection.set(null);
  }

  dismissNotice(): void {
    this._notice.set(null);
  }

  async cancel(): Promise<void> {
    const executionId = this._currentExecutionId();

    if (!executionId) {
      return;
    }

    try {
      await firstValueFrom(this._gateway.cancelQuery(executionId));
    } catch {
      // Si ya había terminado, no hay nada que cancelar.
    }
  }

  // --- Utilidades privadas ---------------------------------------------------

  private findConnection(id: string): ConnectionSummary | undefined {
    return this._connections().find((connection) => connection.id === id);
  }

  private patchConnection(id: string, patch: Partial<ConnectionSummary>): void {
    this._connections.update((connections) =>
      connections.map((connection) =>
        connection.id === id ? { ...connection, ...patch } : connection,
      ),
    );
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

/** Identificador único dentro del árbol: el mismo objeto puede salir en dos conexiones. */
function nodeKey(entry: TreeEntry): string {
  return `${entry.connectionId}|${entry.object.id}`;
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
    badge: object.approximateRowCount?.toLocaleString('es'),
    source: object,
    connectionId: entry.connectionId,
  };
}

function toRequest(form: ConnectionForm): ConnectRequest {
  return {
    profile: {
      name: form.name,
      engine: form.engine,
      host: form.host,
      port: form.port,
      database: form.database,
      username: form.username,
      readOnly: form.readOnly,
    },
    password: form.password,
  };
}

/**
 * Descarga un archivo desde el navegador.
 *
 * Se crea un enlace temporal y se revoca la URL después: sin revocarla, el
 * navegador conserva el archivo en memoria hasta recargar la página, y exportar
 * varias veces iría acumulando copias.
 */
function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

/** Quita del nombre lo que un sistema de archivos no admite. */
function sanitizeFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '').trim();

  return safe.length > 0 ? safe : 'druse';
}

/**
 * Reconoce un rechazo cuando la respuesta se pidió como `blob`.
 *
 * Angular entrega el cuerpo del error también como Blob, así que el JSON con el
 * motivo hay que leerlo del archivo en lugar de encontrarlo ya interpretado.
 */
async function asRejectionFromBlob(error: unknown): Promise<QueryRejected | null> {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }

  if (error.error instanceof Blob) {
    try {
      return JSON.parse(await error.error.text()) as QueryRejected;
    } catch {
      return null;
    }
  }

  return error.error?.reason ? (error.error as QueryRejected) : null;
}

/** Reconoce el 409 con el que la API pide confirmación. */
function asRejection(error: unknown): QueryRejected | null {
  if (error instanceof HttpErrorResponse && error.status === 409 && error.error?.reason) {
    return error.error as QueryRejected;
  }

  return null;
}

/**
 * Traduce un error a algo que se pueda enseñar.
 *
 * Nunca se muestra el objeto de error completo: puede traer cabeceras, cuerpos y
 * rutas internas que no aportan al usuario (plan §12).
 */
function describeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'No se pudo contactar con la API local.';
    }

    const message = error.error?.message;

    return typeof message === 'string' && message.length > 0
      ? message
      : `La API respondió con el código ${error.status}.`;
  }

  return 'Se produjo un error inesperado.';
}

function describeVersion(engine: string, serverVersion: string): string {
  const name =
    engine === 'postgresql' ? 'PostgreSQL' : engine === 'sqlserver' ? 'SQL Server' : 'MySQL';

  // La versión llega como «18.0.0»; en la barra de estado basta la mayor.
  const major = serverVersion.split('.')[0];

  return major ? `${name} ${major}` : name;
}
