import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  ConnectRequest,
  ExportFormat,
  ImportOptions,
  ImportPreview,
  QueryRejected,
  RowDeleteRequest,
  RowEditRequest,
  TransactionState,
} from '../application-gateway/application-gateway';
import { FileSaveService, describeSave } from '../files/file-save.service';
import { I18nService } from '../i18n/i18n.service';
import { ThemeService } from '../theme/theme.service';
import { AUTO_CHECK_PREFERENCE, UpdateService } from '../update/update.service';
import { describeError, diagnosticQuery, isSessionLost } from './errors';
import { ConnectionStore } from './connection-store';
import { ExecutionStore } from './execution-store';
import { ExplorerStore } from './explorer-store';
import { NoticeStore } from './notice-store';
import { TabStore } from './tab-store';
import { TransactionStore } from './transaction-store';
import {
  DEFAULT_FORMAT_SETTINGS,
  FormatSettings,
  formatPreferences,
  parseFormatSettings,
} from './format-settings';
import { ENGINE_NAMES } from '../../shared/ui/engine-badge/engine-badge';
import {
  ConnectionForm,
  ConnectionSummary,
  DatabaseColumn,
  DatabaseEngine,
  DatabaseObject,
  EngineInfo,
  ExplorerNode,
  QueryHistoryEntry,
  CellEdit,
  EditableTable,
  IndexCapabilities,
  QueryResult,
  KnownColumn,
  KnownRelation,
  SavedConnection,
  SchemaIndex,
  SecretStoreStatus,
  SessionStatus,
  TableAlteration,
  TableDesign,
  RoutineSignature,
  SchemaGraph,
  TableStructure,
} from '../../shared/models/workspace';

/**
 * Cómo acabó un intento de volver a abrir una conexión.
 *
 * `needsPassword` no es un fallo: es que el perfil no guarda la contraseña y hay
 * que pedírsela, que es una decisión de la interfaz y no del estado.
 */
export type ReconnectOutcome = 'ok' | 'needsPassword' | 'failed';

/** Clave con la que se guarda el tiempo máximo de ejecución. */
const TIMEOUT_PREFERENCE = 'query.timeoutSeconds';

/** Clave con la que se guarda cuántas filas se traen de cada consulta. */
const ROW_LIMIT_PREFERENCE = 'query.maxRows';

/**
 * Filas que se traen si nadie dice otra cosa.
 *
 * Quinientas caben en pantalla y llegan rápido; quien necesite más lo sube desde
 * la barra, y el proceso local admite hasta cien mil.
 */
const DEFAULT_ROW_LIMIT = 500;

/** Tope del proceso local, que aquí se respeta para no prometer lo que rechazará. */
const MAX_ROW_LIMIT = 100_000;

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
  private readonly _files = inject(FileSaveService);
  private readonly _theme = inject(ThemeService);
  private readonly _i18n = inject(I18nService);
  private readonly _updates = inject(UpdateService);
  private readonly _connectionStore = inject(ConnectionStore);
  private readonly _execution = inject(ExecutionStore);
  private readonly _explorer = inject(ExplorerStore);
  private readonly _notices = inject(NoticeStore);
  private readonly _tabStore = inject(TabStore);
  private readonly _transactions = inject(TransactionStore);

  constructor() {
    // El árbol descubre sesiones perdidas antes que nadie —es lo que más habla
    // con la API—, pero contarlo es de aquí: hay que marcar la conexión, olvidar
    // su transacción y ofrecer «Reconectar».
    this._explorer.reportSessionLossWith((connectionId, error) =>
      this.noteSessionLoss(connectionId, error),
    );
  }

  // --- Conexiones ------------------------------------------------------------
  readonly connections = this._connectionStore.connections;

  // --- Explorador ------------------------------------------------------------

  /** Árbol aplanado, listo para pintar. */
  readonly explorerNodes = this._explorer.nodes;

  /** Todo el árbol cargado, con las ramas plegadas dentro. */
  readonly catalogNodes = this._explorer.catalogNodes;

  readonly searchableRelations = this._explorer.searchableRelations;

  readonly searchableSchemas = this._explorer.searchableSchemas;

  /**
   * Lo que el editor sabe del catálogo, ya recortado a dónde se está trabajando.
   *
   * El recorrido lo hace el explorador; sobre qué conexión y qué base va lo dice
   * este almacén, que es quien conoce la pestaña activa.
   */
  readonly schemaIndex = computed(() =>
    this._explorer.buildSchemaIndex(this.activeConnection()?.id, this.activeDatabase()),
  );

  /** Bases de una conexión, tal y como las trajo el explorador al abrirla. */
  databasesFor(connectionId: string): readonly string[] {
    return this._explorer.databasesFor(connectionId);
  }

  /** Pliega o despliega un nodo, cargando sus hijos la primera vez. */
  async toggleNode(nodeId: string): Promise<void> {
    await this._explorer.toggleNode(nodeId);
  }

  /** Vuelve a pedir los hijos de un nodo, descartando lo que ya tenía. */
  async refreshNode(nodeId: string): Promise<void> {
    await this._explorer.refreshNode(nodeId);
  }

  /** Carga las columnas de una tabla o vista si todavía no se conocen. */
  async ensureColumnsAsync(
    schema: string | null,
    name: string,
    connectionId = this.activeConnection()?.id,
    database = this.activeDatabase() ?? undefined,
  ): Promise<readonly KnownColumn[]> {
    return this._explorer.ensureColumnsAsync(schema, name, connectionId, database);
  }

  /** Carga las tablas y vistas de un esquema si todavía no se conocen. */
  async ensureRelationsAsync(
    schemaName: string,
    connectionId = this.activeConnection()?.id,
    database = this.activeDatabase() ?? undefined,
  ): Promise<void> {
    await this._explorer.ensureRelationsAsync(schemaName, connectionId, database);
  }

  // --- Pestañas --------------------------------------------------------------

  /** Las pestañas abiertas; el estado y su guardado viven en {@link TabStore}. */
  readonly tabs = this._tabStore.tabs;

  // --- Ejecución -------------------------------------------------------------

  /** Lo que hay en la cuadrícula y su estado; vive en {@link ExecutionStore}. */
  readonly result = this._execution.result;

  readonly running = this._execution.running;

  readonly canceling = this._execution.canceling;

  readonly rejection = this._execution.rejection;

  readonly notice = this._notices.notice;

  /** La consulta que enseña lo que el aviso cuenta, si el motor la trajo. */
  readonly noticeQuery = this._notices.query;

  /**
   * Tiempo máximo de ejecución, en segundos.
   *
   * Se guarda en preferencias: es de las cosas que un usuario ajusta una vez y
   * espera no volver a tocar.
   */
  private readonly _timeoutSeconds = signal(30);
  readonly timeoutSeconds = this._timeoutSeconds.asReadonly();

  /**
   * Filas que se traen de cada consulta.
   *
   * Se guarda en preferencias igual que el tiempo máximo, y por lo mismo: quien
   * trabaja con tablas grandes lo sube una vez y no quiere volver a hacerlo en
   * cada arranque. El resultado dice **cuándo se recortó**, así que subirlo es una
   * decisión informada y no a ciegas.
   */
  private readonly _maxRows = signal(DEFAULT_ROW_LIMIT);
  readonly maxRows = this._maxRows.asReadonly();

  /**
   * Cómo formatea el editor.
   *
   * Se guarda igual que el tiempo máximo, y por lo mismo: es una decisión que se
   * toma una vez —o que viene impuesta por el estilo del equipo— y que sería
   * molesto repetir en cada arranque.
   */
  private readonly _formatSettings = signal<FormatSettings>(DEFAULT_FORMAT_SETTINGS);
  readonly formatSettings = this._formatSettings.asReadonly();

  /** Muestra un aviso al usuario. */
  notify(message: string): void {
    this._notices.set(message);
  }

  /**
   * Cambia uno o varios ajustes de formateo.
   *
   * Se guarda solo lo que cambió: escribir las cuatro claves en cada clic
   * llenaría de escrituras la base local para no decir nada nuevo.
   */
  async setFormatSettings(changes: Partial<FormatSettings>): Promise<void> {
    const previous = this._formatSettings();
    const next = { ...previous, ...changes };

    this._formatSettings.set(next);

    const before = formatPreferences(previous);
    const after = formatPreferences(next);

    try {
      await Promise.all(
        Object.entries(after)
          .filter(([key, value]) => before[key] !== value)
          .map(([key, value]) => firstValueFrom(this._gateway.setPreference(key, value))),
      );
    } catch {
      // Igual que con el tiempo máximo: el ajuste ya está aplicado en esta
      // sesión, y no poder recordarlo no justifica interrumpir a nadie.
    }
  }

  /**
   * Cambia cuántas filas se traen.
   *
   * Se ajusta al tope del proceso local en lugar de dejar pedir más: prometer
   * doscientas mil y que el servidor devuelva cien mil sería mentir en la barra.
   */
  async setMaxRows(rows: number): Promise<void> {
    const clamped = Math.min(MAX_ROW_LIMIT, Math.max(1, Math.round(rows)));

    this._maxRows.set(clamped);

    try {
      await firstValueFrom(this._gateway.setPreference(ROW_LIMIT_PREFERENCE, String(clamped)));
    } catch {
      // Como con el tiempo máximo: el ajuste ya está aplicado en esta sesión.
    }
  }

  /**
   * Decide si Druse busca actualizaciones al abrirse, y lo recuerda.
   *
   * El guardado vive aquí y no en el servicio de actualización porque a aquel lo
   * inyecta la interceptora de HTTP: darle el gateway cerraría un círculo entre
   * el cliente y su propia interceptora. Aquí, en cambio, ya está el resto de
   * preferencias.
   */
  async setAutoUpdateCheck(enabled: boolean): Promise<void> {
    await this._updates.setAutoCheck(enabled);

    try {
      await firstValueFrom(this._gateway.setPreference(AUTO_CHECK_PREFERENCE, String(enabled)));
    } catch {
      // La elección ya vale en esta sesión. No haberla podido guardar significa
      // que en el siguiente arranque se vuelve a preguntar, que es el lado
      // seguro de este error: nunca dar por autorizado lo que no se recordó.
    }
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

  /**
   * Guarda ya lo que estuviera esperando.
   *
   * El retardo del guardado deja una rendija: cerrar justo después de escribir
   * se llevaría lo último. Se llama al perder el foco y al cerrar, que es cuando
   * esa rendija importa.
   */
  flushTabs(): void {
    this._tabStore.flush();
  }

  /** Devuelve las pestañas de la última sesión, con lo que no se llegó a ejecutar. */
  async restoreTabs(): Promise<void> {
    await this._tabStore.restore();
  }

  /**
   * Carga las preferencias guardadas.
   *
   * De aquí sale también el tema, aunque no sea estado del área de trabajo: la
   * lectura es una sola llamada, y hacer otra igual desde el servicio de tema
   * sería pedir dos veces lo mismo en el arranque.
   */
  async loadPreferences(): Promise<void> {
    try {
      const preferences = await firstValueFrom(this._gateway.getPreferences());
      const stored = Number.parseInt(preferences[TIMEOUT_PREFERENCE] ?? '', 10);

      if (Number.isFinite(stored) && stored > 0) {
        this._timeoutSeconds.set(stored);
      }

      const rows = Number.parseInt(preferences[ROW_LIMIT_PREFERENCE] ?? '', 10);

      if (Number.isFinite(rows) && rows > 0) {
        this._maxRows.set(Math.min(MAX_ROW_LIMIT, rows));
      }

      this._formatSettings.set(parseFormatSettings(preferences));
      this._theme.adopt(preferences);
      void this._i18n.adopt(preferences);

      // Y de aquí sale también si Druse puede buscar actualizaciones al abrirse.
      // Tiene que estar leído antes de que el shell arranque el actualizador: si
      // llegara después, la consulta ya habría salido sin permiso.
      this._updates.adopt(preferences);
    } catch {
      // Se sigue con los valores por defecto.
    }
  }

  /** Aplica el resultado de guardar únicamente si el contenido no cambió mientras se escribía. */
  markTabSaved(id: string, sql: string, fileName: string, documentId?: string): void {
    this._tabStore.markSaved(id, sql, fileName, documentId);
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
  async export(
    format: ExportFormat,
    confirmDestructive = false,
    sqlOverride?: string,
  ): Promise<void> {
    const source = this._execution.result() ? this._execution.source() : null;
    const connection = source ? this.findConnection(source.connectionId) : this.activeConnection();
    const tab = this.activeTab();
    const tabId = source?.tabId ?? tab?.id;
    const sql = (sqlOverride ?? source?.sql ?? tab?.sql ?? '').trim();
    const tabSql = tab?.sql;
    const stillCurrent = (): boolean =>
      source
        ? this._execution.source() === source
        : this.activeTab()?.id === tabId && this.activeTab()?.sql === tabSql;

    if (!connection?.sessionId) {
      this._notices.set('No hay ninguna conexión abierta.');
      return;
    }

    if (!sql) {
      this._notices.set('No hay ninguna consulta que exportar.');
      return;
    }

    this._exporting.set(true);
    this._execution.dismissRejection();

    try {
      const blob = await firstValueFrom(
        this._gateway.exportQuery({
          sessionId: connection.sessionId,
          sql,
          database: source?.database ?? tab?.database,
          format,
          fileName: source?.title ?? tab?.title,
          confirmDestructive,
        }),
      );

      if (stillCurrent()) {
        const fileName = `${sanitizeFileName(source?.title ?? tab?.title ?? 'druse')}.${format}`;

        // Se anuncia después de guardar y solo si de verdad se guardó. Antes se
        // daba por hecho, y en la aplicación empaquetada eso significaba decir
        // «Exportado» sin haber escrito nada en ningún sitio.
        const outcome = await this._files.save(fileName, blob);

        if (stillCurrent()) {
          this._notices.set(
            describeSave(outcome, `Exportado a ${format.toUpperCase()}`, 'Exportación cancelada.'),
          );
        }
      }
    } catch (error) {
      const rejection = await asRejectionFromBlob(error);

      if (rejection) {
        if (tab && connection && this.activeTab()?.id === tab.id && stillCurrent()) {
          this._execution.noteRejection({
            value: rejection,
            operation: 'export',
            tabId: tab.id,
            connectionId: connection.id,
            sql,
            format,
          });
        }
      } else {
        // La exportación viaja como blob, así que el cuerpo del error hay que
        // leerlo antes de poder reconocer una sesión perdida.
        const failure = await asHttpErrorFromBlob(error);

        if (!connection || !this.noteSessionLoss(connection.id, failure ?? error)) {
          const message = await describeBlobError(error);

          if (stillCurrent()) {
            this._notices.set(message);
          }
        }
      }
    } finally {
      this._exporting.set(false);
    }
  }

  // --- Sesión activa ---------------------------------------------------------
  readonly session = computed(() => {
    const connectionId = this.activeConnection()?.id;

    return connectionId ? (this._connectionStore.sessionFor(connectionId) ?? null) : null;
  });

  // --- Transacciones manuales ------------------------------------------------

  /**
   * La transacción abierta en la conexión activa, o `null` si va en autocommit.
   *
   * El estado vive en {@link TransactionStore}; aquí solo se elige de cuál de
   * las conexiones se habla, que es lo que este almacén sabe y aquel no.
   */
  readonly transaction = computed(() => {
    const connectionId = this.activeConnection()?.id;
    const state = connectionId ? this._transactions.stateFor(connectionId) : undefined;

    return state?.isOpen ? state : null;
  });

  readonly transactionBusy = this._transactions.busy;

  /** Hay una transacción abierta en esa conexión. */
  hasOpenTransaction(connectionId: string): boolean {
    return this._transactions.hasOpen(connectionId);
  }

  /** Entra en modo manual: a partir de aquí nada se confirma solo. */
  async beginTransaction(): Promise<boolean> {
    return this.runTransaction(
      (sessionId) => this._gateway.beginTransaction(sessionId),
      (state) => {
        const aviso = state.ddlIsReversible
          ? ''
          : ' Crear o modificar tablas no se deshace en este motor, aunque uses «Deshacer».';

        return (
          `Transacción abierta en «${state.connectionName}». ` +
          'Todo lo que ejecutes en esta conexión entra en ella hasta que la confirmes o la deshagas.' +
          aviso
        );
      },
    );
  }

  async commitTransaction(): Promise<boolean> {
    return this.runTransaction(
      (sessionId) => this._gateway.commitTransaction(sessionId),
      (state) => `Cambios confirmados en «${state.connectionName}».`,
    );
  }

  async rollbackTransaction(): Promise<boolean> {
    return this.runTransaction(
      (sessionId) => this._gateway.rollbackTransaction(sessionId),
      (state) => `Cambios deshechos en «${state.connectionName}».`,
    );
  }

  /**
   * Lo común a abrir, confirmar y deshacer: sobre qué sesión va, qué se dice al
   * salir bien y qué se hace cuando falla.
   */
  private async runTransaction(
    operation: (sessionId: string) => Observable<TransactionState>,
    describe: (state: TransactionState) => string,
  ): Promise<boolean> {
    const connection = this.activeConnection();

    if (!connection?.sessionId) {
      this._notices.set('Abre una conexión para poder usar transacciones.');

      return false;
    }

    try {
      const state = await this._transactions.run(connection.id, connection.sessionId, operation);

      this._notices.set(describe(state));

      return true;
    } catch (error) {
      // Sin sesión no hay transacción de la que hablar, y el aviso de la
      // conexión perdida explica mejor lo que pasó.
      if (this.noteSessionLoss(connection.id, error)) {
        return false;
      }

      this._notices.set(describeError(error));

      // El estado local pudo quedarse atrás —otra pestaña la cerró, o se
      // deshizo sola—, así que se vuelve a preguntar en lugar de dejar los
      // botones mintiendo.
      await this._transactions.refresh(connection.id, connection.sessionId);

      return false;
    }
  }

  // --- Persistencia ----------------------------------------------------------
  private readonly _secretStore = signal<SecretStoreStatus | null>(null);
  readonly secretStore = this._secretStore.asReadonly();

  /**
   * Motores que la API dice tener, con lo que cada uno necesita para conectar.
   *
   * **Es la única lista.** El formulario de conexión la tenía escrita a mano y
   * nadie preguntaba a la API, así que la compilación ligera —la que se hace sin
   * Informix— seguía ofreciéndolo y fallaba al conectar. Se pide una vez al
   * arrancar: no cambia mientras el proceso viva.
   */
  private readonly _engines = signal<readonly EngineInfo[]>([]);
  readonly engines = this._engines.asReadonly();

  private readonly _history = signal<readonly QueryHistoryEntry[]>([]);
  readonly history = this._history.asReadonly();

  /**
   * Perfiles guardados, completos.
   *
   * El resumen que se pinta en la barra lateral no basta para volver a abrir el
   * formulario: no lleva el servidor, el cifrado ni el túnel. Aquí se conserva
   * lo que devolvió la API para poder editarlo sin pedirlo otra vez.
   */
  private readonly _savedProfiles = signal<readonly SavedConnection[]>([]);

  /** Perfil guardado con ese identificador, si existe. */
  savedProfile(connectionId: string): SavedConnection | undefined {
    return this._savedProfiles().find((profile) => profile.id === connectionId);
  }

  /**
   * Carga los perfiles guardados.
   *
   * Se llama al arrancar: sin esto, las conexiones que el usuario guardó en una
   * sesión anterior no aparecerían hasta volver a crearlas.
   */
  async loadSavedConnections(): Promise<void> {
    try {
      const [saved, secretStore, engines] = await Promise.all([
        firstValueFrom(this._gateway.getSavedConnections()),
        firstValueFrom(this._gateway.getSecretStoreStatus()),
        firstValueFrom(this._gateway.getEngines()),
      ]);

      this._secretStore.set(secretStore);
      this._engines.set(engines);
      this._savedProfiles.set(saved);

      // Los perfiles guardados aparecen desconectados: abrir todas las
      // conexiones al arrancar sería lento y podría despertar servidores que el
      // usuario no pensaba tocar.
      this._connectionStore.update((current) => {
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
            authentication: profile.authentication ?? 'password',
          }));

        return [...live, ...restored];
      });
    } catch (error) {
      this._notices.set(describeError(error));
    }
  }

  /** Abre una sesión con un perfil ya guardado. */
  async connectSaved(connectionId: string, password?: string): Promise<boolean> {
    return (await this.openSaved(connectionId, password)) === 'ok';
  }

  /**
   * Abre una conexión guardada **diciendo por qué no pudo**, si no pudo.
   *
   * Es lo mismo que `connectSaved`, salvo que distingue «hace falta la
   * contraseña» de «falló»: quien cambia de conexión desde el editor necesita
   * saberlo para abrir el diálogo en vez de enseñar un error.
   */
  async openSaved(connectionId: string, password?: string): Promise<ReconnectOutcome> {
    const connection = this.findConnection(connectionId);

    if (!connection) {
      return 'failed';
    }

    this.patchConnection(connectionId, { state: 'connecting', error: undefined });

    try {
      const session = await firstValueFrom(this._gateway.openSavedSession(connectionId, password));

      this.patchConnection(connectionId, {
        state: 'connected',
        expanded: true,
        sessionId: session.sessionId,
        error: undefined,
      });

      this.setSession(connectionId, {
        connected: true,
        engine: session.engine,
        engineVersion: describeVersion(session.engine, session.serverVersion),
        database: session.database,
        user: connection.name,
        lastDurationMs: null,
      });
      this.activateConnection(connectionId);

      await this._explorer.loadDatabases(connectionId, session.sessionId);

      // Sin `await`: el editor queda usable de inmediato y el catálogo va
      // llegando por detrás.
      void this._explorer.primeSchemaIndexAsync(connectionId, session.database);

      return 'ok';
    } catch (error) {
      // 428: la conexión no tiene contraseña guardada y hay que pedirla.
      if (error instanceof HttpErrorResponse && error.status === 428) {
        this.patchConnection(connectionId, { state: 'disconnected' });
        return 'needsPassword';
      }

      this.patchConnection(connectionId, { state: 'error', error: describeError(error) });
      this._notices.set(describeError(error));

      return 'failed';
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
      this._notices.set(describeError(error));
      return;
    }

    this._connectionStore.update((connections) =>
      connections.filter((connection) => connection.id !== connectionId),
    );
    this._explorer.forget(connectionId);
  }

  async loadHistory(search?: string): Promise<void> {
    try {
      this._history.set(await firstValueFrom(this._gateway.getHistory(search)));
    } catch (error) {
      this._notices.set(describeError(error));
    }
  }

  async clearHistory(): Promise<void> {
    try {
      await firstValueFrom(this._gateway.clearHistory());
      this._history.set([]);
    } catch (error) {
      this._notices.set(describeError(error));
    }
  }

  // --- Derivados -------------------------------------------------------------

  readonly activeTab = this._tabStore.active;

  /**
   * La conexión que perdió su sesión, si hay alguna.
   *
   * Sirve para poner «Reconectar» en el aviso: quien acaba de leer que se cayó
   * la conexión no debería tener que buscar dónde se arregla.
   */
  readonly lostConnection = this._connectionStore.lost;

  /** Base contra la que ejecuta la pestaña activa. */
  readonly activeDatabase = computed(() => {
    const tab = this.activeTab();

    return tab?.database ?? this.session()?.database ?? null;
  });

  /**
   * Cambia la base de la pestaña activa.
   *
   * Es lo que evita abrir un script por base: la misma consulta se ejecuta
   * contra otra base de **la misma conexión**, que es como se trabaja cuando un
   * servidor tiene la de producción y la de pruebas una al lado de la otra.
   *
   * El resultado en pantalla se retira: salió de la base anterior, y dejarlo
   * mientras la barra dice otra cosa es la clase de detalle que lleva a leer mal
   * unas filas.
   */
  useDatabase(database: string): void {
    const tab = this.activeTab();

    if (!tab || tab.database === database) {
      return;
    }

    this._tabStore.update((tabs) =>
      tabs.map((item) =>
        item.id === tab.id
          ? // La procedencia editable también era de la base anterior: esas filas
            // no se pueden escribir desde aquí.
            { ...item, database, sourceTable: undefined }
          : item,
      ),
    );

    if (this._execution.source()?.tabId === tab.id) {
      this.clearDisplayedResult();
    }

    const connectionId = this.activeConnection()?.id;

    if (!connectionId) {
      return;
    }

    // Una consulta contra otra base va por otra conexión, así que **no entra en
    // la transacción abierta**. Es cómo funciona una transacción y no algo que
    // Druse pueda arreglar, pero callarlo dejaría creer que esos cambios se
    // pueden deshacer con Rollback.
    if (this.hasOpenTransaction(connectionId)) {
      this._notices.set(
        `Lo que ejecutes contra «${database}» no entra en la transacción abierta: ` +
          'va por otra conexión y se confirma solo.',
      );
    }

    // El autocompletado de la base nueva no está cargado todavía; se pide por
    // detrás para que escribir no tenga que esperar al catálogo.
    void this._explorer.primeSchemaIndexAsync(connectionId, database);
  }

  /**
   * Cambia la conexión contra la que ejecuta la pestaña activa.
   *
   * Es el caso de todos los días: la misma consulta, primero en desarrollo y
   * después en preproducción. Antes había que abrir otra pestaña en la otra
   * conexión y pegar el SQL, con lo que eso tiene de acabar ejecutando en el
   * sitio equivocado.
   *
   * Si la conexión elegida no está abierta **se abre aquí**, y si necesita
   * contraseña se dice para que la pida quien tiene el diálogo.
   */
  async useConnection(connectionId: string): Promise<ReconnectOutcome> {
    const connection = this.findConnection(connectionId);

    if (!connection) {
      return 'failed';
    }

    // La pestaña que pidió el cambio se captura antes de abrir una conexión: esa
    // apertura puede tardar y el usuario podría cambiar de pestaña mientras.
    const tab = this.activeTab();
    const previous = this.activeConnection()?.id;

    if (previous === connectionId) {
      return 'ok';
    }

    if (!connection.sessionId) {
      const outcome = await this.openSaved(connectionId);

      if (outcome !== 'ok') {
        return outcome;
      }
    }

    const database = this._connectionStore.sessionFor(connectionId)?.database;

    this._connectionStore.activate(connectionId);

    if (tab) {
      // La base y la procedencia editable eran de la conexión anterior: aquí no
      // significan nada, y arrastrarlas es cómo se acaba escribiendo en la tabla
      // de otro servidor.
      this._tabStore.update((tabs) =>
        tabs.map((item) =>
          item.id === tab.id ? { ...item, connectionId, database, sourceTable: undefined } : item,
        ),
      );
    }

    // El resultado en pantalla salió del servidor anterior. Se retira mire lo que
    // mire: unas filas de desarrollo bajo una barra que ya dice «preproducción»
    // son la clase de detalle que lleva a tomar una decisión al revés.
    const source = this._execution.source();

    if (source && (source.connectionId === previous || source.tabId === tab?.id)) {
      this.clearDisplayedResult();
    }

    // Una transacción es de su conexión, así que sigue abierta donde estaba. Se
    // dice porque desde aquí ya no se ve, y una transacción olvidada retiene
    // bloqueos hasta que alguien se acuerda.
    if (previous && this.hasOpenTransaction(previous)) {
      const before = this.findConnection(previous)?.name ?? 'la conexión anterior';

      this._notices.set(
        `La transacción abierta en «${before}» sigue ahí: es de esa conexión y no ` +
          'se cierra al cambiar de pestaña.',
      );
    }

    if (database) {
      // `openSaved` puede haber iniciado ya el recorrido. Se espera esa misma
      // promesa: devolver antes dejaba el switch hecho pero el editor sin tablas.
      await this._explorer.primeSchemaIndexAsync(connectionId, database);
    }

    return 'ok';
  }

  readonly activeConnection = computed(() => {
    return this._connectionStore.resolve(this.activeTab()?.connectionId);
  });

  engineForConnection(connectionId: string): ConnectionSummary['engine'] | null {
    return this.findConnection(connectionId)?.engine ?? null;
  }

  /**
   * Sesión viva de una conexión, o `null` si está desconectada.
   *
   * Lo piden los diálogos que hablan con el catálogo por su cuenta —el asistente
   * de respaldos— y que reciben el nodo del árbol, donde solo viaja la conexión.
   */
  sessionForConnection(connectionId: string): string | null {
    return this.findConnection(connectionId)?.sessionId ?? null;
  }

  /** Primer conjunto de resultados, que es el que muestra la cuadrícula. */
  readonly resultSet = this._execution.resultSet;

  // --- Edición de filas ------------------------------------------------------

  private readonly _edits = signal<readonly CellEdit[]>([]);
  readonly edits = this._edits.asReadonly();

  /** SQL que se va a ejecutar, mientras el usuario decide. */
  private readonly _editPreview = signal<readonly string[] | null>(null);
  readonly editPreview = this._editPreview.asReadonly();

  private readonly _savingEdits = signal(false);
  readonly savingEdits = this._savingEdits.asReadonly();

  /**
   * Sobre qué tabla se puede editar lo que hay en pantalla.
   *
   * Hacen falta tres cosas, y si falta una no se edita: que la pestaña venga de
   * una tabla, que esa tabla tenga clave primaria y que **la clave esté entre
   * las columnas del resultado**. Sin lo tercero se podría ver la fila pero no
   * señalarla, que es justo el caso en que un `UPDATE` alcanza de más.
   */
  readonly editableTable = computed<EditableTable | null>(() => {
    const table = this.activeTab()?.sourceTable;

    if (!table) {
      return null;
    }

    const connectionId = this.activeTab()?.connectionId ?? this.activeConnection()?.id;
    const columns = connectionId
      ? this._explorer.columnsFor(connectionId, table.database, table.schema, table.name)
      : [];
    const keyColumns = columns.filter((column) => column.isPrimaryKey).map((column) => column.name);

    if (keyColumns.length === 0) {
      return null;
    }

    const shown = new Set(
      (this.resultSet()?.columns ?? []).map((column) => column.name.toLowerCase()),
    );

    return keyColumns.every((name) => shown.has(name.toLowerCase())) ? { table, keyColumns } : null;
  });

  /** Anota un cambio sobre una celda. */
  editCell(edit: CellEdit): void {
    this._edits.update((current) => [
      ...current.filter((item) => !(item.row === edit.row && item.column === edit.column)),
      edit,
    ]);
  }

  /** Vuelve del SQL a la lista de cambios, conservándolos. */
  cancelPreview(): void {
    this._editPreview.set(null);
  }

  /** Tira los cambios pendientes sin tocar la base. */
  discardEdits(): void {
    this._edits.set([]);
    this._editPreview.set(null);
  }

  /**
   * Pide el SQL que se ejecutaría y lo deja listo para enseñarlo.
   *
   * Es el paso que no se puede saltar: guardar sin haber visto qué se va a
   * ejecutar es lo que convierte una cuadrícula en una trampa.
   */
  async prepareEdits(): Promise<void> {
    const request = this.buildEditRequest(false);

    if (!request) {
      return;
    }

    try {
      this._editPreview.set(await firstValueFrom(this._gateway.previewRowEdits(request)));
    } catch (error) {
      this._notices.set(describeError(error));
    }
  }

  /** Guarda los cambios y vuelve a ejecutar la consulta para ver el resultado. */
  async saveEdits(): Promise<boolean> {
    const request = this.buildEditRequest(true);

    if (!request) {
      return false;
    }

    this._savingEdits.set(true);

    try {
      const result = await firstValueFrom(this._gateway.applyRowEdits(request));

      this._edits.set([]);
      this._editPreview.set(null);

      // Se relee para que en pantalla quede lo que hay en la base, no lo que se
      // creía haber escrito: valores por defecto y disparadores pueden cambiarlo.
      await this.execute();

      // El aviso va **después** de releer: `execute` limpia el aviso al empezar,
      // así que ponerlo antes equivalía a no ponerlo.
      this._notices.set(
        `${result.rowsAffected} ${result.rowsAffected === 1 ? 'fila guardada' : 'filas guardadas'}.`,
      );

      return true;
    } catch (error) {
      const connectionId = this.activeConnection()?.id;

      if (!connectionId || !this.noteSessionLoss(connectionId, error)) {
        this._notices.set(describeError(error));
      }

      return false;
    } finally {
      this._savingEdits.set(false);
    }
  }

  /**
   * Traduce los cambios a lo que espera la API.
   *
   * La clave de cada fila se toma **del resultado que el usuario tiene delante**,
   * no de lo que escribió: es lo que hace que el `UPDATE` apunte a la fila que se
   * editó y no a otra.
   */
  private buildEditRequest(confirmed: boolean): RowEditRequest | null {
    const editable = this.editableTable();
    const sessionId = this.activeConnection()?.sessionId;
    const resultSet = this.resultSet();
    const edits = this._edits();

    if (!editable || !sessionId || !resultSet || edits.length === 0) {
      return null;
    }

    const indexOf = (name: string) =>
      resultSet.columns.findIndex((column) => column.name.toLowerCase() === name.toLowerCase());

    const porFila = new Map<number, CellEdit[]>();

    for (const edit of edits) {
      porFila.set(edit.row, [...(porFila.get(edit.row) ?? []), edit]);
    }

    const filas = [...porFila.entries()].flatMap(([number, cambios]) => {
      const row = resultSet.rows.find((item) => item.number === number);

      if (!row) {
        return [];
      }

      return [
        {
          key: editable.keyColumns.map((column) => ({
            column,
            value: row.values[indexOf(column)] ?? null,
          })),
          changes: cambios.map((cambio) => ({ column: cambio.column, value: cambio.value })),
        },
      ];
    });

    return { sessionId, table: editable.table, confirmed, edits: filas };
  }

  /**
   * Ejecuta un recuento y devuelve el número, sin tocar la pantalla.
   *
   * No pasa por `execute` a propósito: esto no es lo que el usuario pidió
   * ejecutar, así que no debe cambiar la cuadrícula, ni el historial, ni la
   * pestaña activa. Solo responde una pregunta.
   */
  async countRows(connectionId: string, sql: string): Promise<number | null> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return null;
    }

    try {
      const result = await firstValueFrom(
        this._gateway.executeQuery({ sessionId, sql, maxRows: 1 }),
      );

      const value = result.resultSets[0]?.rows[0]?.values[0];

      return value === null || value === undefined ? null : Number(value);
    } catch (error) {
      this.reportFailure(connectionId, error);
      return null;
    }
  }

  /** Ejecuta hasta diez filas sin reemplazar el resultado principal del editor. */
  async previewQuery(
    connectionId: string,
    database: string | undefined,
    sql: string,
    executionId: string,
  ): Promise<QueryResult | null> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return null;
    }

    try {
      return await firstValueFrom(
        this._gateway.executeQuery({
          sessionId,
          executionId,
          sql,
          database,
          maxRows: 10,
          timeoutSeconds: this._timeoutSeconds(),
        }),
      );
    } catch (error) {
      this.reportFailure(connectionId, error);
      return null;
    }
  }

  /** Cancela una ejecución auxiliar, como la vista previa del compositor. */
  async cancelExecution(executionId: string): Promise<void> {
    await this._execution.cancelExecution(executionId);
  }

  // --- Borrado de filas ------------------------------------------------------

  /** Filas señaladas para borrar, por su número en el resultado. */
  private readonly _selectedRows = signal<readonly number[]>([]);
  readonly selectedRows = this._selectedRows.asReadonly();

  /** El `DELETE` que se ejecutaría, ya escrito, mientras se decide. */
  private readonly _deletePreview = signal<readonly string[] | null>(null);
  readonly deletePreview = this._deletePreview.asReadonly();

  private readonly _deleting = signal(false);
  readonly deleting = this._deleting.asReadonly();

  toggleRowSelection(row: number): void {
    this._selectedRows.update((current) =>
      current.includes(row) ? current.filter((item) => item !== row) : [...current, row],
    );
  }

  clearRowSelection(): void {
    this._selectedRows.set([]);
    this._deletePreview.set(null);
  }

  cancelDeletePreview(): void {
    this._deletePreview.set(null);
  }

  /**
   * Pide el `DELETE` que se ejecutaría y lo deja listo para enseñarlo.
   *
   * Igual que al editar: el paso que no se puede saltar. Con una diferencia, y
   * es que aquí no hay vuelta atrás mirando la pantalla.
   */
  async prepareDelete(): Promise<void> {
    const request = this.buildDeleteRequest(false);

    if (!request) {
      return;
    }

    try {
      this._deletePreview.set(await firstValueFrom(this._gateway.previewRowDeletes(request)));
    } catch (error) {
      this._notices.set(describeError(error));
    }
  }

  /** Borra las filas señaladas y vuelve a ejecutar la consulta. */
  async deleteSelectedRows(): Promise<boolean> {
    const request = this.buildDeleteRequest(true);

    if (!request) {
      return false;
    }

    this._deleting.set(true);

    try {
      const result = await firstValueFrom(this._gateway.deleteRows(request));

      this.clearRowSelection();

      await this.execute();

      // Después de releer, por lo mismo que al guardar: `execute` limpia el
      // aviso al empezar.
      this._notices.set(
        `${result.rowsAffected} ${result.rowsAffected === 1 ? 'fila borrada' : 'filas borradas'}.`,
      );

      return true;
    } catch (error) {
      const connectionId = this.activeConnection()?.id;

      if (!connectionId || !this.noteSessionLoss(connectionId, error)) {
        this._notices.set(describeError(error));
      }

      return false;
    } finally {
      this._deleting.set(false);
    }
  }

  /**
   * Traduce la selección a lo que espera la API.
   *
   * La clave sale del resultado que el usuario tiene delante, como en la
   * edición: es lo que garantiza que se borre la fila señalada y no otra.
   */
  private buildDeleteRequest(confirmed: boolean): RowDeleteRequest | null {
    const editable = this.editableTable();
    const sessionId = this.activeConnection()?.sessionId;
    const resultSet = this.resultSet();
    const selected = this._selectedRows();

    if (!editable || !sessionId || !resultSet || selected.length === 0) {
      return null;
    }

    const indexOf = (name: string) =>
      resultSet.columns.findIndex((column) => column.name.toLowerCase() === name.toLowerCase());

    const keys = selected.flatMap((number) => {
      const row = resultSet.rows.find((item) => item.number === number);

      if (!row) {
        return [];
      }

      return [
        editable.keyColumns.map((column) => ({
          column,
          value: row.values[indexOf(column)] ?? null,
        })),
      ];
    });

    return { sessionId, table: editable.table, confirmed, keys };
  }

  // --- Importación -----------------------------------------------------------

  private readonly _importPreview = signal<ImportPreview | null>(null);
  readonly importPreview = this._importPreview.asReadonly();

  private readonly _importing = signal(false);
  readonly importing = this._importing.asReadonly();

  clearImportPreview(): void {
    this._importPreview.set(null);
  }

  /** Pide qué se insertaría, sin escribir nada. */
  async previewImport(
    table: DatabaseObject,
    file: File,
    options: ImportOptions,
    connectionId?: string,
  ): Promise<void> {
    const sessionId = (connectionId ? this.findConnection(connectionId) : this.activeConnection())
      ?.sessionId;

    if (!sessionId) {
      this._notices.set('No hay ninguna conexión abierta.');
      return;
    }

    this._importing.set(true);

    try {
      this._importPreview.set(
        await firstValueFrom(this._gateway.previewImport(sessionId, table, file, options)),
      );
    } catch (error) {
      this._importPreview.set(null);
      this._notices.set(describeError(error));
    } finally {
      this._importing.set(false);
    }
  }

  /** Importa de verdad. Devuelve si se pudo. */
  async runImport(
    table: DatabaseObject,
    file: File,
    options: ImportOptions,
    connectionId?: string,
  ): Promise<boolean> {
    const sessionId = (connectionId ? this.findConnection(connectionId) : this.activeConnection())
      ?.sessionId;

    if (!sessionId) {
      this._notices.set('No hay ninguna conexión abierta.');
      return false;
    }

    this._importing.set(true);

    try {
      const result = await firstValueFrom(this._gateway.runImport(sessionId, table, file, options));

      this._importPreview.set(null);
      this._notices.set(
        `${result.rowsAffected} ${result.rowsAffected === 1 ? 'fila importada' : 'filas importadas'} en ${table.name}.`,
      );

      // El recuento del árbol se queda viejo en cuanto se insertan filas.
      void this._explorer.refreshRelationNode(table, connectionId);

      return true;
    } catch (error) {
      this._notices.set(describeError(error));
      return false;
    } finally {
      this._importing.set(false);
    }
  }

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

    this._connectionStore.update((connections) => [
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
        authentication: form.authentication,
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

      this.setSession(id, {
        connected: true,
        engine: form.engine,
        engineVersion: describeVersion(form.engine, session.serverVersion),
        database: session.database,
        user: describeUser(form),
        lastDurationMs: null,
      });
      this.activateConnection(id);

      await this._explorer.loadDatabases(id, session.sessionId);

      // Igual que al abrir un perfil guardado: el catálogo se precalienta por
      // detrás para que el autocompletado no dependa de pasear por el árbol.
      void this._explorer.primeSchemaIndexAsync(id, session.database);

      return true;
    } catch (error) {
      this.patchConnection(id, { state: 'error', error: describeError(error) });
      this._notices.set(describeError(error));

      return false;
    }
  }

  /**
   * Anota que una operación falló porque la sesión ya no existe.
   *
   * Se llama desde los sitios donde el usuario lo va a notar —ejecutar, explorar,
   * guardar, exportar—, y no en un interceptor: hace falta saber **de qué
   * conexión** era la sesión, y eso solo lo sabe quien hizo la petición.
   *
   * @returns `true` si el fallo era una sesión perdida y ya se contó.
   */
  private noteSessionLoss(connectionId: string, error: unknown): boolean {
    if (!isSessionLost(error)) {
      return false;
    }

    const connection = this.findConnection(connectionId);

    this.patchConnection(connectionId, {
      state: 'error',
      lost: true,
      sessionId: undefined,
      error: 'La conexión se perdió.',
    });

    // El árbol y la transacción eran de una sesión que ya no existe. Dejarlos
    // sería enseñar un catálogo que nadie puede consultar y una transacción que
    // el servidor ya deshizo al soltar la conexión.
    this._explorer.forget(connectionId);
    this._connectionStore.forgetSession(connectionId);
    this._transactions.forget(connectionId);

    this._notices.set(
      `Se perdió la conexión con «${connection?.name ?? 'la base'}». Vuelve a conectarla para seguir.`,
    );

    return true;
  }

  /**
   * Cuenta un fallo de una operación sobre una conexión.
   *
   * Si fue la sesión lo que se perdió, el aviso lo da {@link noteSessionLoss}
   * con su botón de reconectar; si no, se enseña el mensaje de siempre. Existe
   * para no repetir ese `if` en cada camino que habla con una sesión.
   */
  private reportFailure(connectionId: string, error: unknown): void {
    if (!this.noteSessionLoss(connectionId, error)) {
      // Con el mensaje va la consulta que enseña lo que lo provocó, cuando el
      // proceso local supo escribirla: sin ella, arreglar un rechazo por los
      // datos que ya había empieza por escribir la búsqueda a mano.
      this._notices.set(describeError(error), diagnosticQuery(error));
    }
  }

  /**
   * Vuelve a abrir la sesión de una conexión.
   *
   * Sirve para dos casos que se parecen: la conexión se cayó, o lleva tanto
   * abierta que uno prefiere empezar limpio. En ambos se cierra lo que quede
   * —puede haber una sesión zombi en el proceso local— y se abre otra.
   *
   * **Las pestañas y su SQL no se tocan.** Lo que se pierde es lo que ya estaba
   * perdido: el resultado en pantalla, que vino de una sesión que ya no existe,
   * y cualquier transacción sin confirmar.
   */
  async reconnect(connectionId: string): Promise<ReconnectOutcome> {
    const connection = this.findConnection(connectionId);

    if (!connection) {
      return 'failed';
    }

    if (!connection.saved) {
      this._notices.set(
        `«${connection.name}» no está guardada, así que Druse no tiene con qué volver a abrirla. ` +
          'Créala de nuevo desde «Nueva conexión».',
      );

      return 'failed';
    }

    if (connection.sessionId) {
      try {
        await firstValueFrom(this._gateway.closeSession(connection.sessionId));
      } catch {
        // Si ya no existía, el resultado es el que se buscaba.
      }
    }

    this._transactions.forget(connectionId);
    this._explorer.forget(connectionId);
    this.patchConnection(connectionId, { sessionId: undefined, lost: false, error: undefined });

    // El resultado en pantalla salió de la sesión anterior; conservarlo sería
    // enseñar filas que ya no se pueden ni refrescar ni editar.
    if (this._execution.source()?.connectionId === connectionId) {
      this.clearDisplayedResult();
    }

    const connected = await this.connectSaved(connectionId);

    if (connected) {
      this.patchConnection(connectionId, { lost: false });
      this._notices.set(`Conexión con «${connection.name}» restablecida.`);

      return 'ok';
    }

    // `connectSaved` deja la conexión desconectada cuando la API pide la
    // contraseña; quien llama decide si abrir el diálogo.
    return this.findConnection(connectionId)?.state === 'disconnected' ? 'needsPassword' : 'failed';
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
      this._connectionStore.update((connections) =>
        connections.filter((item) => item.id !== connectionId),
      );
    }

    this._explorer.forget(connectionId);
    this._connectionStore.forgetSession(connectionId);

    // Cerrar la conexión deshace lo que no estuviera confirmado —lo hace el
    // proceso local al soltar la sesión—, así que aquí no queda transacción de
    // la que hablar. Quien avisa antes de llegar hasta aquí es la interfaz.
    this._transactions.forget(connectionId);

    if (this._connectionStore.activeId() === connectionId) {
      this._connectionStore.activate(
        this._connectionStore.connections().find((item) => item.sessionId)?.id ?? null,
      );
    }
  }

  /**
   * Guarda los cambios de un perfil sin abrir sesión.
   *
   * Editar y conectar son cosas distintas: quien corrige el puerto de una
   * conexión de producción no está pidiendo entrar en ella.
   */
  async saveConnection(form: ConnectionForm): Promise<boolean> {
    const saved = await this.persist(form, form.id ?? crypto.randomUUID());

    if (!saved) {
      return false;
    }

    // La conexión ya visible se actualiza en el sitio: recargarlo todo la
    // devolvería al final de la lista y cerraría lo que estuviera desplegado.
    this.patchConnection(saved.id, {
      name: saved.name,
      engine: saved.engine,
      environment: saved.environment,
      readOnly: saved.readOnly,
      database: saved.database,
      authentication: saved.authentication ?? 'password',
      hasStoredPassword: saved.hasStoredPassword,
    });

    return true;
  }

  /**
   * Guarda el perfil en la base local; la contraseña va al almacén del sistema.
   *
   * Son dos sitios distintos y el segundo puede fallar solo. Cuando pasa, el
   * perfil **sí** queda guardado y el servidor lo cuenta en `secretWarning`: se
   * enseña como aviso, no como error, porque la conexión existe y funciona; lo
   * único que ocurre es que la contraseña se pedirá al entrar.
   */
  private async persist(form: ConnectionForm, id: string): Promise<SavedConnection | null> {
    const request = {
      profile: { ...toRequest(form).profile, id },
      password: form.password,
      storePassword: form.storePassword,
      sshSecret: form.sshSecret,
      storeSshSecret: form.storeSshSecret ?? false,
    };

    try {
      const saved = form.id
        ? await firstValueFrom(this._gateway.updateConnection(form.id, request))
        : await firstValueFrom(this._gateway.saveConnection(request));

      this._savedProfiles.update((profiles) => [
        ...profiles.filter((profile) => profile.id !== saved.id),
        saved,
      ]);

      if (saved.secretWarning) {
        this._notices.set(saved.secretWarning);
      }

      return saved;
    } catch (error) {
      this._notices.set(describeError(error));
      return null;
    }
  }

  /**
   * Crea la base que el formulario nombra, **sin abrirla**.
   *
   * Devuelve el motivo cuando no se pudo, igual que preguntar por las bases:
   * quien pulsa «Crear» necesita saber si el archivo ya estaba, si la carpeta no
   * deja escribir o si el motor no sabe hacerlo, y las tres cosas se arreglan de
   * forma distinta.
   *
   * @returns `null` si se creó; el motivo si no.
   */
  async createDatabase(form: ConnectionForm): Promise<string | null> {
    try {
      await firstValueFrom(this._gateway.createDatabase(toRequest(form)));

      return null;
    } catch (error) {
      return describeError(error);
    }
  }

  /**
   * Qué bases puede abrir esta conexión.
   *
   * Devuelve la lista **y el motivo cuando no la hay**: el formulario necesita
   * distinguir «el servidor no tiene ninguna» de «no se pudo preguntar», y una
   * lista vacía diría las dos cosas a la vez. La redacción del fallo se queda
   * aquí, que es donde vive la del resto de la aplicación.
   */
  async connectionDatabases(
    form: ConnectionForm,
  ): Promise<{ databases: readonly string[]; error: string | null }> {
    try {
      const databases = await firstValueFrom(
        this._gateway.listConnectionDatabases(toRequest(form)),
      );

      return { databases, error: null };
    } catch (error) {
      return { databases: [], error: describeError(error) };
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

  /**
   * Prueba el túnel y cuenta **hasta dónde se llegó**.
   *
   * Es lo que «probar conexión» no puede decir: allí, un fallo del servidor
   * intermedio y uno de la base salen con la misma cara. Aquí no se abre ninguna
   * conexión de base de datos, así que lo que responda es de la red y de la
   * cuenta SSH, de nadie más.
   */
  async testTunnel(form: ConnectionForm): Promise<string> {
    try {
      const result = await firstValueFrom(this._gateway.testTunnel(toRequest(form)));

      if (result.succeeded) {
        return `Túnel correcto: se llegó a ${form.host}:${form.port} a través de ${form.sshTunnel?.host ?? 'el servidor intermedio'} en ${result.durationMs} ms.`;
      }

      return result.errorMessage ?? 'No se pudo abrir el túnel.';
    } catch (error) {
      return describeError(error);
    }
  }

  // --- Diseño de tablas ------------------------------------------------------

  /** Tipos que ofrece el motor de esta conexión, para el desplegable. */
  async tableDataTypes(connectionId: string): Promise<readonly string[]> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return [];
    }

    try {
      return await firstValueFrom(this._gateway.getTableDataTypes(sessionId));
    } catch {
      // Sin tipos sugeridos el formulario sigue sirviendo: el campo admite
      // escribir cualquier tipo a mano.
      return [];
    }
  }

  /**
   * Lo que el motor admite al definir un índice.
   *
   * Si la consulta falla se devuelve lo más restrictivo, no lo más permisivo:
   * un formulario que ofrece `INCLUDE` donde no existe produce un índice que el
   * motor rechaza, y el usuario no tiene forma de saber por qué.
   */
  async tableCapabilities(connectionId: string): Promise<IndexCapabilities> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    const conservative: IndexCapabilities = {
      supportsIncludedColumns: false,
      supportsFilter: false,
      supportsSortDirection: true,
      supportsCheckConstraints: true,
      methods: [],
      foreignKeyActions: ['noAction', 'cascade', 'setNull', 'setDefault'],
    };

    if (!sessionId) {
      return conservative;
    }

    try {
      return await firstValueFrom(this._gateway.getTableCapabilities(sessionId));
    } catch {
      return conservative;
    }
  }

  /**
   * Índices y restricciones de una tabla, tal y como están hoy.
   *
   * Es el punto de partida para modificarlos: igual que con las columnas, se
   * describe en qué se diferencia lo que hay de lo que se quiere.
   */
  /**
   * Columnas y estructura de varias tablas de una vez, para dibujar un diagrama.
   *
   * Va por su propia llamada y no por `tableStructure` repetida: sesenta tablas
   * serían sesenta peticiones turnándose con lo que el explorador y el editor
   * estén haciendo sobre la misma conexión.
   */
  async schemaGraph(
    connectionId: string,
    tables: readonly DatabaseObject[],
  ): Promise<SchemaGraph | null> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return null;
    }

    try {
      return await firstValueFrom(this._gateway.getSchemaGraph(sessionId, tables));
    } catch (error) {
      this.reportFailure(connectionId, error);
      return null;
    }
  }

  async tableStructure(
    connectionId: string,
    table: DatabaseObject,
  ): Promise<TableStructure | null> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return null;
    }

    try {
      return await firstValueFrom(this._gateway.getTableStructure(sessionId, table));
    } catch (error) {
      this.reportFailure(connectionId, error);
      return null;
    }
  }

  /**
   * Parámetros de un procedimiento, para poder componer su llamada.
   *
   * Devuelve `null` cuando el motor no lo deja leer —una función de PostgreSQL
   * llega sin OID, un procedimiento puede estar cifrado— y el aviso ya se le ha
   * dado al usuario: quien llama solo tiene que dejar de ofrecer el formulario.
   */
  async routineSignature(
    connectionId: string,
    routine: DatabaseObject,
  ): Promise<RoutineSignature | null> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return null;
    }

    try {
      return await firstValueFrom(this._gateway.getRoutineSignature(sessionId, routine));
    } catch (error) {
      this.reportFailure(connectionId, error);
      return null;
    }
  }

  /**
   * Columnas de una tabla, tal y como están hoy en la base.
   *
   * El diseñador parte de ellas: modificar una tabla es partir de lo que hay y
   * describir en qué se diferencia de lo que se quiere.
   */
  async tableColumns(
    connectionId: string,
    table: DatabaseObject,
  ): Promise<readonly DatabaseColumn[]> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return [];
    }

    try {
      return await firstValueFrom(this._gateway.getColumns(sessionId, table));
    } catch (error) {
      this.reportFailure(connectionId, error);
      return [];
    }
  }

  /** El SQL que se ejecutaría, para enseñarlo antes de tocar la base. */
  async previewTable(
    connectionId: string,
    design: TableDesign | TableAlteration,
  ): Promise<readonly string[]> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return [];
    }

    try {
      return await firstValueFrom(
        'table' in design
          ? this._gateway.previewAlterTable(sessionId, design)
          : this._gateway.previewCreateTable(sessionId, design),
      );
    } catch (error) {
      this._notices.set(describeError(error));
      return [];
    }
  }

  /**
   * Crea la tabla y refresca el árbol para que aparezca.
   *
   * Devuelve las instrucciones ejecutadas, o `null` si no se aplicó nada: el
   * diálogo las enseña como confirmación de lo que acaba de ocurrir.
   */
  async createTable(connectionId: string, design: TableDesign): Promise<readonly string[] | null> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return null;
    }

    try {
      const result = await firstValueFrom(this._gateway.createTable(sessionId, design));

      await this.refreshAfterDesign(connectionId, design.database);

      return result.statements;
    } catch (error) {
      this.reportFailure(connectionId, error);
      return null;
    }
  }

  async alterTable(
    connectionId: string,
    alteration: TableAlteration,
    confirmedDestructive: boolean,
  ): Promise<readonly string[] | null> {
    const sessionId = this.findConnection(connectionId)?.sessionId;

    if (!sessionId) {
      return null;
    }

    try {
      const result = await firstValueFrom(
        this._gateway.alterTable(sessionId, alteration, confirmedDestructive),
      );

      await this.refreshAfterDesign(connectionId, alteration.table.database);

      return result.statements;
    } catch (error) {
      this.reportFailure(connectionId, error);
      return null;
    }
  }

  /**
   * Vuelve a leer el catálogo de la conexión tras cambiar la estructura.
   *
   * Sin esto, el explorador seguiría enseñando las columnas de antes y el
   * autocompletado sugeriría una columna que ya no existe.
   */
  private async refreshAfterDesign(connectionId: string, database?: string): Promise<void> {
    const connection = this.findConnection(connectionId);

    if (!connection?.sessionId) {
      return;
    }

    await this._explorer.loadDatabases(connectionId, connection.sessionId);
    void this._explorer.primeSchemaIndexAsync(connectionId, database ?? connection.database);
  }

  /** Obtiene el DDL de una vista o procedimiento y lo abre sin ejecutarlo. */
  async openDefinition(node: ExplorerNode): Promise<void> {
    if (node.kind !== 'view' && node.kind !== 'procedure') {
      return;
    }

    const connection = this.findConnection(node.connectionId);

    if (!connection?.sessionId) {
      this._notices.set('La conexión de este objeto no está abierta.');
      return;
    }

    try {
      const sql = await firstValueFrom(
        this._gateway.getDefinition(connection.sessionId, node.source),
      );

      this.createTab(
        sql,
        undefined,
        node.connectionId,
        `${node.label} · DDL`,
        node.source.database,
      );
    } catch (error) {
      this._notices.set(describeError(error));
    }
  }

  toggleConnection(connectionId: string): void {
    const connection = this.findConnection(connectionId);

    if (connection) {
      this.activateConnection(connectionId);
      this.patchConnection(connectionId, { expanded: !connection.expanded });
    }
  }

  selectConnection(connectionId: string): void {
    const connection = this.findConnection(connectionId);

    if (connection?.sessionId) {
      this.activateConnection(connectionId);
      this.patchConnection(connectionId, { expanded: true });
    }
  }

  // --- Pestañas --------------------------------------------------------------

  selectTab(id: string): void {
    this._tabStore.select(id);
    this.clearDisplayedResult();
  }

  closeTab(id: string): void {
    this._tabStore.close(id);
    this.clearDisplayedResult();
  }

  createTab(
    sql = '',
    sourceTable?: DatabaseObject,
    connectionId: string | undefined = this.activeTab()?.connectionId ??
      this._connectionStore.activeId() ??
      undefined,
    title?: string,
    database: string | undefined = this.activeTab()?.database,
  ): void {
    this._tabStore.create({ sql, sourceTable, connectionId, title, database });

    // Cambiar de pestaña cambia lo que hay en la cuadrícula: los cambios
    // pendientes de la anterior no pueden seguir vivos.
    this.clearDisplayedResult();
  }

  openSqlFile(fileName: string, sql: string, documentId?: string): void {
    this._tabStore.openFile(fileName, sql, documentId, {
      connectionId: this.activeTab()?.connectionId ?? this._connectionStore.activeId() ?? undefined,
      database: this.activeTab()?.database,
    });
    this.clearDisplayedResult();
  }

  updateSql(sql: string): void {
    this._tabStore.updateSql(sql);
    this._execution.dismissRejection();
    this.discardEdits();
  }

  /** Abre una pestaña con un SELECT sobre la tabla indicada. */
  openSelectFor(node: ExplorerNode, sql: string): void {
    if (node.kind !== 'table' && node.kind !== 'view') {
      return;
    }

    // La tabla viaja con la pestaña: es lo que permite editar su resultado, y
    // solo lo tienen las pestañas abiertas desde el explorador.
    this.createTab(
      sql,
      node.kind === 'table' ? node.source : undefined,
      node.connectionId,
      `${node.label} · SELECT`,
      node.source.database,
    );

    // Sus columnas hacen falta para saber cuál es la clave primaria; se piden
    // ahora para que al ejecutar la cuadrícula ya sepa si se puede editar.
    void this.ensureColumnsAsync(
      node.source.schema ?? null,
      node.source.name,
      node.connectionId,
      node.source.database,
    );
  }

  // --- Ejecución -------------------------------------------------------------

  /**
   * Ejecuta el SQL de la pestaña activa.
   *
   * `sqlOverride` sirve para ejecutar solo la selección del editor sin tocar el
   * contenido de la pestaña.
   */
  async execute(sqlOverride?: string, confirmDestructive = false): Promise<QueryResult | null> {
    const connection = this.activeConnection();
    const tab = this.activeTab();
    const tabId = tab?.id;
    const tabSql = tab?.sql;

    if (!connection?.sessionId) {
      this._notices.set('No hay ninguna conexión abierta.');
      return null;
    }

    const sql = sqlOverride ?? tab?.sql ?? '';

    if (!sql.trim()) {
      this._notices.set('No hay ninguna instrucción que ejecutar.');
      return null;
    }

    this._notices.clear();

    try {
      const result = await this._execution.run({
        sessionId: connection.sessionId,
        sql,
        database: tab?.database,
        maxRows: this._maxRows(),
        timeoutSeconds: this._timeoutSeconds(),
        confirmDestructive,
      });

      if (this.activeTab()?.id === tabId && this.activeTab()?.sql === tabSql) {
        this._execution.show(result, {
          tabId: tabId ?? null,
          connectionId: connection.id,
          database: tab?.database,
          sql,
          title: tab?.title ?? 'druse',
        });
      } else {
        return null;
      }

      this._connectionStore.patchSession(connection.id, { lastDurationMs: result.durationMs });

      // El error de una consulta **no va al aviso de arriba**: el panel ya lo
      // enseña con su código y su botón de copiar, y el editor subraya la
      // palabra culpable en su sitio. Decirlo tres veces solo robaba alto.
      //
      // La banda se queda para lo que no cabe ahí: la sesión perdida, la
      // transacción abierta, la confirmación de algo destructivo.

      return result;
    } catch (error) {
      // Un 409 no es un fallo de transporte: es la API pidiendo confirmación.
      const rejection = asRejection(error);

      if (rejection) {
        if (
          tab &&
          connection &&
          this.activeTab()?.id === tab.id &&
          this.activeTab()?.sql === tabSql
        ) {
          this._execution.noteRejection({
            value: rejection,
            operation: 'execute',
            tabId: tab.id,
            connectionId: connection.id,
            sql,
          });
        }
      } else if (!this.noteSessionLoss(connection.id, error)) {
        if (this.activeTab()?.id === tabId && this.activeTab()?.sql === tabSql) {
          this._notices.set(describeError(error));
        }
      }

      return null;
    }
  }

  /** Confirma exactamente la operación que el servidor rechazó. */
  async confirmAndExecute(): Promise<QueryResult | null> {
    const pending = this._execution.pendingRejection();
    const tab = this.activeTab();

    if (!pending || tab?.id !== pending.tabId || tab.connectionId !== pending.connectionId) {
      this._execution.dismissRejection();
      return null;
    }

    this._execution.dismissRejection();

    if (pending.operation === 'export' && pending.format) {
      await this.export(pending.format, true, pending.sql);
      return null;
    } else {
      return await this.execute(pending.sql, true);
    }
  }

  dismissRejection(): void {
    this._execution.dismissRejection();
  }

  dismissNotice(): void {
    this._notices.clear();
  }

  /** Pide parar la consulta en curso. */
  async cancel(): Promise<void> {
    await this._execution.cancel();
  }

  // --- Utilidades privadas ---------------------------------------------------

  private findConnection(id: string): ConnectionSummary | undefined {
    return this._connectionStore.find(id);
  }

  private setSession(connectionId: string, session: SessionStatus): void {
    this._connectionStore.setSession(connectionId, session);
  }

  private activateConnection(connectionId: string): void {
    this._connectionStore.activate(connectionId);
    this._tabStore.update((tabs) =>
      tabs.map((tab) => (tab.active && !tab.connectionId ? { ...tab, connectionId } : tab)),
    );
  }

  /**
   * Retira lo que hay en pantalla y los cambios que colgaban de ello.
   *
   * Los cambios sin guardar de la cuadrícula se van con el resultado a
   * propósito: señalan filas de una consulta que ya no está delante, y
   * aplicarlos después sería escribir a ciegas.
   */
  private clearDisplayedResult(): void {
    this._execution.clear();
    this.discardEdits();
  }

  private patchConnection(id: string, patch: Partial<ConnectionSummary>): void {
    this._connectionStore.patch(id, patch);
  }
}

/**
 * Quién aparece en la barra de estado.
 *
 * Con autenticación de Windows no hay usuario escrito, así que se nombra el
 * método: dejar solo el servidor haría creer que la conexión es anónima.
 */
function describeUser(form: ConnectionForm): string {
  return form.authentication === 'windows'
    ? `Windows@${form.host}`
    : `${form.username}@${form.host}`;
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
      authentication: form.authentication,
      readOnly: form.readOnly,
      sslMode: form.sslMode,
      sshTunnel: form.sshTunnel,
      informixServer: form.informixServer,
    },
    // Con autenticación de Windows no hay contraseña que enviar: la identidad la
    // pone la sesión del sistema.
    password: form.authentication === 'windows' ? undefined : form.password,
    sshSecret: form.sshTunnel ? form.sshSecret : undefined,
    sshVerificationCode: form.sshTunnel ? form.sshVerificationCode : undefined,
  };
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
      const body = JSON.parse(await error.error.text()) as Partial<QueryRejected>;

      // Se exige `reason`, igual que en la rama de abajo. Por este mismo 409
      // llegan ahora los errores del motor durante una exportación —traen
      // `message` y `code`, no `reason`—, y tomarlos por un rechazo dejaría el
      // aviso sin la lista de riesgos que la plantilla recorre. Sin `reason` es
      // un error normal y se cuenta como tal.
      return body.reason ? (body as QueryRejected) : null;
    } catch {
      return null;
    }
  }

  return error.error?.reason ? (error.error as QueryRejected) : null;
}

/**
 * Rehace el error con su cuerpo ya leído, cuando vino como blob.
 *
 * La exportación pide `responseType: 'blob'`, así que el JSON del error llega
 * como archivo y `error.error.message` no existe. Sin esto, una sesión perdida
 * durante una exportación se vería como un error cualquiera.
 */
async function asHttpErrorFromBlob(error: unknown): Promise<HttpErrorResponse | null> {
  if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) {
    return null;
  }

  try {
    return new HttpErrorResponse({
      status: error.status,
      statusText: error.statusText,
      url: error.url ?? undefined,
      error: JSON.parse(await error.error.text()),
    });
  } catch {
    return null;
  }
}

async function describeBlobError(error: unknown): Promise<string> {
  if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
    try {
      const text = await error.error.text();
      const body = JSON.parse(text) as { message?: unknown };

      if (typeof body.message === 'string' && body.message.length > 0) {
        return body.message;
      }
    } catch {
      // Si no es JSON válido, se conserva el mensaje HTTP normal.
    }
  }

  return describeError(error);
}

/** Reconoce el 409 con el que la API pide confirmación. */
function asRejection(error: unknown): QueryRejected | null {
  if (error instanceof HttpErrorResponse && error.status === 409 && error.error?.reason) {
    return error.error as QueryRejected;
  }

  return null;
}

function describeVersion(engine: string, serverVersion: string): string {
  // Del mapa que ya existe, y no de un condicional propio: escrito a mano, todo
  // lo que no fuera PostgreSQL o SQL Server terminaba llamándose «MySQL», así que
  // una conexión Informix decía «MySQL 14» en la barra de estado.
  const name = ENGINE_NAMES[engine as DatabaseEngine] ?? engine;

  // La versión llega como «18.0.0»; en la barra de estado basta la mayor.
  const major = serverVersion.split('.')[0];

  return major ? `${name} ${major}` : name;
}
