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
import { FileSaveService } from '../files/file-save.service';
import { PendingWorkService } from '../files/pending-work.service';
import { ThemeService } from '../theme/theme.service';
import {
  DEFAULT_FORMAT_SETTINGS,
  FormatSettings,
  formatPreferences,
  parseFormatSettings,
} from './format-settings';
import {
  ConnectionForm,
  ConnectionSummary,
  DatabaseColumn,
  DatabaseObject,
  ExplorerNode,
  QueryHistoryEntry,
  CellEdit,
  EditableTable,
  IndexCapabilities,
  QueryResult,
  KnownColumn,
  KnownRelation,
  QueryTab,
  ResultSet,
  SavedConnection,
  SchemaIndex,
  SecretStoreStatus,
  SessionStatus,
  TableAlteration,
  TableDesign,
  RoutineSignature,
  TableStructure,
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

interface PendingRejection {
  readonly value: QueryRejected;
  readonly operation: 'execute' | 'export';
  readonly tabId: string;
  readonly connectionId: string;
  readonly sql: string;
  readonly format?: ExportFormat;
}

interface DisplayedResultSource {
  readonly tabId: string | null;
  readonly connectionId: string;
  readonly database?: string;
  readonly sql: string;
  readonly title: string;
}

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
 * Espera antes de guardar el trabajo sin ejecutar, en milisegundos.
 *
 * Corto porque lo que protege es un cierre inesperado, y largo porque escribir
 * cambia el estado en cada tecla: sin esta pausa habría una escritura en disco
 * por pulsación.
 */
const TABS_SAVE_DELAY_MS = 1000;

/**
 * Cada cuánto se vuelve a preguntar por una transacción abierta.
 *
 * Medio minuto: lo bastante seguido para que el indicador no mienta mucho rato
 * después de que el proceso local la deshaga por inactividad, y lo bastante
 * espaciado para que no sea una petición constante contra la API.
 */
const TRANSACTION_WATCH_MS = 30_000;

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
  private readonly _files = inject(FileSaveService);
  private readonly _pendingWork = inject(PendingWorkService);
  private readonly _theme = inject(ThemeService);

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

  /** Guardado pendiente del trabajo sin ejecutar, o `null` si no hay ninguno. */
  private _tabsSaveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Hasta que no se ha leído lo guardado, no se guarda nada encima. */
  private _tabsRestored = false;

  // --- Ejecución -------------------------------------------------------------
  private readonly _result = signal<QueryResult | null>(null);
  readonly result = this._result.asReadonly();
  private readonly _resultSource = signal<DisplayedResultSource | null>(null);

  private readonly _running = signal(false);
  readonly running = this._running.asReadonly();

  /** Ya se pidió detener la ejecución y se espera la confirmación del motor. */
  private readonly _canceling = signal(false);
  readonly canceling = this._canceling.asReadonly();

  private readonly _currentExecutionId = signal<string | null>(null);

  /** Rechazo ligado a la operación exacta que el servidor no ejecutó. */
  private readonly _pendingRejection = signal<PendingRejection | null>(null);
  readonly rejection = computed(() => this._pendingRejection()?.value ?? null);

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
    this._notice.set(message);
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
   * Cambia las pestañas y programa su guardado.
   *
   * Todo lo que las toca pasa por aquí para que recuperar el trabajo no dependa
   * de acordarse de guardar en cada sitio: son ocho, y el que se olvide sería
   * justo el que pierda lo escrito.
   */
  private updateTabs(change: (tabs: readonly QueryTab[]) => readonly QueryTab[]): void {
    this._tabs.update(change);
    this.scheduleTabsSave();
  }

  /**
   * Guarda el trabajo sin ejecutar, poco después de dejar de escribir.
   *
   * El retardo existe porque escribir cambia el estado en cada tecla y guardar
   * en cada una sería una escritura por pulsación. Un segundo es corto para lo
   * que se protege —un cierre inesperado— y suficiente para no castigar el
   * teclado.
   */
  private scheduleTabsSave(): void {
    if (!this._tabsRestored) {
      // Antes de restaurar no se guarda nada: la pestaña vacía del arranque
      // pisaría lo que se dejó escrito en la sesión anterior.
      return;
    }

    if (this._tabsSaveTimer !== null) {
      clearTimeout(this._tabsSaveTimer);
    }

    this._tabsSaveTimer = setTimeout(() => {
      this._tabsSaveTimer = null;
      void this.saveTabsNow();
    }, TABS_SAVE_DELAY_MS);
  }

  /**
   * Guarda ya lo que estuviera esperando.
   *
   * El retardo deja una rendija: cerrar justo después de escribir se llevaría lo
   * último. Se llama al perder el foco y al cerrar, que es cuando esa rendija
   * importa.
   */
  flushTabs(): void {
    if (this._tabsSaveTimer === null) {
      return;
    }

    clearTimeout(this._tabsSaveTimer);
    this._tabsSaveTimer = null;
    void this.saveTabsNow();
  }

  private async saveTabsNow(): Promise<void> {
    const tabs = this._tabs().map((tab) => ({
      id: tab.id,
      title: tab.title,
      sql: tab.sql,
      isActive: tab.active,
      isDirty: tab.dirty,
      connectionId: tab.connectionId,
      database: tab.database,
      fileName: tab.fileName,
      documentId: tab.documentId,
    }));

    try {
      await firstValueFrom(this._gateway.saveEditorTabs(tabs));
    } catch {
      // Guardar el borrador es una red de seguridad: si falla, el usuario sigue
      // teniendo su trabajo delante y avisarle no le sirve de nada.
    }
  }

  /**
   * Devuelve las pestañas de la última sesión, con lo que no se llegó a ejecutar.
   *
   * Se llama una vez al arrancar. Si no hay nada guardado se deja la pestaña
   * vacía de siempre, que es lo que ve quien abre Druse por primera vez.
   */
  async restoreTabs(): Promise<void> {
    try {
      const stored = await firstValueFrom(this._gateway.getEditorTabs());

      if (stored.length > 0) {
        this._tabs.set(
          stored.map((tab, index) => ({
            id: tab.id,
            title: tab.title,
            active: tab.isActive || (index === 0 && !stored.some((other) => other.isActive)),
            dirty: tab.isDirty,
            sql: tab.sql,
            connectionId: tab.connectionId,
            database: tab.database,
            fileName: tab.fileName,
            documentId: tab.documentId,
          })),
        );

        // El contador se adelanta a lo restaurado: si volviera a empezar, la
        // siguiente pestaña nueva se llamaría igual que una recuperada y las dos
        // se pisarían.
        tabCounter = Math.max(
          tabCounter,
          ...stored.map((tab) => Number.parseInt(tab.id.replace(/^q/, ''), 10) || 0),
        );
      }
    } catch {
      // Sin lo guardado se arranca como siempre.
    } finally {
      this._tabsRestored = true;
    }
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
    } catch {
      // Se sigue con los valores por defecto.
    }
  }

  /** Aplica el resultado de guardar únicamente si el contenido no cambió mientras se escribía. */
  markTabSaved(id: string, sql: string, fileName: string, documentId?: string): void {
    this.updateTabs((tabs) =>
      tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              title: fileName,
              fileName,
              documentId: documentId || tab.documentId,
              dirty: tab.sql === sql ? false : tab.dirty,
            }
          : tab,
      ),
    );
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
    const source = this._result() ? this._resultSource() : null;
    const connection = source ? this.findConnection(source.connectionId) : this.activeConnection();
    const tab = this.activeTab();
    const tabId = source?.tabId ?? tab?.id;
    const sql = (sqlOverride ?? source?.sql ?? tab?.sql ?? '').trim();
    const tabSql = tab?.sql;
    const stillCurrent = (): boolean =>
      source
        ? this._resultSource() === source
        : this.activeTab()?.id === tabId && this.activeTab()?.sql === tabSql;

    if (!connection?.sessionId) {
      this._notice.set('No hay ninguna conexión abierta.');
      return;
    }

    if (!sql) {
      this._notice.set('No hay ninguna consulta que exportar.');
      return;
    }

    this._exporting.set(true);
    this._pendingRejection.set(null);

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
        const saved = await this._files.save(fileName, blob);

        if (stillCurrent()) {
          this._notice.set(
            saved ? `Exportado a ${format.toUpperCase()}.` : 'Exportación cancelada.',
          );
        }
      }
    } catch (error) {
      const rejection = await asRejectionFromBlob(error);

      if (rejection) {
        if (
          tab &&
          connection &&
          this.activeTab()?.id === tab.id &&
          stillCurrent()
        ) {
          this._pendingRejection.set({
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
            this._notice.set(message);
          }
        }
      }
    } finally {
      this._exporting.set(false);
    }
  }

  // --- Sesión activa ---------------------------------------------------------
  private readonly _activeConnectionId = signal<string | null>(null);
  private readonly _sessions = signal<ReadonlyMap<string, SessionStatus>>(new Map());

  readonly session = computed(() => {
    const connectionId = this.activeConnection()?.id;

    return connectionId ? (this._sessions().get(connectionId) ?? null) : null;
  });

  // --- Transacciones manuales ------------------------------------------------

  /**
   * La transacción de cada conexión, indexada por conexión y no por pestaña.
   *
   * No es un detalle de implementación: **la transacción pertenece a la
   * conexión**. Dos pestañas del mismo perfil comparten sesión, así que lo que
   * se ejecute en cualquiera de ellas entra en la misma transacción, y guardarla
   * por pestaña haría creer lo contrario.
   */
  private readonly _transactions = signal<ReadonlyMap<string, TransactionState>>(new Map());

  /** La transacción abierta en la conexión activa, o `null` si va en autocommit. */
  readonly transaction = computed(() => {
    const connectionId = this.activeConnection()?.id;
    const state = connectionId ? this._transactions().get(connectionId) : undefined;

    return state?.isOpen ? state : null;
  });

  private readonly _transactionBusy = signal(false);
  readonly transactionBusy = this._transactionBusy.asReadonly();

  /**
   * Reloj que vuelve a preguntar por la transacción abierta.
   *
   * Existe por una sola razón: el proceso local la deshace solo si se queda
   * inactiva, y eso ocurre sin que nadie pulse nada. Sin este reloj, el
   * indicador seguiría diciendo que hay una transacción abierta mucho después de
   * que dejara de haberla.
   */
  private _transactionWatch: ReturnType<typeof setInterval> | null = null;

  /** Hay una transacción abierta en esa conexión. */
  hasOpenTransaction(connectionId: string): boolean {
    return this._transactions().get(connectionId)?.isOpen === true;
  }

  /** Entra en modo manual: a partir de aquí nada se confirma solo. */
  async beginTransaction(): Promise<boolean> {
    return this.runTransaction((sessionId) => this._gateway.beginTransaction(sessionId), (state) => {
      const aviso = state.ddlIsReversible
        ? ''
        : ' Crear o modificar tablas no se deshace en este motor, aunque uses «Deshacer».';

      return (
        `Transacción abierta en «${state.connectionName}». ` +
        'Todo lo que ejecutes en esta conexión entra en ella hasta que la confirmes o la deshagas.' +
        aviso
      );
    });
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

  private async runTransaction(
    operation: (sessionId: string) => Observable<TransactionState>,
    describe: (state: TransactionState) => string,
  ): Promise<boolean> {
    const connection = this.activeConnection();

    if (!connection?.sessionId) {
      this._notice.set('Abre una conexión para poder usar transacciones.');

      return false;
    }

    this._transactionBusy.set(true);

    try {
      const state = await firstValueFrom(operation(connection.sessionId));

      this.setTransaction(connection.id, state);
      this._notice.set(describe(state));

      return true;
    } catch (error) {
      // Sin sesión no hay transacción de la que hablar, y el aviso de la
      // conexión perdida explica mejor lo que pasó.
      if (this.noteSessionLoss(connection.id, error)) {
        return false;
      }

      this._notice.set(describeError(error));

      // El estado local pudo quedarse atrás —otra pestaña la cerró, o se
      // deshizo sola—, así que se vuelve a preguntar en lugar de dejar los
      // botones mintiendo.
      await this.refreshTransaction(connection.id);

      return false;
    } finally {
      this._transactionBusy.set(false);
    }
  }

  /** Vuelve a preguntar por la transacción de una conexión. */
  private async refreshTransaction(connectionId: string): Promise<void> {
    const connection = this.findConnection(connectionId);

    if (!connection?.sessionId) {
      return;
    }

    try {
      const state = await firstValueFrom(this._gateway.getTransaction(connection.sessionId));
      const previous = this._transactions().get(connectionId);

      this.setTransaction(connectionId, state);

      // Se cuenta una sola vez, comparando con lo último que se sabía: sin esa
      // comparación el aviso volvería a salir en cada vuelta del reloj.
      if (
        state.autoRolledBackAt &&
        state.autoRolledBackAt !== previous?.autoRolledBackAt &&
        !state.isOpen
      ) {
        const minutos = Math.max(1, Math.round(state.idleTimeoutSeconds / 60));

        this._notice.set(
          `La transacción de «${state.connectionName}» se deshizo sola tras ${minutos} min sin ` +
            'actividad, para no dejar filas bloqueadas. Los cambios sin confirmar se perdieron.',
        );
      }
    } catch {
      // Preguntar por el estado no puede molestar al usuario: si la API no
      // responde, ya se lo dirá la siguiente cosa que intente hacer.
    }
  }

  private setTransaction(connectionId: string, state: TransactionState): void {
    this._transactions.update((current) => {
      const next = new Map(current);
      next.set(connectionId, state);

      return next;
    });

    this.watchTransactions();
  }

  /** Mantiene el reloj vivo solo mientras haya alguna transacción abierta. */
  private watchTransactions(): void {
    const abiertas = [...this._transactions().values()].some((state) => state.isOpen);

    // Quien avisa al cerrar la ventana necesita saberlo aquí y no al final: en
    // el escritorio, el aviso lo da el envoltorio, y para entonces preguntarle a
    // la página ya sería tarde.
    this._pendingWork.set(abiertas);

    if (!abiertas) {
      if (this._transactionWatch !== null) {
        clearInterval(this._transactionWatch);
        this._transactionWatch = null;
      }

      return;
    }

    if (this._transactionWatch !== null) {
      return;
    }

    this._transactionWatch = setInterval(() => {
      for (const [connectionId, state] of this._transactions()) {
        if (state.isOpen) {
          void this.refreshTransaction(connectionId);
        }
      }
    }, TRANSACTION_WATCH_MS);
  }

  private forgetTransaction(connectionId: string): void {
    this._transactions.update((current) => {
      const next = new Map(current);
      next.delete(connectionId);

      return next;
    });

    this.watchTransactions();
  }

  // --- Persistencia ----------------------------------------------------------
  private readonly _secretStore = signal<SecretStoreStatus | null>(null);
  readonly secretStore = this._secretStore.asReadonly();

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
      const [saved, secretStore] = await Promise.all([
        firstValueFrom(this._gateway.getSavedConnections()),
        firstValueFrom(this._gateway.getSecretStoreStatus()),
      ]);

      this._secretStore.set(secretStore);
      this._savedProfiles.set(saved);

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
            authentication: profile.authentication ?? 'password',
          }));

        return [...live, ...restored];
      });
    } catch (error) {
      this._notice.set(describeError(error));
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

      await this.loadDatabases(connectionId, session.sessionId);

      // Sin `await`: el editor queda usable de inmediato y el catálogo va
      // llegando por detrás.
      void this.primeSchemaIndexAsync(connectionId, session.database);

      return 'ok';
    } catch (error) {
      // 428: la conexión no tiene contraseña guardada y hay que pedirla.
      if (error instanceof HttpErrorResponse && error.status === 428) {
        this.patchConnection(connectionId, { state: 'disconnected' });
        return 'needsPassword';
      }

      this.patchConnection(connectionId, { state: 'error', error: describeError(error) });
      this._notice.set(describeError(error));

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
      this._notice.set(describeError(error));
      return;
    }

    this._connections.update((connections) =>
      connections.filter((connection) => connection.id !== connectionId),
    );
    this.forgetPrimed(connectionId);
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

  /**
   * La conexión que perdió su sesión, si hay alguna.
   *
   * Sirve para poner «Reconectar» en el aviso: quien acaba de leer que se cayó
   * la conexión no debería tener que buscar dónde se arregla.
   */
  readonly lostConnection = computed(
    () => this._connections().find((connection) => connection.lost) ?? null,
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

    this.updateTabs((tabs) =>
      tabs.map((item) =>
        item.id === tab.id
          ? // La procedencia editable también era de la base anterior: esas filas
            // no se pueden escribir desde aquí.
            { ...item, database, sourceTable: undefined }
          : item,
      ),
    );

    if (this._resultSource()?.tabId === tab.id) {
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
      this._notice.set(
        `Lo que ejecutes contra «${database}» no entra en la transacción abierta: ` +
          'va por otra conexión y se confirma solo.',
      );
    }

    // El autocompletado de la base nueva no está cargado todavía; se pide por
    // detrás para que escribir no tenga que esperar al catálogo.
    void this.primeSchemaIndexAsync(connectionId, database);
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

    const database = this._sessions().get(connectionId)?.database;

    this._activeConnectionId.set(connectionId);

    if (tab) {
      // La base y la procedencia editable eran de la conexión anterior: aquí no
      // significan nada, y arrastrarlas es cómo se acaba escribiendo en la tabla
      // de otro servidor.
      this.updateTabs((tabs) =>
        tabs.map((item) =>
          item.id === tab.id
            ? { ...item, connectionId, database, sourceTable: undefined }
            : item,
        ),
      );

    }

    // El resultado en pantalla salió del servidor anterior. Se retira mire lo que
    // mire: unas filas de desarrollo bajo una barra que ya dice «preproducción»
    // son la clase de detalle que lleva a tomar una decisión al revés.
    const source = this._resultSource();

    if (source && (source.connectionId === previous || source.tabId === tab?.id)) {
      this.clearDisplayedResult();
    }

    // Una transacción es de su conexión, así que sigue abierta donde estaba. Se
    // dice porque desde aquí ya no se ve, y una transacción olvidada retiene
    // bloqueos hasta que alguien se acuerda.
    if (previous && this.hasOpenTransaction(previous)) {
      const before = this.findConnection(previous)?.name ?? 'la conexión anterior';

      this._notice.set(
        `La transacción abierta en «${before}» sigue ahí: es de esa conexión y no ` +
          'se cierra al cambiar de pestaña.',
      );
    }

    if (database) {
      // `openSaved` puede haber iniciado ya el recorrido. Se espera esa misma
      // promesa: devolver antes dejaba el switch hecho pero el editor sin tablas.
      await this.primeSchemaIndexAsync(connectionId, database);
    }

    return 'ok';
  }

  readonly activeConnection = computed(() => {
    const connectionId = this.activeTab()?.connectionId ?? this._activeConnectionId();

    return connectionId
      ? (this._connections().find(
          (connection) => connection.id === connectionId && connection.sessionId,
        ) ?? null)
      : (this._connections().find((connection) => connection.sessionId) ?? null);
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
  readonly resultSet = computed<ResultSet | null>(() => this._result()?.resultSets[0] ?? null);

  /**
   * Columnas con su tipo, por tabla calificada.
   *
   * Vive aparte del árbol porque el editor necesita nulabilidad y clave primaria,
   * además del tipo que también se muestra en el explorador.
   */
  private readonly _columns = signal<ReadonlyMap<string, readonly KnownColumn[]>>(new Map());

  readonly schemaIndex = computed<SchemaIndex>(() => {
    const schemas = new Set<string>();
    const relations: KnownRelation[] = [];
    const connectionId = this.activeConnection()?.id;
    const database = this.activeDatabase()?.toLowerCase();

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
            connectionName: this.findConnection(entry.connectionId)?.name,
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
  });

  /** Relaciones cargadas, aunque su rama del árbol esté plegada. */
  readonly searchableRelations = computed<readonly ExplorerNode[]>(() => {
    const relations: ExplorerNode[] = [];

    const walk = (entries: readonly TreeEntry[]): void => {
      for (const entry of entries) {
        if (entry.object.kind === 'table' || entry.object.kind === 'view') {
          relations.push(toExplorerNode(entry));
        }

        if (entry.children) {
          walk(entry.children);
        }
      }
    };

    walk(this._roots());
    return relations;
  });

  /** Esquemas conocidos, aunque sus tablas todavía no se hayan cargado. */
  readonly searchableSchemas = computed<readonly ExplorerNode[]>(() => {
    const schemas: ExplorerNode[] = [];

    const walk = (entries: readonly TreeEntry[]): void => {
      for (const entry of entries) {
        if (entry.object.kind === 'schema') {
          schemas.push(toExplorerNode(entry));
        }

        if (entry.children) {
          walk(entry.children);
        }
      }
    };

    walk(this._roots());
    return schemas;
  });

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
      ? (this._columns().get(columnKey(connectionId, table.database, table.schema, table.name)) ??
        [])
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
      this._notice.set(describeError(error));
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
      this._notice.set(
        `${result.rowsAffected} ${result.rowsAffected === 1 ? 'fila guardada' : 'filas guardadas'}.`,
      );

      return true;
    } catch (error) {
      const connectionId = this.activeConnection()?.id;

      if (!connectionId || !this.noteSessionLoss(connectionId, error)) {
        this._notice.set(describeError(error));
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
    try {
      await firstValueFrom(this._gateway.cancelQuery(executionId));
    } catch {
      // Puede haber terminado entre la pulsación y esta solicitud.
    }
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
      this._notice.set(describeError(error));
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
      this._notice.set(
        `${result.rowsAffected} ${result.rowsAffected === 1 ? 'fila borrada' : 'filas borradas'}.`,
      );

      return true;
    } catch (error) {
      const connectionId = this.activeConnection()?.id;

      if (!connectionId || !this.noteSessionLoss(connectionId, error)) {
        this._notice.set(describeError(error));
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
      this._notice.set('No hay ninguna conexión abierta.');
      return;
    }

    this._importing.set(true);

    try {
      this._importPreview.set(
        await firstValueFrom(this._gateway.previewImport(sessionId, table, file, options)),
      );
    } catch (error) {
      this._importPreview.set(null);
      this._notice.set(describeError(error));
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
      this._notice.set('No hay ninguna conexión abierta.');
      return false;
    }

    this._importing.set(true);

    try {
      const result = await firstValueFrom(this._gateway.runImport(sessionId, table, file, options));

      this._importPreview.set(null);
      this._notice.set(
        `${result.rowsAffected} ${result.rowsAffected === 1 ? 'fila importada' : 'filas importadas'} en ${table.name}.`,
      );

      // El recuento del árbol se queda viejo en cuanto se insertan filas.
      void this.refreshRelationNode(table, connectionId);

      return true;
    } catch (error) {
      this._notice.set(describeError(error));
      return false;
    } finally {
      this._importing.set(false);
    }
  }

  /** Vuelve a pedir el nodo de una tabla, para que su recuento no mienta. */
  private async refreshRelationNode(table: DatabaseObject, connectionId?: string): Promise<void> {
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
    this.forgetPrimed(connectionId);
    this._roots.update((roots) => roots.filter((root) => root.connectionId !== connectionId));
    this._sessions.update((sessions) => {
      const next = new Map(sessions);
      next.delete(connectionId);

      return next;
    });
    this.forgetTransaction(connectionId);

    this._notice.set(
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
      this._notice.set(describeError(error));
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
      this._notice.set(
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

    this.forgetTransaction(connectionId);
    this.forgetPrimed(connectionId);
    this._roots.update((roots) => roots.filter((root) => root.connectionId !== connectionId));
    this.patchConnection(connectionId, { sessionId: undefined, lost: false, error: undefined });

    // El resultado en pantalla salió de la sesión anterior; conservarlo sería
    // enseñar filas que ya no se pueden ni refrescar ni editar.
    if (this._resultSource()?.connectionId === connectionId) {
      this.clearDisplayedResult();
    }

    const connected = await this.connectSaved(connectionId);

    if (connected) {
      this.patchConnection(connectionId, { lost: false });
      this._notice.set(`Conexión con «${connection.name}» restablecida.`);

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
      this._connections.update((connections) =>
        connections.filter((item) => item.id !== connectionId),
      );
    }

    this.forgetPrimed(connectionId);
    this._roots.update((roots) => roots.filter((root) => root.connectionId !== connectionId));
    this._sessions.update((sessions) => {
      const next = new Map(sessions);
      next.delete(connectionId);
      return next;
    });

    // Cerrar la conexión deshace lo que no estuviera confirmado —lo hace el
    // proceso local al soltar la sesión—, así que aquí no queda transacción de
    // la que hablar. Quien avisa antes de llegar hasta aquí es la interfaz.
    this.forgetTransaction(connectionId);

    if (this._activeConnectionId() === connectionId) {
      this._activeConnectionId.set(this._connections().find((item) => item.sessionId)?.id ?? null);
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

  /** Guarda el perfil en la base local; la contraseña va al almacén del sistema. */
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

      return saved;
    } catch (error) {
      this._notice.set(describeError(error));
      return null;
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
      this._notice.set(describeError(error));
      return [];
    }
  }

  /**
   * Crea la tabla y refresca el árbol para que aparezca.
   *
   * Devuelve las instrucciones ejecutadas, o `null` si no se aplicó nada: el
   * diálogo las enseña como confirmación de lo que acaba de ocurrir.
   */
  async createTable(
    connectionId: string,
    design: TableDesign,
  ): Promise<readonly string[] | null> {
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

    await this.loadDatabases(connectionId, connection.sessionId);
    void this.primeSchemaIndexAsync(connectionId, database ?? connection.database);
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
    connectionId = this.activeConnection()?.id,
    database = this.activeDatabase() ?? undefined,
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
    connectionId = this.activeConnection()?.id,
    database = this.activeDatabase() ?? undefined,
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

  /** Obtiene el DDL de una vista o procedimiento y lo abre sin ejecutarlo. */
  async openDefinition(node: ExplorerNode): Promise<void> {
    if (node.kind !== 'view' && node.kind !== 'procedure') {
      return;
    }

    const connection = this.findConnection(node.connectionId);

    if (!connection?.sessionId) {
      this._notice.set('La conexión de este objeto no está abierta.');
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
      this._notice.set(describeError(error));
    }
  }

  private async loadDatabases(connectionId: string, sessionId: string): Promise<void> {
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
      if (this.noteSessionLoss(entry.connectionId, error)) {
        return;
      }

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
  private async primeSchemaIndexAsync(connectionId: string, database: string): Promise<void> {
    const key = WorkspaceStore.primedKey(connectionId, database);
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

      for (const schema of schemas.slice(0, WorkspaceStore.PreloadedSchemaLimit)) {
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
    this.updateTabs((tabs) => tabs.map((tab) => ({ ...tab, active: tab.id === id })));
    this.clearDisplayedResult();
  }

  closeTab(id: string): void {
    this.updateTabs((tabs) => {
      const remaining = tabs.filter((tab) => tab.id !== id);

      if (remaining.length > 0 && !remaining.some((tab) => tab.active)) {
        return remaining.map((tab, index) => ({ ...tab, active: index === 0 }));
      }

      return remaining;
    });
    this.clearDisplayedResult();
  }

  createTab(
    sql = '',
    sourceTable?: DatabaseObject,
    connectionId: string | undefined = this.activeTab()?.connectionId ??
      this._activeConnectionId() ??
      undefined,
    title?: string,
    database: string | undefined = this.activeTab()?.database,
  ): void {
    tabCounter++;

    this.updateTabs((tabs) => [
      ...tabs.map((tab) => ({ ...tab, active: false })),
      {
        id: `q${tabCounter}`,
        title: title ?? `Query ${tabCounter}`,
        active: true,
        dirty: false,
        sql,
        connectionId,
        database,
        sourceTable,
      },
    ]);

    // Cambiar de pestaña cambia lo que hay en la cuadrícula: los cambios
    // pendientes de la anterior no pueden seguir vivos.
    this.clearDisplayedResult();
  }

  openSqlFile(fileName: string, sql: string, documentId?: string): void {
    this.createTab(sql, undefined, undefined, fileName, undefined);
    this.updateTabs((tabs) =>
      tabs.map((tab) =>
        tab.active ? { ...tab, fileName, documentId: documentId || undefined } : tab,
      ),
    );
  }

  updateSql(sql: string): void {
    this.updateTabs((tabs) =>
      tabs.map((tab) => (tab.active ? { ...tab, sql, dirty: true, sourceTable: undefined } : tab)),
    );
    this._pendingRejection.set(null);
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
      this._notice.set('No hay ninguna conexión abierta.');
      return null;
    }

    const sql = sqlOverride ?? tab?.sql ?? '';

    if (!sql.trim()) {
      this._notice.set('No hay ninguna instrucción que ejecutar.');
      return null;
    }

    this._running.set(true);
    this._canceling.set(false);
    this._pendingRejection.set(null);
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
          database: tab?.database,
          maxRows: this._maxRows(),
          timeoutSeconds: this._timeoutSeconds(),
          confirmDestructive,
        }),
      );

      if (this.activeTab()?.id === tabId && this.activeTab()?.sql === tabSql) {
        this._result.set(result);
        this._resultSource.set({
          tabId: tabId ?? null,
          connectionId: connection.id,
          database: tab?.database,
          sql,
          title: tab?.title ?? 'druse',
        });
      } else {
        return null;
      }

      this._sessions.update((sessions) => {
        const current = sessions.get(connection.id);

        if (!current) {
          return sessions;
        }

        const next = new Map(sessions);
        next.set(connection.id, { ...current, lastDurationMs: result.durationMs });
        return next;
      });

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
          this._pendingRejection.set({
            value: rejection,
            operation: 'execute',
            tabId: tab.id,
            connectionId: connection.id,
            sql,
          });
        }
      } else if (!this.noteSessionLoss(connection.id, error)) {
        if (this.activeTab()?.id === tabId && this.activeTab()?.sql === tabSql) {
          this._notice.set(describeError(error));
        }
      }

      return null;
    } finally {
      this._running.set(false);
      this._canceling.set(false);
      this._currentExecutionId.set(null);
    }
  }

  /** Confirma exactamente la operación que el servidor rechazó. */
  async confirmAndExecute(): Promise<QueryResult | null> {
    const pending = this._pendingRejection();
    const tab = this.activeTab();

    if (!pending || tab?.id !== pending.tabId || tab.connectionId !== pending.connectionId) {
      this._pendingRejection.set(null);
      return null;
    }

    this._pendingRejection.set(null);

    if (pending.operation === 'export' && pending.format) {
      await this.export(pending.format, true, pending.sql);
      return null;
    } else {
      return await this.execute(pending.sql, true);
    }
  }

  dismissRejection(): void {
    this._pendingRejection.set(null);
  }

  dismissNotice(): void {
    this._notice.set(null);
  }

  async cancel(): Promise<void> {
    const executionId = this._currentExecutionId();

    if (!executionId || this._canceling()) {
      return;
    }

    this._canceling.set(true);

    try {
      await firstValueFrom(this._gateway.cancelQuery(executionId));
    } catch {
      // Si ya había terminado, no hay nada que cancelar.
      this._canceling.set(false);
    }
  }

  // --- Utilidades privadas ---------------------------------------------------

  private findConnection(id: string): ConnectionSummary | undefined {
    return this._connections().find((connection) => connection.id === id);
  }

  private setSession(connectionId: string, session: SessionStatus): void {
    this._sessions.update((sessions) => new Map(sessions).set(connectionId, session));
  }

  private activateConnection(connectionId: string): void {
    this._activeConnectionId.set(connectionId);
    this.updateTabs((tabs) =>
      tabs.map((tab) => (tab.active && !tab.connectionId ? { ...tab, connectionId } : tab)),
    );
  }

  private clearDisplayedResult(): void {
    this._result.set(null);
    this._resultSource.set(null);
    this._pendingRejection.set(null);
    this.discardEdits();
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
    badge: object.approximateRowCount?.toLocaleString('es'),
    hint: object.kind === 'column' ? object.dataType : undefined,
    source: object,
    connectionId: entry.connectionId,
  };
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

/**
 * Qué decirle al usuario cuando algo falla.
 *
 * Nunca se muestra el objeto de error completo: puede traer cabeceras, cuerpos y
 * rutas internas que no aportan al usuario (plan §12).
 *
 * Y el número de un código HTTP tampoco significa nada para quien está
 * consultando una base de datos: «502» no dice qué pasó ni qué hacer. Cada caso
 * se cuenta con palabras y, cuando se puede, con el siguiente paso. El código se
 * conserva al final entre paréntesis, pequeño y sin protagonismo: no le sirve al
 * usuario, pero es lo primero que hace falta el día que tenga que contarle el
 * problema a alguien.
 */
function describeError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Druse encontró un problema inesperado. Si vuelve a ocurrir, reinicia la aplicación.';
  }

  const body = error.error;

  // Un fallo de validación sabe exactamente qué campo está mal, así que se
  // cuenta campo por campo en lugar de resumirlo en un código.
  const validation = validationMessages(body?.errors);

  if (validation.length > 0) {
    return `Revisa los datos enviados: ${validation.join(' ')}`;
  }

  // Cuando el servidor explica el motivo, se enseña tal cual: sus mensajes ya
  // están escritos para leerse, y son más concretos que cualquier traducción
  // que se pudiera hacer aquí a partir del código.
  const message = body?.message ?? body?.detail;

  if (typeof message === 'string' && message.trim().length > 0) {
    return message;
  }

  return `${explainStatus(error.status)} (${error.status})`;
}

/**
 * El fallo es que la sesión ya no existe en el proceso local.
 *
 * Pasa más de lo que parece: el servidor cierra por inactividad, se cae la red,
 * el proceso de la API se reinicia. Distinguirlo de cualquier otro 404 es lo que
 * permite ofrecer «Reconectar» en vez de soltar un mensaje que no dice qué hacer.
 */
function isSessionLost(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 404) {
    return false;
  }

  const message = error.error?.message;

  return typeof message === 'string' && message.includes('no está abierta');
}

/** Lo que significa cada código, dicho como se lo contarías a alguien. */
function explainStatus(status: number): string {
  switch (status) {
    // Angular usa el 0 cuando la petición ni siquiera llegó a salir.
    case 0:
      return 'Druse no obtuvo respuesta de su propio motor. Comprueba que la aplicación siga abierta y vuelve a intentarlo.';

    case 400:
      return 'La solicitud contiene datos incompletos o con un formato incorrecto.';

    case 401:
    case 403:
      return 'Esta ventana perdió el permiso para hablar con el motor de Druse. Cierra la aplicación y vuelve a abrirla.';

    case 404:
      return 'Eso ya no existe. Es probable que la conexión se haya cerrado; vuelve a abrirla y repite la operación.';

    case 408:
      return 'La operación tardó demasiado y se cortó. Prueba otra vez, o con menos datos.';

    case 409:
      return 'La operación no se aplicó porque algo había cambiado mientras tanto. Actualiza y vuelve a intentarlo.';

    case 413:
      return 'El archivo es demasiado grande para procesarlo de una vez.';

    case 428:
      return 'Falta una contraseña para abrir esta conexión.';

    case 500:
      return 'Algo falló dentro de Druse mientras atendía la petición. No se aplicó ningún cambio.';

    // 502, 503 y 504 significan lo mismo desde aquí: el proceso que hace el
    // trabajo no está atendiendo. Es lo que se ve si se cerró o si aún arranca.
    case 502:
    case 503:
    case 504:
      return 'El motor de Druse no está respondiendo: puede que se haya cerrado o que todavía esté arrancando. Espera unos segundos y, si sigue igual, reinicia la aplicación.';

    default:
      return status >= 500
        ? 'El motor de Druse falló al atender la petición.'
        : 'Druse no pudo completar la operación.';
  }
}

function validationMessages(errors: unknown): string[] {
  if (!errors || typeof errors !== 'object') {
    return [];
  }

  const messages = Object.entries(errors as Record<string, unknown>).flatMap(([field, value]) => {
    const known = validationFieldMessage(field);

    if (known) {
      return [known];
    }

    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((message): message is string => typeof message === 'string')
      .map((message) => {
        if (/required/i.test(message)) {
          return 'Falta un dato obligatorio.';
        }
        if (/could not be converted|invalid/i.test(message)) {
          return 'Uno de los valores tiene un formato incorrecto.';
        }

        return message;
      });
  });

  return [...new Set(messages)];
}

function validationFieldMessage(field: string): string | null {
  const normalized = field.toLowerCase();

  if (normalized.endsWith('.name')) {
    return 'El nombre de la conexión es obligatorio.';
  }
  if (normalized.endsWith('.host')) {
    return 'El servidor es obligatorio.';
  }
  if (normalized.endsWith('.port')) {
    return 'El puerto debe ser un número entre 1 y 65535.';
  }
  if (normalized.endsWith('.database')) {
    return 'La base de datos es obligatoria.';
  }
  if (normalized.endsWith('.username')) {
    return 'El usuario es obligatorio.';
  }

  return null;
}

function describeVersion(engine: string, serverVersion: string): string {
  const name =
    engine === 'postgresql' ? 'PostgreSQL' : engine === 'sqlserver' ? 'SQL Server' : 'MySQL';

  // La versión llega como «18.0.0»; en la barra de estado basta la mayor.
  const major = serverVersion.split('.')[0];

  return major ? `${name} ${major}` : name;
}
