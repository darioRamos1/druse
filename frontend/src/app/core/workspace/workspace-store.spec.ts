import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import {
  ApplicationGateway,
  ConnectRequest,
  ExecuteQueryRequest,
  ExportRequest,
  ImportPreview,
  RowDeleteRequest,
  RowEditRequest,
  RowEditResult,
  StoredEditorTab,
  SaveConnectionRequest,
  TransactionState,
} from '../application-gateway/application-gateway';
import {
  ConnectionForm,
  DatabaseColumn,
  DatabaseObject,
  QueryHistoryEntry,
  QueryResult,
  RoutineSignature,
  SavedConnection,
  SecretStoreStatus,
  SessionInfo,
  TestTunnelResult,
} from '../../shared/models/workspace';
import { FileSaveService } from '../files/file-save.service';
import { UpdateService } from '../update/update.service';
import { WorkspaceStore } from './workspace-store';

const form: ConnectionForm = {
  name: 'Pruebas',
  engine: 'postgresql',
  host: '127.0.0.1',
  port: 5432,
  database: 'druse_test',
  username: 'postgres',
  password: 'secreta',
  authentication: 'password',
  sslMode: 'prefer',
  readOnly: false,
  environment: 'development',
  // Sin guardar: las pruebas de conexión no deben tocar la persistencia.
  save: false,
  storePassword: false,
};

const savedProfile: SavedConnection = {
  id: 'perfil-1',
  name: 'Guardada',
  engine: 'postgresql',
  host: '127.0.0.1',
  port: 5432,
  database: 'druse_test',
  username: 'postgres',
  authentication: 'password',
  sslMode: 'prefer',
  environment: 'development',
  readOnly: false,
  hasStoredPassword: true,
};

const session: SessionInfo = {
  sessionId: 'sesion-1',
  engine: 'postgresql',
  serverVersion: '18.0.0',
  database: 'druse_test',
  readOnly: false,
};

const databases: DatabaseObject[] = [
  { id: 'db:druse_test', name: 'druse_test', kind: 'database', hasChildren: true },
];

const schemas: DatabaseObject[] = [
  {
    id: 'schema:public',
    name: 'public',
    kind: 'schema',
    database: 'druse_test',
    schema: 'public',
    hasChildren: true,
  },
];

const folders: DatabaseObject[] = ['tables', 'views', 'functions', 'procedures'].map((id) => ({
  id: `folder:public:${id}`,
  name: id,
  kind: 'folder',
  database: 'druse_test',
  schema: 'public',
  hasChildren: true,
}));

const tables: DatabaseObject[] = [
  {
    id: 'Table:public.users',
    name: 'users',
    kind: 'table',
    database: 'druse_test',
    schema: 'public',
    hasChildren: true,
  },
];

function successfulQuery(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    executionId: 'ejecucion-1',
    state: 'succeeded',
    resultSets: [
      {
        columns: [
          { name: 'id', dataType: 'int8', kind: 'number', width: null },
          { name: 'email', dataType: 'text', kind: 'text', width: null },
        ],
        rows: [{ number: 1, values: ['1', 'ana@ejemplo.test'] }],
        totalRows: 1,
        durationMs: 5,
        truncated: false,
      },
    ],
    messages: [],
    durationMs: 5,
    ...overrides,
  };
}

/** Doble del gateway con lo justo para las pruebas. */
function closedTransaction(overrides: Partial<TransactionState> = {}): TransactionState {
  return {
    sessionId: 'sesion-1',
    isOpen: false,
    connectionName: 'Pruebas',
    database: 'druse_test',
    engine: 'postgresql',
    ddlIsReversible: true,
    idleTimeoutSeconds: 900,
    ...overrides,
  };
}

class FakeGateway implements Partial<ApplicationGateway> {
  executeCalls: ExecuteQueryRequest[] = [];
  cancelCalls: string[] = [];
  exportCalls: ExportRequest[] = [];
  closedSessions: string[] = [];
  saveCalls: SaveConnectionRequest[] = [];

  /** Lo que el servidor contesta cuando el llavero falló pero el perfil se guardó. */
  secretWarningOnSave: string | null = null;
  deletedConnections: string[] = [];
  openSavedCalls: { id: string; password?: string }[] = [];
  openShouldFail = false;
  openValidationShouldFail = false;
  savedConnectionMissingPassword = false;
  executeResult: Observable<QueryResult> = of(successfulQuery());
  savedConnections: SavedConnection[] = [];
  columnDataTypes: string[] = [];
  sessionIds: string[] = [];
  definition = 'CREATE VIEW "public"."active_users" AS SELECT 1;\n';
  definitionRequest: { sessionId: string; databaseObject: DatabaseObject } | null = null;

  exportQuery(request: ExportRequest): Observable<Blob> {
    this.exportCalls.push(request);
    return of(new Blob());
  }

  /** Lo que contesta `test-tunnel`. Se cambia en cada prueba. */
  tunnelResult: TestTunnelResult = { succeeded: true, reach: 'complete', durationMs: 12 };
  tunnelCalls: ConnectRequest[] = [];

  testTunnel(request: ConnectRequest): Observable<TestTunnelResult> {
    this.tunnelCalls.push(request);
    return of(this.tunnelResult);
  }

  /** Transacción que devuelve la API para la sesión, imitando su estado real. */
  transaction: TransactionState = closedTransaction();
  transactionCalls: string[] = [];

  getTransaction(sessionId: string): Observable<TransactionState> {
    this.transactionCalls.push(`get:${sessionId}`);
    return of(this.transaction);
  }

  beginTransaction(sessionId: string): Observable<TransactionState> {
    this.transactionCalls.push(`begin:${sessionId}`);
    this.transaction = { ...this.transaction, isOpen: true, startedAt: '2026-08-14T10:00:00Z' };

    return of(this.transaction);
  }

  /** Imita a una API que ya no tiene esa transacción abierta. */
  commitShouldFail = false;

  commitTransaction(sessionId: string): Observable<TransactionState> {
    this.transactionCalls.push(`commit:${sessionId}`);

    if (this.commitShouldFail) {
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              reason: 'notopen',
              message: 'No hay ninguna transacción abierta que confirmar.',
            },
          }),
      );
    }

    this.transaction = closedTransaction();

    return of(this.transaction);
  }

  rollbackTransaction(sessionId: string): Observable<TransactionState> {
    this.transactionCalls.push(`rollback:${sessionId}`);
    this.transaction = closedTransaction();

    return of(this.transaction);
  }

  getSavedConnections(): Observable<readonly SavedConnection[]> {
    return of(this.savedConnections);
  }

  getSecretStoreStatus(): Observable<SecretStoreStatus> {
    return of({ available: true, description: 'Almacén de prueba' });
  }

  saveConnection(request: SaveConnectionRequest): Observable<SavedConnection> {
    this.saveCalls.push(request);

    return of({
      id: request.profile.id ?? 'perfil-1',
      name: request.profile.name,
      engine: request.profile.engine,
      host: request.profile.host,
      port: request.profile.port,
      database: request.profile.database,
      username: request.profile.username,
      authentication: request.profile.authentication ?? 'password',
      sslMode: 'prefer',
      environment: 'development',
      readOnly: false,
      hasStoredPassword: request.storePassword,
      ...(this.secretWarningOnSave ? { secretWarning: this.secretWarningOnSave } : {}),
    });
  }

  deleteConnection(id: string): Observable<void> {
    this.deletedConnections.push(id);
    return of(undefined);
  }

  openSavedSession(id: string, password?: string): Observable<SessionInfo> {
    this.openSavedCalls.push({ id, password });

    return this.savedConnectionMissingPassword && !password
      ? throwError(() => new HttpErrorResponse({ status: 428, error: { requiresPassword: true } }))
      : of(session);
  }

  /** Preferencias guardadas, tal y como las devolvería la API. */
  preferences: Record<string, string> = {};

  getPreferences(): Observable<Readonly<Record<string, string>>> {
    return of(this.preferences);
  }

  setPreference(key: string, value: string): Observable<void> {
    this.preferences[key] = value;
    return of(undefined);
  }

  deleteRequests: RowDeleteRequest[] = [];
  deletePreviewRequests: RowDeleteRequest[] = [];

  previewRowDeletes(request: RowDeleteRequest): Observable<readonly string[]> {
    this.deletePreviewRequests.push(request);
    return of(request.keys.map((key) => `DELETE FROM t WHERE ${key[0].column} = ${key[0].value}`));
  }

  deleteRows(request: RowDeleteRequest): Observable<RowEditResult> {
    this.deleteRequests.push(request);
    return of({ rowsAffected: request.keys.length, durationMs: 3, statements: [] });
  }

  /** Lo que la sesión anterior dejó escrito sin ejecutar. */
  storedTabs: StoredEditorTab[] = [];
  savedTabs: StoredEditorTab[][] = [];

  getEditorTabs(): Observable<readonly StoredEditorTab[]> {
    return of(this.storedTabs);
  }

  saveEditorTabs(tabs: readonly StoredEditorTab[]): Observable<void> {
    this.savedTabs.push([...tabs]);
    return of(undefined);
  }

  getHistory(): Observable<readonly QueryHistoryEntry[]> {
    return of([]);
  }

  clearHistory(): Observable<void> {
    return of(undefined);
  }

  getEngines(): Observable<never[]> {
    return of([]);
  }

  /** Código con el que falla `openSession` cuando `openShouldFail` está activo. */
  openFailureStatus = 400;

  /** Cuerpo del fallo. Vacío imita a un servidor que no explica nada. */
  openFailureBody: unknown = { message: 'La autenticación falló.' };

  openSession(): Observable<SessionInfo> {
    if (this.openValidationShouldFail) {
      return throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              errors: {
                '$.profile.port': ['The JSON value could not be converted to System.Int32.'],
                '$.profile.database': ['The Database field is required.'],
              },
            },
          }),
      );
    }

    return this.openShouldFail
      ? throwError(
          () =>
            new HttpErrorResponse({
              status: this.openFailureStatus,
              error: this.openFailureBody,
            }),
        )
      : of({ ...session, sessionId: this.sessionIds.shift() ?? session.sessionId });
  }

  closeSession(sessionId: string): Observable<void> {
    this.closedSessions.push(sessionId);
    return of(undefined);
  }

  /** Imita al proceso local cuando la sesión ya no está abierta. */
  sessionIsGone = false;

  private lostSession(): Observable<never> {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 404,
          error: { message: "La sesión 'sesion-1' no está abierta." },
        }),
    );
  }

  /** Bases además de la de siempre, para lo que cambia de base. */
  extraDatabases: DatabaseObject[] = [];

  getDatabases(): Observable<DatabaseObject[]> {
    return of([...databases, ...this.extraDatabases]);
  }

  /**
   * Responde según el tipo de nodo, como hace el servidor de verdad.
   *
   * Antes devolvía siempre los esquemas, y eso bastaba mientras el árbol solo
   * se abría a mano. Al precalentar el catálogo hay que recorrer los tres
   * niveles, así que el doble tiene que distinguirlos.
   */
  getChildren(_sessionId: string, parent: DatabaseObject): Observable<DatabaseObject[]> {
    switch (parent.kind) {
      case 'database':
        // Cada base con su esquema: así se ve de cuál salió lo que se cargó.
        return of(
          parent.name === 'druse_test'
            ? schemas
            : [
                {
                  id: `schema:${parent.name}`,
                  name: `esquema_de_${parent.name}`,
                  kind: 'schema' as const,
                  database: parent.name,
                  schema: `esquema_de_${parent.name}`,
                  hasChildren: true,
                },
              ],
        );

      case 'schema':
        return of(folders);

      case 'folder':
        return of(parent.id.endsWith(':tables') ? tables : []);

      default:
        return of([]);
    }
  }

  /** Lo que se ha mandado a guardar, para comprobarlo. */
  rowEditRequests: RowEditRequest[] = [];

  /** Importaciones pedidas: `false` es previsualizar, `true` es escribir. */
  importCalls: boolean[] = [];
  importPreviewResult: ImportPreview = {
    mappings: [{ source: 'id', target: 'id' }],
    missingRequired: [],
    problems: [],
    rowCount: 2,
    statements: ['INSERT INTO public.users (id) VALUES (1)'],
  };

  previewImport(): Observable<ImportPreview> {
    this.importCalls.push(false);
    return of(this.importPreviewResult);
  }

  runImport(): Observable<RowEditResult> {
    this.importCalls.push(true);
    return of({ rowsAffected: 2, durationMs: 4, statements: [] });
  }

  previewRowEdits(request: RowEditRequest): Observable<readonly string[]> {
    this.rowEditRequests.push(request);
    return of([`UPDATE public.users SET email = 'nuevo@ejemplo.test' WHERE id = 1`]);
  }

  applyRowEdits(request: RowEditRequest): Observable<RowEditResult> {
    this.rowEditRequests.push(request);
    return of({ rowsAffected: 1, durationMs: 3, statements: [] });
  }

  /**
   * Las columnas se piden por aquí y no por `getChildren`: es la misma lista
   * que se ve en el árbol, pero con el tipo de cada columna, que es de lo que
   * viven el tooltip, los avisos del editor y la clave primaria de la edición.
   */
  getColumns(): Observable<DatabaseColumn[]> {
    const dataType = this.columnDataTypes.shift() ?? 'varchar(200)';

    return of([
      { name: 'id', dataType: 'int8', isNullable: false, isPrimaryKey: true, ordinal: 1 },
      {
        name: 'email',
        dataType,
        isNullable: true,
        isPrimaryKey: false,
        defaultValue: "'sin-correo'",
        ordinal: 2,
      },
      {
        name: 'creado_en',
        dataType: 'timestamp with time zone',
        inputKind: 'datetimeOffset',
        isNullable: true,
        isPrimaryKey: false,
        ordinal: 3,
      },
    ]);
  }

  getDefinition(sessionId: string, databaseObject: DatabaseObject): Observable<string> {
    this.definitionRequest = { sessionId, databaseObject };
    return of(this.definition);
  }

  signature: RoutineSignature = {
    name: 'registrar',
    schema: 'dbo',
    isFunction: false,
    parameters: [
      { name: '@entrada', dataType: 'int', direction: 'input', ordinal: 1, hasDefault: false },
      {
        name: '@salida',
        dataType: 'varchar(30)',
        direction: 'output',
        ordinal: 2,
        hasDefault: false,
      },
    ],
  };

  signatureRequest: { sessionId: string; routine: DatabaseObject } | null = null;

  getRoutineSignature(sessionId: string, routine: DatabaseObject): Observable<RoutineSignature> {
    this.signatureRequest = { sessionId, routine };
    return of(this.signature);
  }

  executeQuery(request: ExecuteQueryRequest): Observable<QueryResult> {
    if (this.sessionIsGone) {
      this.executeCalls.push(request);
      return this.lostSession();
    }

    this.executeCalls.push(request);
    return this.executeResult;
  }

  cancelQuery(executionId: string): Observable<void> {
    this.cancelCalls.push(executionId);
    return of(undefined);
  }
}

/**
 * El precalentado del catálogo no se espera al conectar —el editor debe quedar
 * usable de inmediato—, así que las pruebas que dependen de él tienen que
 * dejarlo terminar.
 */
async function esperarA(condicion: () => boolean): Promise<void> {
  for (let intento = 0; intento < 50 && !condicion(); intento++) {
    await Promise.resolve();
  }
}

describe('WorkspaceStore', () => {
  let store: WorkspaceStore;
  let gateway: FakeGateway;

  /**
   * Dejar el archivo en manos del usuario es cosa de `FileSaveService`, y tiene
   * sus propias pruebas. Aquí hace falta el doble porque el servicio de verdad
   * crea un enlace y lo pulsa: jsdom no navega, avisa —«Not implemented:
   * navigation to another Document»— y ese aviso ensuciaba cada pasada.
   */
  let archivos: { save: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    gateway = new FakeGateway();
    archivos = { save: vi.fn().mockResolvedValue({ saved: true, path: 'C:\\datos\\ventas.xlsx' }) };

    TestBed.configureTestingModule({
      providers: [
        { provide: ApplicationGateway, useValue: gateway },
        { provide: FileSaveService, useValue: archivos },
      ],
    });

    store = TestBed.inject(WorkspaceStore);
  });

  describe('conexión', () => {
    it('deja la conexión activa y carga el primer nivel', async () => {
      const connected = await store.connect(form);

      expect(connected).toBe(true);
      expect(store.connections().length).toBe(1);
      expect(store.connections()[0].state).toBe('connected');
      expect(store.explorerNodes().length).toBe(1);
      expect(store.explorerNodes()[0].label).toBe('druse_test');
    });

    it('refleja la sesión en la barra de estado', async () => {
      await store.connect(form);

      const status = store.session();

      expect(status?.connected).toBe(true);
      expect(status?.engineVersion).toBe('PostgreSQL 18');
      expect(status?.database).toBe('druse_test');
    });

    /// Todo lo que no era PostgreSQL ni SQL Server se llamaba «MySQL» en la barra
    /// de estado, Informix incluido: el nombre se escribía con un condicional de
    /// tres ramas en vez de leerlo de la lista que ya existía.
    it('la barra de estado llama a cada motor por su nombre', async () => {
      await store.connect({ ...form, engine: 'informixsqli' });

      expect(store.session()?.engineVersion).toBe('Informix 18');
    });

    it('liga la pestaña inicial a la primera conexión activada', async () => {
      await store.connect(form);

      expect(store.activeTab()?.connectionId).toBe(store.connections()[0].id);
    });

    it('seleccionar una conexión la activa sin plegar su árbol', async () => {
      await store.connect(form);
      const connection = store.connections()[0];

      store.selectConnection(connection.id);

      expect(store.activeConnection()?.id).toBe(connection.id);
      expect(store.connections()[0].expanded).toBe(true);
    });

    it('marca la conexión con error y explica el motivo', async () => {
      gateway.openShouldFail = true;

      const connected = await store.connect(form);

      expect(connected).toBe(false);
      expect(store.connections()[0].state).toBe('error');
      expect(store.notice()).toBe('La autenticación falló.');
    });

    it('traduce un fallo sin explicación a algo que se pueda leer', async () => {
      gateway.openShouldFail = true;
      // 502 es lo que devuelve el proxy cuando el proceso local no responde, y
      // llega sin cuerpo: es el caso donde antes se enseñaba el número pelado.
      gateway.openFailureStatus = 502;
      gateway.openFailureBody = null;

      await store.connect(form);

      const notice = store.notice() ?? '';

      expect(notice).toContain('no está respondiendo');
      expect(notice).toContain('reinicia la aplicación');
      // El código se conserva al final: no le sirve al usuario, pero sí a quien
      // tenga que diagnosticar lo que le pasó.
      expect(notice).toContain('(502)');
      expect(notice).not.toContain('La API respondió');
    });

    it('cuando el servidor explica el motivo, se enseña su mensaje', async () => {
      gateway.openShouldFail = true;
      gateway.openFailureStatus = 400;
      gateway.openFailureBody = { message: 'La autenticación falló.' };

      await store.connect(form);

      // El mensaje del servidor es más concreto que cualquier traducción por
      // código, así que gana y viaja sin número detrás.
      expect(store.notice()).toBe('La autenticación falló.');
    });

    it('traduce los errores de validación enviados por la API', async () => {
      gateway.openValidationShouldFail = true;

      await store.connect({ ...form, save: false });

      expect(store.notice()).toBe(
        'Revisa los datos enviados: El puerto debe ser un número entre 1 y 65535. La base de datos es obligatoria.',
      );
    });

    it('al desconectar cierra la sesión y limpia el árbol', async () => {
      await store.connect(form);
      const id = store.connections()[0].id;

      await store.disconnect(id);

      expect(gateway.closedSessions).toEqual(['sesion-1']);
      expect(store.connections()).toEqual([]);
      expect(store.explorerNodes()).toEqual([]);
    });
  });

  describe('conexiones guardadas', () => {
    it('restaura los perfiles guardados como desconectados', async () => {
      gateway.savedConnections = [
        {
          id: 'perfil-1',
          name: 'Producción',
          engine: 'postgresql',
          host: 'db.interno',
          port: 5432,
          database: 'app',
          username: 'lector',
          authentication: 'password',
          sslMode: 'prefer',
          environment: 'production',
          readOnly: true,
          hasStoredPassword: true,
        },
      ];

      await store.loadSavedConnections();

      const connection = store.connections()[0];

      // Restaurar no debe abrir sesiones: despertaría servidores que el usuario
      // no pensaba tocar.
      expect(connection.state).toBe('disconnected');
      expect(connection.saved).toBe(true);
      expect(connection.environment).toBe('production');
      expect(connection.readOnly).toBe(true);
    });

    it('guarda el perfil al conectar si se pide', async () => {
      await store.connect({ ...form, save: true, storePassword: true });

      expect(gateway.saveCalls.length).toBe(1);
      expect(gateway.saveCalls[0].storePassword).toBe(true);
      expect(gateway.saveCalls[0].password).toBe('secreta');
    });

    /**
     * El perfil va a la base local y la contraseña al llavero del sistema: son
     * dos escrituras, y la segunda puede fallar sola. Cuando pasa, la conexión
     * existe y funciona, así que no es un error; lo que no puede es quedarse
     * callado, porque el usuario cree que su contraseña quedó recordada.
     */
    it('avisa cuando el perfil se guardó pero la contraseña no', async () => {
      gateway.secretWarningOnSave =
        'No se pudo guardar la contraseña en Almacén de prueba; se pedirá cuando haga falta.';

      const saved = await store.saveConnection({ ...form, storePassword: true });

      expect(saved).toBe(true);
      expect(store.notice()).toContain('No se pudo guardar la contraseña');
    });

    it('no guarda nada si el usuario no lo pide', async () => {
      await store.connect(form);

      expect(gateway.saveCalls).toEqual([]);
    });

    it('abre sesión con un perfil guardado sin reenviar la contraseña', async () => {
      gateway.savedConnections = [
        {
          id: 'perfil-1',
          name: 'Guardada',
          engine: 'postgresql',
          host: '127.0.0.1',
          port: 5432,
          database: 'druse_test',
          username: 'postgres',
          authentication: 'password',
          sslMode: 'prefer',
          environment: 'development',
          readOnly: false,
          hasStoredPassword: true,
        },
      ];

      await store.loadSavedConnections();
      const connected = await store.connectSaved('perfil-1');

      expect(connected).toBe(true);
      expect(gateway.openSavedCalls[0].password).toBeUndefined();
      expect(store.connections()[0].state).toBe('connected');
    });

    it('si no hay contraseña guardada, no conecta y deja el perfil intacto', async () => {
      gateway.savedConnections = [
        {
          id: 'perfil-1',
          name: 'Sin clave',
          engine: 'postgresql',
          host: '127.0.0.1',
          port: 5432,
          database: 'druse_test',
          username: 'postgres',
          authentication: 'password',
          sslMode: 'prefer',
          environment: 'development',
          readOnly: false,
          hasStoredPassword: false,
        },
      ];
      gateway.savedConnectionMissingPassword = true;

      await store.loadSavedConnections();
      const connected = await store.connectSaved('perfil-1');

      expect(connected).toBe(false);
      expect(store.connections()[0].state).toBe('disconnected');
      // Falta la contraseña, no es un error que deba alarmar.
      expect(store.connections()[0].error).toBeUndefined();
    });

    it('desconectar conserva el perfil guardado en la lista', async () => {
      await store.connect({ ...form, save: true, storePassword: true });
      const id = store.connections()[0].id;

      await store.disconnect(id);

      expect(store.connections().length).toBe(1);
      expect(store.connections()[0].state).toBe('disconnected');
      expect(gateway.deletedConnections).toEqual([]);
    });

    it('olvidar un perfil lo borra del servidor y de la lista', async () => {
      await store.connect({ ...form, save: true, storePassword: true });
      const id = store.connections()[0].id;

      await store.forget(id);

      expect(gateway.deletedConnections).toEqual([id]);
      expect(store.connections()).toEqual([]);
    });

    it('una conexión sin guardar desaparece al desconectar', async () => {
      await store.connect(form);
      const id = store.connections()[0].id;

      await store.disconnect(id);

      expect(store.connections()).toEqual([]);
    });
  });

  describe('catálogo para el autocompletado', () => {
    it('conocer las tablas no exige abrir el árbol', async () => {
      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      const index = store.schemaIndex();

      // Nadie ha expandido nada: el editor ya puede sugerir.
      expect(index.schemas).toContain('public');
      expect(index.relations.map((relation) => relation.qualified)).toContain('public.users');
      expect(store.explorerNodes().length).toBe(1);
    });

    /**
     * Cambiar de base tiene que traer el catálogo de la base nueva.
     *
     * Lo precalentado se recordaba **por conexión**, así que la segunda base de
     * la misma conexión se daba por hecha y nunca se pedía: el editor se
     * quedaba sin esquemas ni tablas y no había forma de recuperarlo salvo
     * reconectar.
     */
    it('cambiar de base precalienta el catálogo de la nueva', async () => {
      gateway.extraDatabases = [
        { id: 'db:otra', name: 'otra', kind: 'database', hasChildren: true },
      ];

      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      store.useDatabase('otra');
      await esperarA(() => store.schemaIndex().schemas.includes('esquema_de_otra'));

      // El árbol conserva las dos bases, pero Monaco solo recibe la activa.
      expect(store.searchableSchemas().map((node) => node.label)).toContain('public');
      expect(store.schemaIndex().schemas).not.toContain('public');
      expect(store.schemaIndex().schemas).toEqual(['esquema_de_otra']);
    });

    it('vuelve a precalentar al reconectar la misma conexión', async () => {
      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      await store.disconnect(store.connections()[0].id);
      expect(store.schemaIndex().relations.length).toBe(0);

      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      expect(store.schemaIndex().relations.map((relation) => relation.qualified)).toContain(
        'public.users',
      );
    });

    it('el precalentado no despliega el árbol', async () => {
      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      // Traer los hijos y mostrarlos son cosas distintas: el usuario no ha
      // pedido ver nada.
      expect(store.explorerNodes().map((node) => node.label)).toEqual(['druse_test']);
      expect(store.searchableSchemas().map((node) => node.label)).toContain('public');
      expect(store.searchableRelations().map((node) => node.label)).toContain('users');
    });

    it('cargar las columnas de una tabla no la despliega en el explorador', async () => {
      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      const columnas = await store.ensureColumnsAsync('public', 'users');

      // Llegan con su tipo, que es lo que el editor necesita para el tooltip.
      expect(columnas.map((columna) => columna.name)).toEqual(['id', 'email', 'creado_en']);
      expect(columnas[0].dataType).toBe('int8');
      expect(columnas[0].isPrimaryKey).toBe(true);
      expect(columnas[1].defaultValue).toBe("'sin-correo'");

      // Y con su clase de entrada: es lo que hace que el compositor pida la
      // fecha con un calendario en vez de con un campo de texto.
      expect(columnas[2].inputKind).toBe('datetimeOffset');

      // Traer las columnas no es lo mismo que desplegar el nodo.
      expect(store.explorerNodes().length).toBe(1);
    });

    it('conserva el tipo completo al convertir una columna en nodo del explorador', async () => {
      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      for (const label of ['druse_test', 'public', 'tables', 'users']) {
        const node = store.explorerNodes().find((candidate) => candidate.label === label);
        await store.toggleNode(node!.id);
      }

      const email = store.explorerNodes().find((node) => node.label === 'email');

      expect(email?.kind).toBe('column');
      expect(email?.hint).toBe('varchar(200)');
      expect(email?.source.dataType).toBe('varchar(200)');
    });

    it('no comparte columnas entre conexiones con la misma tabla', async () => {
      await store.connect(form);
      const postgresqlId = store.connections()[0].id;

      await store.connect({ ...form, name: 'MySQL', engine: 'mysql' });
      const mysqlId = store.connections().find((connection) => connection.engine === 'mysql')!.id;

      const abrir = async (connectionId: string, label: string) => {
        const node = store
          .explorerNodes()
          .find(
            (candidate) => candidate.connectionId === connectionId && candidate.label === label,
          );
        await store.toggleNode(node!.id);
      };

      for (const connectionId of [postgresqlId, mysqlId]) {
        await abrir(connectionId, 'druse_test');
        await abrir(connectionId, 'public');
        await abrir(connectionId, 'tables');
      }

      gateway.columnDataTypes = ['varchar(200)', 'varchar(255)'];

      const postgresql = await store.ensureColumnsAsync(
        'public',
        'users',
        postgresqlId,
        'druse_test',
      );
      const mysql = await store.ensureColumnsAsync('public', 'users', mysqlId, 'druse_test');

      expect(postgresql.find((column) => column.name === 'email')?.dataType).toBe('varchar(200)');
      expect(mysql.find((column) => column.name === 'email')?.dataType).toBe('varchar(255)');
    });
  });

  describe('edición de filas', () => {
    /** Abre una pestaña desde la tabla `users`, que es lo que permite editar. */
    async function abrirTabla(): Promise<void> {
      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      const abrir = async (etiqueta: string) => {
        const nodo = store.explorerNodes().find((node) => node.label === etiqueta);
        await store.toggleNode(nodo!.id);
      };

      await abrir('druse_test');
      await abrir('public');
      await abrir('tables');

      const tabla = store.explorerNodes().find((node) => node.label === 'users');
      store.openSelectFor(tabla!, 'SELECT * FROM public.users;');

      // Editable exige las dos cosas: saber la clave primaria de la tabla y
      // tener un resultado en pantalla donde esa clave aparezca.
      await store.execute();
      await esperarA(() => !!store.editableTable());
    }

    describe('borrado de filas', () => {
      it('sin filas señaladas no se pide nada', async () => {
        await abrirTabla();

        await store.prepareDelete();

        expect(gateway.deletePreviewRequests).toHaveLength(0);
        expect(store.deletePreview()).toBeNull();
      });

      it('señala la fila y enseña el DELETE antes de borrar', async () => {
        await abrirTabla();

        store.toggleRowSelection(1);
        await store.prepareDelete();

        // La clave sale de la fila que el usuario tiene delante, igual que al
        // editar: es lo que hace que se borre esa fila y no otra.
        const enviado = gateway.deletePreviewRequests[0];

        expect(enviado.keys).toEqual([[{ column: 'id', value: '1' }]]);
        expect(enviado.confirmed).toBe(false);
        expect(store.deletePreview()?.[0]).toContain('DELETE FROM');
      });

      /** Sin confirmación el servidor se niega; el store no debe pedirla por su cuenta. */
      it('borrar manda la confirmación y limpia la selección', async () => {
        await abrirTabla();

        store.toggleRowSelection(1);
        await store.prepareDelete();
        await store.deleteSelectedRows();

        expect(gateway.deleteRequests[0].confirmed).toBe(true);
        expect(store.selectedRows()).toEqual([]);
        expect(store.deletePreview()).toBeNull();
        expect(store.notice()).toContain('1 fila borrada');
      });

      it('la marca se pone y se quita sobre la misma fila', async () => {
        await abrirTabla();

        store.toggleRowSelection(1);
        expect(store.selectedRows()).toEqual([1]);

        store.toggleRowSelection(1);
        expect(store.selectedRows()).toEqual([]);
      });

      it('volver atrás conserva la selección y descarta el SQL', async () => {
        await abrirTabla();

        store.toggleRowSelection(1);
        await store.prepareDelete();
        store.cancelDeletePreview();

        expect(store.deletePreview()).toBeNull();
        expect(store.selectedRows()).toEqual([1]);
      });
    });

    it('una consulta escrita a mano no es editable', async () => {
      await store.connect(form);
      await store.execute();

      // Sin saber de qué tabla vienen las filas no hay a dónde escribir.
      expect(store.editableTable()).toBeNull();
    });

    it('una pestaña abierta desde una tabla sí lo es', async () => {
      await abrirTabla();

      expect(store.editableTable()?.table.name).toBe('users');
      expect(store.editableTable()?.keyColumns).toEqual(['id']);
    });

    it('manda la clave que se leyó, no la que se escribió', async () => {
      await abrirTabla();

      store.editCell({ row: 1, column: 'email', value: 'nuevo@ejemplo.test' });
      await store.prepareEdits();

      const enviado = gateway.rowEditRequests[0];

      // La clave sale de la fila que el usuario tiene delante: es lo que hace
      // que el UPDATE apunte a esa fila y no a otra.
      expect(enviado.edits[0].key).toEqual([{ column: 'id', value: '1' }]);
      expect(enviado.edits[0].changes).toEqual([{ column: 'email', value: 'nuevo@ejemplo.test' }]);
      // Previsualizar nunca confirma.
      expect(enviado.confirmed).toBe(false);
    });

    it('guardar sí confirma, y limpia los cambios pendientes', async () => {
      await abrirTabla();

      store.editCell({ row: 1, column: 'email', value: 'nuevo@ejemplo.test' });
      await store.saveEdits();

      expect(gateway.rowEditRequests.at(-1)?.confirmed).toBe(true);
      expect(store.edits()).toEqual([]);
    });

    it('descartar no manda nada', async () => {
      await abrirTabla();

      store.editCell({ row: 1, column: 'email', value: 'da igual' });
      store.discardEdits();

      expect(store.edits()).toEqual([]);
      expect(gateway.rowEditRequests).toEqual([]);
    });

    it('cambiar de pestaña no arrastra los cambios pendientes', async () => {
      await abrirTabla();

      store.editCell({ row: 1, column: 'email', value: 'da igual' });
      store.createTab('SELECT 1');

      // Lo que hay en la cuadrícula ya es otra cosa; conservarlos sería
      // guardarlos luego contra la tabla equivocada.
      expect(store.edits()).toEqual([]);
      expect(store.result()).toBeNull();
    });

    it('modificar el SQL invalida el origen editable de la pestaña', async () => {
      await abrirTabla();

      expect(store.editableTable()).not.toBeNull();

      store.updateSql('SELECT * FROM public.otra_tabla');

      expect(store.activeTab()?.sourceTable).toBeUndefined();
      expect(store.editableTable()).toBeNull();
    });
  });

  describe('importación', () => {
    const archivo = new File(['id\n1\n'], 'datos.csv', { type: 'text/csv' });
    const opciones = { hasHeaders: true, delimiter: ',', encoding: 'utf8bom', nullText: '' };
    const tabla = tables[0];

    it('previsualizar no escribe', async () => {
      await store.connect(form);
      await store.previewImport(tabla, archivo, opciones);

      expect(gateway.importCalls).toEqual([false]);
      expect(store.importPreview()?.rowCount).toBe(2);
    });

    it('importar avisa de cuántas filas entraron', async () => {
      await store.connect(form);
      await store.runImport(tabla, archivo, opciones);

      expect(gateway.importCalls).toEqual([true]);
      expect(store.notice()).toContain('2 filas importadas');
    });

    it('sin conexión no se importa nada', async () => {
      await store.runImport(tabla, archivo, opciones);

      // El archivo ni se llega a mandar: no hay a dónde.
      expect(gateway.importCalls).toEqual([]);
      expect(store.notice()).toBe('No hay ninguna conexión abierta.');
    });

    it('cerrar el diálogo olvida lo previsualizado', async () => {
      await store.connect(form);
      await store.previewImport(tabla, archivo, opciones);

      store.clearImportPreview();

      // Si quedara, al reabrir el diálogo con otro archivo se estaría mirando
      // el resumen del anterior.
      expect(store.importPreview()).toBeNull();
    });
  });

  describe('explorador', () => {
    it('expandir lo ya precalentado no pide nada al servidor', async () => {
      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      const spy = vi.spyOn(gateway, 'getChildren');
      const nodeId = store.explorerNodes()[0].id;
      await store.toggleNode(nodeId);

      expect(store.explorerNodes().length).toBe(2);
      expect(store.explorerNodes()[1].label).toBe('public');

      // El catálogo ya estaba en memoria: abrir el árbol es instantáneo.
      expect(spy).not.toHaveBeenCalled();
    });

    it('carga los hijos al expandir lo que no se precalentó, y no los vuelve a pedir', async () => {
      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      // Las columnas de una tabla no entran en el precalentado: son el caso que
      // sigue cargándose al abrir el nodo. Hay que bajar hasta ella.
      const abrir = async (etiqueta: string) => {
        const nodo = store.explorerNodes().find((node) => node.label === etiqueta);
        await store.toggleNode(nodo!.id);
      };

      await abrir('druse_test');
      await abrir('public');
      await abrir('tables');

      const tabla = store.explorerNodes().find((node) => node.label === 'users');
      // Una tabla pide `getColumns`, que trae lo mismo que el árbol enseña y
      // además el tipo de cada columna.
      const spy = vi.spyOn(gateway, 'getColumns');

      await store.toggleNode(tabla!.id);
      expect(spy).toHaveBeenCalledTimes(1);

      // Plegar y volver a desplegar no debe repetir la petición.
      await store.toggleNode(tabla!.id);
      await store.toggleNode(tabla!.id);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('al plegar oculta los descendientes', async () => {
      await store.connect(form);
      const nodeId = store.explorerNodes()[0].id;

      await store.toggleNode(nodeId);
      expect(store.explorerNodes().length).toBe(2);

      await store.toggleNode(nodeId);
      expect(store.explorerNodes().length).toBe(1);
    });

    it('actualizar un nodo vuelve a pedir sus hijos', async () => {
      await store.connect(form);
      await esperarA(() => store.schemaIndex().relations.length > 0);

      const nodeId = store.explorerNodes()[0].id;
      await store.toggleNode(nodeId);

      const spy = vi.spyOn(gateway, 'getChildren');
      await store.refreshNode(nodeId);

      // Actualizar es la forma de decir «esto ha cambiado», así que sí se pide.
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('ejecución', () => {
    it('no ejecuta sin conexión abierta', async () => {
      store.updateSql('SELECT 1');

      await store.execute();

      expect(gateway.executeCalls).toEqual([]);
      expect(store.notice()).toContain('No hay ninguna conexión');
    });

    it('no ejecuta si no hay nada escrito', async () => {
      await store.connect(form);

      await store.execute();

      expect(gateway.executeCalls).toEqual([]);
      expect(store.notice()).toContain('ninguna instrucción');
    });

    it('ejecuta el sql de la pestaña activa', async () => {
      await store.connect(form);
      store.updateSql('SELECT 1');

      await store.execute();

      expect(gateway.executeCalls[0].sql).toBe('SELECT 1');
      expect(gateway.executeCalls[0].sessionId).toBe('sesion-1');
      expect(store.resultSet()?.rows.length).toBe(1);
    });

    it('la vista previa limita filas sin reemplazar el resultado principal', async () => {
      await store.connect(form);

      const result = await store.previewQuery(
        store.connections()[0].id,
        'druse_test',
        'SELECT 1',
        'preview-1',
      );

      expect(result?.state).toBe('succeeded');
      expect(gateway.executeCalls.at(-1)).toMatchObject({
        executionId: 'preview-1',
        sql: 'SELECT 1',
        database: 'druse_test',
        maxRows: 10,
      });
      expect(store.result()).toBeNull();

      await store.cancelExecution('preview-1');
      expect(gateway.cancelCalls).toContain('preview-1');
    });

    it('cancela por el identificador de la ejecución y evita solicitudes duplicadas', async () => {
      await store.connect(form);
      store.updateSql('SELECT pg_sleep(30)');

      let finish!: (result: QueryResult) => void;
      gateway.executeResult = new Observable<QueryResult>((subscriber) => {
        finish = (result) => subscriber.next(result);
      });

      const execution = store.execute();
      await store.cancel();

      expect(store.running()).toBe(true);
      expect(store.canceling()).toBe(true);
      expect(gateway.cancelCalls).toEqual([gateway.executeCalls[0].executionId]);

      await store.cancel();
      expect(gateway.cancelCalls).toHaveLength(1);

      finish(successfulQuery({ state: 'canceled', resultSets: [] }));
      await execution;

      expect(store.running()).toBe(false);
      expect(store.canceling()).toBe(false);
    });

    it('ejecuta solo la selección sin tocar la pestaña', async () => {
      await store.connect(form);
      store.updateSql('SELECT 1;\nSELECT 2;');

      await store.execute('SELECT 2');

      expect(gateway.executeCalls[0].sql).toBe('SELECT 2');
      expect(store.activeTab()?.sql).toBe('SELECT 1;\nSELECT 2;');
    });

    it('conserva los espacios del SQL enviado para ubicar errores', async () => {
      await store.connect(form);
      store.updateSql('\n  SELECT * FROM');

      await store.execute();

      expect(gateway.executeCalls[0].sql).toBe('\n  SELECT * FROM');
    });

    /**
     * Cuántas filas se traen es un ajuste, no un número escondido en el código.
     *
     * Quinientas caben en pantalla y llegan rápido, pero quien mira una tabla
     * grande necesita subirlo sin salir a buscar dónde se cambia.
     */
    it('trae quinientas filas mientras nadie diga otra cosa', async () => {
      await store.connect(form);
      store.updateSql('SELECT 1');

      await store.execute();

      expect(gateway.executeCalls[0].maxRows).toBe(500);
    });

    it('usa el límite de filas elegido, y lo recuerda', async () => {
      await store.connect(form);
      await store.setMaxRows(10_000);
      store.updateSql('SELECT 1');

      await store.execute();

      expect(store.maxRows()).toBe(10_000);
      expect(gateway.executeCalls[0].maxRows).toBe(10_000);
      expect(gateway.preferences['query.maxRows']).toBe('10000');
    });

    /**
     * Pedir más de lo que el proceso local admite se ajusta aquí.
     *
     * Prometer doscientas mil en la barra y que el servidor devuelva cien mil
     * sería mentir sobre lo que se está viendo.
     */
    it('no deja pedir más filas de las que el proceso local admite', async () => {
      await store.setMaxRows(500_000);

      expect(store.maxRows()).toBe(100_000);
    });

    it('guarda la duración de la última ejecución', async () => {
      await store.connect(form);
      store.updateSql('SELECT 1');

      await store.execute();

      expect(store.session()?.lastDurationMs).toBe(5);
    });

    /**
     * El error de una consulta se cuenta **donde tiene contexto**, no en el aviso
     * de arriba.
     *
     * El panel lo enseña con el código del motor y su botón de copiar, y el
     * editor subraya la palabra culpable en su sitio. La banda superior se queda
     * para lo que no cabe ahí: la sesión perdida, la transacción abierta, la
     * confirmación de algo destructivo.
     */
    it('el error de la consulta va al resultado y no al aviso de arriba', async () => {
      await store.connect(form);
      gateway.executeResult = of(
        successfulQuery({
          state: 'failed',
          resultSets: [],
          error: { message: 'error de sintaxis', code: '42601' },
        }),
      );

      store.updateSql('SELECT * FROM');
      await store.execute();

      expect(store.result()?.error?.message).toBe('error de sintaxis');
      expect(store.notice()).toBeNull();
    });

    it('un rechazo por instrucción destructiva se muestra para confirmar', async () => {
      await store.connect(form);

      gateway.executeResult = throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              reason: 'unconfirmeddestructive',
              message: 'La instrucción puede destruir datos.',
              risks: [{ kind: 'drop', description: 'Elimina una tabla.' }],
            },
          }),
      );

      store.updateSql('DROP TABLE users');
      await store.execute();

      const rejection = store.rejection();

      expect(rejection?.reason).toBe('unconfirmeddestructive');
      expect(rejection?.risks.length).toBe(1);
      // Un rechazo no es un error de transporte: no debe salir como aviso suelto.
      expect(store.notice()).toBeNull();
    });

    it('al confirmar reenvía la instrucción con la marca', async () => {
      await store.connect(form);
      store.updateSql('DROP TABLE users');

      gateway.executeResult = throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              reason: 'unconfirmeddestructive',
              message: 'La instrucción puede destruir datos.',
              risks: [{ kind: 'drop', description: 'Elimina una tabla.' }],
            },
          }),
      );
      await store.execute();

      gateway.executeResult = of(successfulQuery());

      await store.confirmAndExecute();

      expect(gateway.executeCalls.at(-1)?.confirmDestructive).toBe(true);
      expect(gateway.executeCalls.at(-1)?.sql).toBe('DROP TABLE users');
      expect(store.rejection()).toBeNull();
    });

    it('un rechazo deja de poder confirmarse al cambiar de pestaña', async () => {
      await store.connect(form);
      gateway.executeResult = throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              reason: 'unconfirmeddestructive',
              message: 'La instrucción puede destruir datos.',
              risks: [{ kind: 'drop', description: 'Elimina una tabla.' }],
            },
          }),
      );
      store.updateSql('DROP TABLE users');
      await store.execute();

      store.createTab('DROP TABLE otra');
      await store.confirmAndExecute();

      expect(gateway.executeCalls).toHaveLength(1);
      expect(store.rejection()).toBeNull();
    });

    it('un rechazo tardío se descarta si el SQL cambió durante la ejecución', async () => {
      await store.connect(form);

      let reject!: (error: unknown) => void;
      gateway.executeResult = new Observable<QueryResult>((subscriber) => {
        reject = (error) => subscriber.error(error);
      });

      store.updateSql('DROP TABLE users');
      const execution = store.execute();
      store.updateSql('SELECT 1');
      reject(
        new HttpErrorResponse({
          status: 409,
          error: {
            reason: 'unconfirmeddestructive',
            message: 'La instrucción puede destruir datos.',
            risks: [{ kind: 'drop', description: 'Elimina una tabla.' }],
          },
        }),
      );
      await execution;

      expect(store.rejection()).toBeNull();
    });

    it('un error tardío no aparece al cambiar de pestaña', async () => {
      await store.connect(form);

      let reject!: (error: unknown) => void;
      gateway.executeResult = new Observable<QueryResult>((subscriber) => {
        reject = (error) => subscriber.error(error);
      });

      store.updateSql('SELECT rota');
      const execution = store.execute();
      store.createTab('SELECT 1');
      reject(new HttpErrorResponse({ status: 500, error: { message: 'error de la anterior' } }));
      await execution;

      expect(store.notice()).not.toBe('error de la anterior');
    });

    it('un rechazo tardío de exportación se descarta si el SQL cambió', async () => {
      await store.connect(form);

      let reject!: (error: unknown) => void;
      vi.spyOn(gateway, 'exportQuery').mockReturnValue(
        new Observable<Blob>((subscriber) => {
          reject = (error) => subscriber.error(error);
        }),
      );

      store.updateSql('DROP TABLE users');
      const exporting = store.export('csv');
      store.updateSql('SELECT 1');
      reject(
        new HttpErrorResponse({
          status: 409,
          error: new Blob([
            JSON.stringify({
              reason: 'unconfirmeddestructive',
              message: 'La instrucción puede destruir datos.',
              risks: [{ kind: 'drop', description: 'Elimina una tabla.' }],
            }),
          ]),
        }),
      );
      await exporting;

      expect(store.rejection()).toBeNull();
    });

    it('exporta la consulta que produjo el resultado aunque el editor después quede vacío', async () => {
      await store.connect(form);
      store.updateSql('SELECT 1;\nSELECT 2;');
      await store.execute('SELECT 2;');
      store.updateSql('');

      await store.export('xlsx');

      expect(gateway.exportCalls.at(-1)).toMatchObject({
        sessionId: 'sesion-1',
        sql: 'SELECT 2;',
        format: 'xlsx',
      });
      // El aviso dice dónde quedó: «no sé dónde se guardan» era la queja.
      expect(store.notice()).toBe('Exportado a XLSX en C:\\datos\\ventas.xlsx');
    });

    /**
     * El motor rechaza la consulta durante una exportación.
     *
     * Llega como 409 con el mensaje del motor y **sin `reason`**: no es algo que
     * se pueda confirmar, es algo que se arregla en el SQL. Antes salía como un
     * 500 con «se produjo un error inesperado»; ahora se cuenta lo que dijo el
     * servidor, y como aviso, no como banner de confirmación.
     */
    it('un error del motor al exportar se cuenta con su mensaje, sin pedir confirmación', async () => {
      await store.connect(form);
      store.updateSql('SELECT * FROM no_existe');
      vi.spyOn(gateway, 'exportQuery').mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: new Blob([
                JSON.stringify({ message: "Invalid object name 'no_existe'.", code: '208' }),
              ]),
            }),
        ),
      );

      await store.export('csv');

      expect(store.rejection()).toBeNull();
      expect(store.notice()).toBe("Invalid object name 'no_existe'.");
    });

    it('exportar una definición se rechaza y el aviso explica qué hacer', async () => {
      await store.connect(form);
      store.updateSql('CREATE VIEW dbo.v AS SELECT 1 AS uno');
      vi.spyOn(gateway, 'exportQuery').mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: new Blob([
                JSON.stringify({
                  reason: 'notexportable',
                  message: 'Esto no devuelve filas: modifica la base de datos.',
                  risks: [],
                }),
              ]),
            }),
        ),
      );

      await store.export('csv');

      expect(store.rejection()).toMatchObject({
        reason: 'notexportable',
        message: 'Esto no devuelve filas: modifica la base de datos.',
      });
    });

    it('muestra el mensaje JSON de un error de exportación recibido como blob', async () => {
      await store.connect(form);
      store.updateSql('SELECT 1');
      vi.spyOn(gateway, 'exportQuery').mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 500,
              error: new Blob([JSON.stringify({ message: 'Excel rechazó una celda.' })]),
            }),
        ),
      );

      await store.export('xlsx');

      expect(store.notice()).toBe('Excel rechazó una celda.');
    });
  });

  describe('probar el túnel', () => {
    /**
     * Un formulario con servidor intermedio, que es el único caso donde esto
     * tiene algo que decir.
     */
    function conTunel(): ConnectionForm {
      return {
        ...form,
        host: 'db.interna',
        port: 5432,
        sshTunnel: {
          host: 'bastion.empresa.com',
          port: 22,
          username: 'operador',
          authentication: 'password',
          privateKeyPath: '',
        },
      };
    }

    it('cuando el camino entero funciona lo dice nombrando los dos extremos', async () => {
      gateway.tunnelResult = { succeeded: true, reach: 'complete', durationMs: 42 };

      const resultado = await store.testTunnel(conTunel());

      expect(resultado.ok).toBe(true);
      expect(resultado.message).toContain('Túnel correcto');
      expect(resultado.message).toContain('db.interna:5432');
      expect(resultado.message).toContain('bastion.empresa.com');
    });

    /**
     * El mensaje del servidor se enseña tal cual.
     *
     * Es la mitad del valor de este botón: quien lee «no se pudo entrar» sabe
     * que el problema está en su cuenta SSH y no en la base.
     */
    it('un fallo se cuenta con el motivo que dio el servidor', async () => {
      gateway.tunnelResult = {
        succeeded: false,
        reach: 'bastion',
        errorMessage: 'Usuario o clave incorrectos en bastion.empresa.com.',
        durationMs: 8,
      };

      const resultado = await store.testTunnel(conTunel());

      expect(resultado.ok).toBe(false);
      expect(resultado.message).toBe('Usuario o clave incorrectos en bastion.empresa.com.');
    });

    it('no manda la contraseña de la base al servidor intermedio', async () => {
      await store.testTunnel(conTunel());

      const enviado = gateway.tunnelCalls.at(-1);

      expect(enviado?.profile.sshTunnel?.host).toBe('bastion.empresa.com');
      expect(enviado?.profile.host).toBe('db.interna');
    });
  });

  describe('pestañas', () => {
    it('abre un archivo SQL limpio y conserva su identidad opaca', () => {
      store.openSqlFile('ventas.sql', 'SELECT * FROM ventas;', 'sql-7');

      expect(store.activeTab()).toMatchObject({
        title: 'ventas.sql',
        fileName: 'ventas.sql',
        documentId: 'sql-7',
        sql: 'SELECT * FROM ventas;',
        dirty: false,
      });
    });

    it('solo limpia los cambios que coinciden con el contenido guardado', () => {
      store.openSqlFile('ventas.sql', 'SELECT 1;', 'sql-7');
      const tab = store.activeTab()!;
      store.updateSql('SELECT 2;');

      store.markTabSaved(tab.id, 'SELECT 1;', 'ventas.sql', 'sql-7');
      expect(store.activeTab()?.dirty).toBe(true);

      store.markTabSaved(tab.id, 'SELECT 2;', 'ventas.sql', 'sql-7');
      expect(store.activeTab()?.dirty).toBe(false);
    });

    it('abre una consulta preparada desde una tabla', async () => {
      await store.connect(form);
      await store.toggleNode(store.explorerNodes()[0].id);

      store.openSelectFor(
        {
          id: 'x',
          label: 'users',
          kind: 'table',
          depth: 5,
          expandable: false,
          expanded: false,
          loading: false,
          connectionId: store.connections()[0].id,
          source: {
            id: 'table:public.users',
            name: 'users',
            kind: 'table',
            schema: 'public',
            hasChildren: true,
          },
        },
        'SELECT *\nFROM "public"."users"\nLIMIT 100;\n',
      );

      expect(store.activeTab()?.sql).toContain('FROM "public"."users"');
      expect(store.activeTab()?.connectionId).toBe(store.connections()[0].id);
    });

    it('ejecuta una pestaña del explorador en la conexión que la originó', async () => {
      gateway.sessionIds = ['postgresql-session', 'sqlserver-session'];
      await store.connect(form);
      await store.connect({ ...form, name: 'SQL Server', engine: 'sqlserver' });

      const sqlServer = store
        .connections()
        .find((connection) => connection.engine === 'sqlserver')!;

      store.openSelectFor(
        {
          id: 'sqlserver-users',
          label: 'users',
          kind: 'table',
          depth: 5,
          expandable: true,
          expanded: false,
          loading: false,
          connectionId: sqlServer.id,
          source: {
            id: 'table:public.users',
            name: 'users',
            kind: 'table',
            database: 'druse_test',
            schema: 'public',
            hasChildren: true,
          },
        },
        'SELECT TOP 100 * FROM [public].[users];',
      );

      await store.execute();

      expect(gateway.executeCalls.at(-1)?.sessionId).toBe('sqlserver-session');
      expect(gateway.executeCalls.at(-1)?.database).toBe('druse_test');
      expect(store.activeConnection()?.engine).toBe('sqlserver');
    });

    it('conserva la base elegida al ejecutar y exportar', async () => {
      await store.connect(form);

      store.openSelectFor(
        {
          id: 'secondary-users',
          label: 'users',
          kind: 'table',
          depth: 5,
          expandable: true,
          expanded: false,
          loading: false,
          connectionId: store.connections()[0].id,
          source: {
            id: 'Table:public.users',
            name: 'users',
            kind: 'table',
            database: 'otra_base',
            schema: 'public',
            hasChildren: true,
          },
        },
        'SELECT * FROM public.users;',
      );

      await store.execute();
      await store.export('csv');

      expect(store.activeTab()?.database).toBe('otra_base');
      expect(gateway.executeCalls.at(-1)?.database).toBe('otra_base');
      expect(gateway.exportCalls.at(-1)?.database).toBe('otra_base');
    });

    it('una pestaña nueva queda ligada a la conexión activa', async () => {
      await store.connect(form);

      store.createTab('SELECT 1');

      expect(store.activeTab()?.connectionId).toBe(store.connections()[0].id);
      expect(store.session()?.database).toBe('druse_test');
    });

    it('una pestaña nueva hereda la conexión de la pestaña visible', async () => {
      gateway.sessionIds = ['postgresql-session', 'sqlserver-session'];
      await store.connect(form);
      const postgresqlId = store.connections()[0].id;
      await store.connect({ ...form, name: 'SQL Server', engine: 'sqlserver' });

      store.selectTab('q1');
      expect(store.activeTab()?.connectionId).toBe(postgresqlId);

      store.createTab();

      expect(store.activeTab()?.connectionId).toBe(postgresqlId);
    });

    it('abre el DDL de una vista desde la sesión de su nodo', async () => {
      gateway.sessionIds = ['postgresql-session', 'sqlserver-session'];
      await store.connect(form);
      await store.connect({ ...form, name: 'SQL Server', engine: 'sqlserver' });

      const postgresql = store
        .connections()
        .find((connection) => connection.engine === 'postgresql')!;

      await store.openDefinition({
        id: 'active-users',
        label: 'active_users',
        kind: 'view',
        depth: 5,
        expandable: true,
        expanded: false,
        loading: false,
        connectionId: postgresql.id,
        source: {
          id: 'View:public.active_users',
          name: 'active_users',
          kind: 'view',
          database: 'druse_test',
          schema: 'public',
          hasChildren: true,
        },
      });

      expect(gateway.definitionRequest?.sessionId).toBe('postgresql-session');
      expect(store.activeTab()?.sql).toContain('CREATE VIEW');
      expect(store.activeTab()?.connectionId).toBe(postgresql.id);
      expect(store.activeTab()?.database).toBe('druse_test');
      expect(store.activeTab()?.sourceTable).toBeUndefined();
    });

    it('abre el DDL de un procedimiento desde su conexión', async () => {
      await store.connect(form);
      const connectionId = store.connections()[0].id;
      gateway.definition = 'CREATE PROCEDURE public.recalcular() LANGUAGE SQL AS $$ SELECT 1 $$;\n';
      const procedure: DatabaseObject = {
        id: 'Procedure:oid:42',
        name: 'recalcular()',
        kind: 'procedure',
        database: 'druse_test',
        schema: 'public',
        hasChildren: false,
      };

      await store.openDefinition({
        id: `${connectionId}|${procedure.id}`,
        label: procedure.name,
        kind: 'procedure',
        depth: 4,
        expandable: false,
        expanded: false,
        loading: false,
        source: procedure,
        connectionId,
      });

      expect(gateway.definitionRequest?.databaseObject).toEqual(procedure);
      expect(store.activeTab()?.sql).toContain('CREATE PROCEDURE');
      expect(store.activeTab()?.title).toBe('recalcular() · DDL');
    });

    it('no abre nada desde una carpeta', () => {
      const before = store.tabs().length;

      store.openSelectFor(
        {
          id: 'f',
          label: 'Tables',
          kind: 'folder',
          depth: 4,
          expandable: true,
          expanded: true,
          loading: false,
          connectionId: 'c',
          source: { id: 'folder', name: 'Tables', kind: 'folder', hasChildren: true },
        },
        'SELECT 1;',
      );

      expect(store.tabs().length).toBe(before);
    });
  });
  describe('transacciones manuales', () => {
    it('abre la transacción sobre la conexión activa y dice a cuál afecta', async () => {
      await store.connect(form);

      const abierta = await store.beginTransaction();

      expect(abierta).toBe(true);
      expect(gateway.transactionCalls).toContain('begin:sesion-1');
      expect(store.transaction()?.connectionName).toBe('Pruebas');
      expect(store.notice()).toContain('Transacción abierta en «Pruebas»');
    });

    it('avisa de que el DDL no se deshace en los motores que no lo permiten', async () => {
      gateway.transaction = closedTransaction({ ddlIsReversible: false });
      await store.connect(form);

      await store.beginTransaction();

      expect(store.notice()).toContain('no se deshace en este motor');
    });

    it('confirmar cierra la transacción y lo cuenta', async () => {
      await store.connect(form);
      await store.beginTransaction();

      const confirmada = await store.commitTransaction();

      expect(confirmada).toBe(true);
      expect(store.transaction()).toBeNull();
      expect(store.notice()).toBe('Cambios confirmados en «Pruebas».');
    });

    it('deshacer cierra la transacción', async () => {
      await store.connect(form);
      await store.beginTransaction();

      await store.rollbackTransaction();

      expect(store.transaction()).toBeNull();
      expect(gateway.transactionCalls).toContain('rollback:sesion-1');
    });

    it('sin conexión no se puede abrir ninguna', async () => {
      const abierta = await store.beginTransaction();

      expect(abierta).toBe(false);
      expect(gateway.transactionCalls).toEqual([]);
      expect(store.notice()).toBe('Abre una conexión para poder usar transacciones.');
    });

    /**
     * Cerrar la conexión deshace lo que no esté confirmado, así que la interfaz
     * tiene que poder preguntar antes de llegar ahí.
     */
    it('sabe si una conexión tiene trabajo sin confirmar', async () => {
      await store.connect(form);
      const connectionId = store.connections()[0].id;

      expect(store.hasOpenTransaction(connectionId)).toBe(false);

      await store.beginTransaction();

      expect(store.hasOpenTransaction(connectionId)).toBe(true);

      await store.disconnect(connectionId);

      expect(store.hasOpenTransaction(connectionId)).toBe(false);
    });
    /**
     * La deshace el proceso local sin que nadie pulse nada, así que el usuario
     * tiene que enterarse al volver: sus cambios ya no están.
     */
    it('cuenta que la transacción se deshizo sola al descubrirlo', async () => {
      await store.connect(form);
      await store.beginTransaction();

      // El proceso local la deshizo por inactividad mientras nadie miraba, así
      // que confirmar ya no tiene nada que confirmar.
      gateway.transaction = closedTransaction({ autoRolledBackAt: '2026-08-14T10:20:00Z' });
      gateway.commitShouldFail = true;

      const confirmada = await store.commitTransaction();

      expect(confirmada).toBe(false);
      expect(store.transaction()).toBeNull();
      expect(store.notice()).toContain('se deshizo sola');
      expect(store.notice()).toContain('15 min');
    });
  });
  describe('ajustes de formateo', () => {
    it('empieza con lo que se venía aplicando', () => {
      expect(store.formatSettings()).toEqual({
        style: 'standard',
        expressionWidth: 80,
        keywordCase: 'upper',
        indent: 'spaces2',
      });
    });

    it('recuerda lo que el usuario elige', async () => {
      await store.setFormatSettings({ style: 'tabular', indent: 'tabs' });

      expect(store.formatSettings().style).toBe('tabular');
      expect(store.formatSettings().indent).toBe('tabs');
      expect(gateway.preferences['editor.format.style']).toBe('tabular');
      expect(gateway.preferences['editor.format.indent']).toBe('tabs');
    });

    /** Escribir las cuatro claves en cada clic llenaría la base de nada. */
    it('solo guarda lo que cambió', async () => {
      await store.setFormatSettings({ keywordCase: 'lower' });

      expect(Object.keys(gateway.preferences)).toEqual(['editor.format.keywordCase']);
    });

    it('los recupera al arrancar', async () => {
      gateway.preferences = { 'editor.format.style': 'tabular', 'editor.format.width': '120' };

      await store.loadPreferences();

      expect(store.formatSettings().style).toBe('tabular');
      expect(store.formatSettings().expressionWidth).toBe(120);
    });
  });

  /**
   * Buscar actualizaciones es la única conexión que Druse abriría sin que nadie
   * la pidiera, así que la elección se guarda como cualquier otra preferencia y
   * el servicio la recibe antes de que el arranque llegue a consultarla.
   */
  describe('búsqueda de actualizaciones', () => {
    it('recuerda que se autorizó', async () => {
      await store.setAutoUpdateCheck(true);

      expect(gateway.preferences['updates.autoCheck']).toBe('true');
      expect(TestBed.inject(UpdateService).autoCheck()).toBe(true);
    });

    it('recuerda que se rechazó', async () => {
      await store.setAutoUpdateCheck(false);

      expect(gateway.preferences['updates.autoCheck']).toBe('false');
      expect(TestBed.inject(UpdateService).autoCheck()).toBe(false);
    });

    it('la lectura del arranque se la pasa al actualizador', async () => {
      gateway.preferences = { 'updates.autoCheck': 'true' };

      await store.loadPreferences();

      expect(TestBed.inject(UpdateService).autoCheck()).toBe(true);
    });

    it('sin preferencia guardada, queda sin decidir', async () => {
      await store.loadPreferences();

      expect(TestBed.inject(UpdateService).autoCheck()).toBeNull();
    });
  });
  describe('reconectar y navegar entre bases', () => {
    it('detecta que la sesión se perdió y lo cuenta con una salida', async () => {
      await store.connect(form);
      gateway.sessionIsGone = true;

      await store.execute('SELECT 1');

      const connection = store.connections()[0];

      expect(connection.lost).toBe(true);
      expect(connection.sessionId).toBeUndefined();
      expect(store.lostConnection()?.id).toBe(connection.id);
      expect(store.notice()).toContain('Se perdió la conexión');
    });

    /** El árbol era de una sesión que ya no existe: enseñarlo sería mentir. */
    it('al perderse la sesión retira su catálogo', async () => {
      await store.connect(form);
      expect(store.explorerNodes().length).toBeGreaterThan(0);

      gateway.sessionIsGone = true;
      await store.execute('SELECT 1');

      expect(store.explorerNodes().length).toBe(0);
    });

    it('reconectar abre otra sesión y deja la conexión utilizable', async () => {
      gateway.savedConnections = [savedProfile];
      await store.loadSavedConnections();
      await store.connectSaved(savedProfile.id);

      gateway.sessionIsGone = true;
      await store.execute('SELECT 1');
      gateway.sessionIsGone = false;

      const outcome = await store.reconnect(savedProfile.id);

      expect(outcome).toBe('ok');
      expect(store.connections()[0].lost).toBeFalsy();
      expect(store.connections()[0].state).toBe('connected');
      expect(store.notice()).toContain('restablecida');
    });

    /** Sin perfil guardado no hay con qué volver a abrirla. */
    it('no promete reconectar una conexión que no está guardada', async () => {
      await store.connect(form);

      const outcome = await store.reconnect(store.connections()[0].id);

      expect(outcome).toBe('failed');
      expect(store.notice()).toContain('no está guardada');
    });

    /**
     * El caso de todos los días: la misma consulta, primero en desarrollo y
     * después en preproducción, sin pegar el SQL en otra pestaña.
     *
     * Se conecta primero la de trabajo y **después** se carga la guardada, que
     * es el orden real: la otra está en la lista pero sin abrir.
     */
    it('cambiar de conexión repunta la pestaña y abre la que hacía falta', async () => {
      await store.connect(form);
      gateway.savedConnections = [savedProfile];
      await store.loadSavedConnections();

      const outcome = await store.useConnection(savedProfile.id);

      expect(outcome).toBe('ok');
      expect(gateway.openSavedCalls.at(-1)?.id).toBe(savedProfile.id);
      expect(store.activeTab()?.connectionId).toBe(savedProfile.id);
      expect(store.activeConnection()?.id).toBe(savedProfile.id);
      expect(store.schemaIndex().relations.length).toBeGreaterThan(0);
      expect(
        store
          .schemaIndex()
          .relations.every((relation) => relation.connectionId === savedProfile.id),
      ).toBe(true);
    });

    /** El resultado salió del otro servidor; dejarlo invita a leerlo mal. */
    it('cambiar de conexión retira el resultado en pantalla', async () => {
      await store.connect(form);
      gateway.savedConnections = [savedProfile];
      await store.loadSavedConnections();
      await store.execute('SELECT 1');

      expect(store.result()).not.toBeNull();

      await store.useConnection(savedProfile.id);

      expect(store.result()).toBeNull();
    });

    /** Volver a elegir la que ya está no reabre nada ni tira lo que hay. */
    it('elegir la conexión en la que ya se está no hace nada', async () => {
      await store.connect(form);
      await store.execute('SELECT 1');

      const outcome = await store.useConnection(store.activeConnection()!.id);

      expect(outcome).toBe('ok');
      expect(store.result()).not.toBeNull();
    });

    /** Si le falta la contraseña se dice, para que la pida quien tiene el diálogo. */
    it('una conexión sin contraseña guardada pide que se escriba', async () => {
      await store.connect(form);
      gateway.savedConnections = [savedProfile];
      gateway.savedConnectionMissingPassword = true;
      await store.loadSavedConnections();

      const antes = store.activeTab()?.connectionId;
      const outcome = await store.useConnection(savedProfile.id);

      expect(outcome).toBe('needsPassword');
      expect(store.activeTab()?.connectionId).toBe(antes);
    });

    it('cambiar de base afecta a la pestaña, no a otro script', async () => {
      await store.connect(form);

      store.useDatabase('otra_base');

      expect(store.activeTab()?.database).toBe('otra_base');
      expect(store.activeDatabase()).toBe('otra_base');
      expect(store.tabs().length).toBe(1);
    });

    it('la consulta se ejecuta contra la base elegida', async () => {
      await store.connect(form);
      store.useDatabase('otra_base');

      await store.execute('SELECT 1');

      expect(gateway.executeCalls.at(-1)?.database).toBe('otra_base');
    });

    /** El resultado vino de la base anterior; dejarlo invita a leerlo mal. */
    it('cambiar de base retira el resultado en pantalla', async () => {
      await store.connect(form);
      await store.execute('SELECT 1');
      expect(store.result()).not.toBeNull();

      store.useDatabase('otra_base');

      expect(store.result()).toBeNull();
    });

    it('ofrece las bases que trajo el explorador', async () => {
      await store.connect(form);

      expect(store.databasesFor(store.connections()[0].id)).toEqual(['druse_test']);
    });

    /**
     * Una consulta contra otra base va por otra conexión, así que se confirma
     * sola. Callarlo dejaría creer que esos cambios se pueden deshacer.
     */
    it('avisa de que la base nueva queda fuera de la transacción abierta', async () => {
      await store.connect(form);
      await store.beginTransaction();

      store.useDatabase('otra_base');

      expect(store.notice()).toContain('no entra en la transacción abierta');
    });

    it('sin transacción abierta, cambiar de base no dice nada', async () => {
      await store.connect(form);
      store.notify('algo anterior');

      store.useDatabase('otra_base');

      expect(store.notice()).toBe('algo anterior');
    });
  });

  describe('trabajo sin ejecutar', () => {
    // El guardado espera a que se deje de escribir, así que el reloj se controla
    // aquí en vez de dormir de verdad en cada prueba.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('devuelve las pestañas de la última sesión tal y como estaban', async () => {
      gateway.storedTabs = [
        {
          id: 'q7',
          title: 'informe.sql',
          sql: '-- a medio escribir\nSELECT * FROM ventas',
          isActive: false,
          isDirty: true,
          connectionId: 'c1',
          database: 'druse_test',
          fileName: 'informe.sql',
        },
        { id: 'q8', title: 'Query 8', sql: 'SELECT 2', isActive: true, isDirty: false },
      ];

      await store.restoreTabs();

      expect(store.tabs().map((tab) => tab.sql)).toEqual([
        '-- a medio escribir\nSELECT * FROM ventas',
        'SELECT 2',
      ]);
      expect(store.activeTab()?.id).toBe('q8');
      expect(store.tabs()[0].fileName).toBe('informe.sql');
      expect(store.tabs()[0].dirty).toBe(true);
    });

    it('sin nada guardado deja la pestaña vacía de siempre', async () => {
      gateway.storedTabs = [];

      await store.restoreTabs();

      expect(store.tabs()).toHaveLength(1);
      expect(store.tabs()[0].sql).toBe('');
    });

    /**
     * Lo que más duele: si el guardado corriera antes de leer, la pestaña vacía
     * del arranque borraría el trabajo de la sesión anterior.
     */
    it('no guarda nada antes de haber restaurado', async () => {
      store.updateSql('SELECT 1');
      vi.advanceTimersByTime(5000);

      expect(gateway.savedTabs).toHaveLength(0);
    });

    it('guarda solo cuando se deja de escribir', async () => {
      await store.restoreTabs();

      store.updateSql('SEL');
      vi.advanceTimersByTime(400);
      store.updateSql('SELECT');
      vi.advanceTimersByTime(400);
      store.updateSql('SELECT 1');

      // Tres cambios seguidos, ninguna escritura todavía.
      expect(gateway.savedTabs).toHaveLength(0);

      vi.advanceTimersByTime(1000);

      expect(gateway.savedTabs).toHaveLength(1);
      expect(gateway.savedTabs[0][0].sql).toBe('SELECT 1');
    });

    it('cerrar una pestaña también se guarda', async () => {
      await store.restoreTabs();

      store.createTab('SELECT 2');
      vi.advanceTimersByTime(1000);
      const antes = gateway.savedTabs.length;

      store.closeTab(store.tabs()[0].id);
      vi.advanceTimersByTime(1000);

      expect(gateway.savedTabs.length).toBeGreaterThan(antes);
      expect(gateway.savedTabs.at(-1)).toHaveLength(1);
    });

    it('al cerrar se guarda lo que estuviera esperando', async () => {
      await store.restoreTabs();

      store.updateSql('SELECT 1');
      // Sin llegar al segundo de espera: es la rendija que deja el retardo.
      vi.advanceTimersByTime(300);
      expect(gateway.savedTabs).toHaveLength(0);

      store.flushTabs();

      expect(gateway.savedTabs).toHaveLength(1);
      expect(gateway.savedTabs[0][0].sql).toBe('SELECT 1');
    });

    it('una pestaña nueva no se llama igual que una recuperada', async () => {
      gateway.storedTabs = [
        { id: 'q9', title: 'Query 9', sql: 'SELECT 1', isActive: true, isDirty: false },
      ];

      await store.restoreTabs();
      store.createTab('SELECT 2');

      const ids = store.tabs().map((tab) => tab.id);

      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
