import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import {
  ApplicationGateway,
  ExecuteQueryRequest,
  ExportRequest,
  ImportPreview,
  RowEditRequest,
  RowEditResult,
  SaveConnectionRequest,
} from '../application-gateway/application-gateway';
import {
  ConnectionForm,
  DatabaseColumn,
  DatabaseObject,
  QueryHistoryEntry,
  QueryResult,
  SavedConnection,
  SecretStoreStatus,
  SessionInfo,
} from '../../shared/models/workspace';
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
class FakeGateway implements Partial<ApplicationGateway> {
  executeCalls: ExecuteQueryRequest[] = [];
  exportCalls: ExportRequest[] = [];
  closedSessions: string[] = [];
  saveCalls: SaveConnectionRequest[] = [];
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

  getDatabases(): Observable<DatabaseObject[]> {
    return of(databases);
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
        return of(schemas);

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
    ]);
  }

  getDefinition(sessionId: string, databaseObject: DatabaseObject): Observable<string> {
    this.definitionRequest = { sessionId, databaseObject };
    return of(this.definition);
  }

  executeQuery(request: ExecuteQueryRequest): Observable<QueryResult> {
    this.executeCalls.push(request);
    return this.executeResult;
  }

  cancelQuery(): Observable<void> {
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

  beforeEach(() => {
    gateway = new FakeGateway();

    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
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
      expect(columnas.map((columna) => columna.name)).toEqual(['id', 'email']);
      expect(columnas[0].dataType).toBe('int8');
      expect(columnas[0].isPrimaryKey).toBe(true);
      expect(columnas[1].defaultValue).toBe("'sin-correo'");

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

    it('guarda la duración de la última ejecución', async () => {
      await store.connect(form);
      store.updateSql('SELECT 1');

      await store.execute();

      expect(store.session()?.lastDurationMs).toBe(5);
    });

    it('expone el error cuando la consulta falla', async () => {
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

      expect(store.notice()).toBe('error de sintaxis');
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
      expect(store.notice()).toBe('Exportado a XLSX.');
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
});
