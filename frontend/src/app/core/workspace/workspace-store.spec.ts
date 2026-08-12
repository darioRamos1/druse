import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import {
  ApplicationGateway,
  ExecuteQueryRequest,
  SaveConnectionRequest,
} from '../application-gateway/application-gateway';
import {
  ConnectionForm,
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

function successfulQuery(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    executionId: 'ejecucion-1',
    state: 'succeeded',
    resultSets: [
      {
        columns: [{ name: 'n', dataType: 'int4', kind: 'number', width: null }],
        rows: [{ number: 1, values: ['1'] }],
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
  closedSessions: string[] = [];
  saveCalls: SaveConnectionRequest[] = [];
  deletedConnections: string[] = [];
  openSavedCalls: { id: string; password?: string }[] = [];
  openShouldFail = false;
  savedConnectionMissingPassword = false;
  executeResult: Observable<QueryResult> = of(successfulQuery());
  savedConnections: SavedConnection[] = [];

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

  openSession(): Observable<SessionInfo> {
    return this.openShouldFail
      ? throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { message: 'La autenticación falló.' },
            }),
        )
      : of(session);
  }

  closeSession(sessionId: string): Observable<void> {
    this.closedSessions.push(sessionId);
    return of(undefined);
  }

  getDatabases(): Observable<DatabaseObject[]> {
    return of(databases);
  }

  getChildren(): Observable<DatabaseObject[]> {
    return of(schemas);
  }

  executeQuery(request: ExecuteQueryRequest): Observable<QueryResult> {
    this.executeCalls.push(request);
    return this.executeResult;
  }

  cancelQuery(): Observable<void> {
    return of(undefined);
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

    it('marca la conexión con error y explica el motivo', async () => {
      gateway.openShouldFail = true;

      const connected = await store.connect(form);

      expect(connected).toBe(false);
      expect(store.connections()[0].state).toBe('error');
      expect(store.notice()).toBe('La autenticación falló.');
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

  describe('explorador', () => {
    it('carga los hijos al expandir y no vuelve a pedirlos', async () => {
      await store.connect(form);
      const spy = vi.spyOn(gateway, 'getChildren');

      const nodeId = store.explorerNodes()[0].id;
      await store.toggleNode(nodeId);

      expect(store.explorerNodes().length).toBe(2);
      expect(store.explorerNodes()[1].label).toBe('public');
      expect(spy).toHaveBeenCalledTimes(1);

      // Plegar y volver a desplegar no debe repetir la petición.
      await store.toggleNode(nodeId);
      await store.toggleNode(nodeId);

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
      const nodeId = store.explorerNodes()[0].id;

      await store.toggleNode(nodeId);
      const spy = vi.spyOn(gateway, 'getChildren');

      await store.refreshNode(nodeId);

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

      await store.confirmAndExecute();

      expect(gateway.executeCalls[0].confirmDestructive).toBe(true);
      expect(store.rejection()).toBeNull();
    });
  });

  describe('pestañas', () => {
    it('abre una consulta preparada desde una tabla', async () => {
      await store.connect(form);
      await store.toggleNode(store.explorerNodes()[0].id);

      store.openSelectFor({
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
      });

      expect(store.activeTab()?.sql).toContain('FROM public.users');
    });

    it('no abre nada desde una carpeta', () => {
      const before = store.tabs().length;

      store.openSelectFor({
        id: 'f',
        label: 'Tables',
        kind: 'folder',
        depth: 4,
        expandable: true,
        expanded: true,
        loading: false,
        connectionId: 'c',
        source: { id: 'folder', name: 'Tables', kind: 'folder', hasChildren: true },
      });

      expect(store.tabs().length).toBe(before);
    });
  });
});
