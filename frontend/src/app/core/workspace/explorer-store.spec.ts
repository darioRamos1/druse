import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import { ConnectionSummary, DatabaseColumn, DatabaseObject } from '../../shared/models/workspace';
import { ConnectionStore } from './connection-store';
import { ExplorerStore } from './explorer-store';
import { NoticeStore } from './notice-store';

const database: DatabaseObject = {
  id: 'db:druse_test',
  name: 'druse_test',
  kind: 'database',
  hasChildren: true,
};

const schema: DatabaseObject = {
  id: 'schema:public',
  name: 'public',
  kind: 'schema',
  database: 'druse_test',
  hasChildren: true,
};

const carpeta: DatabaseObject = {
  id: 'folder:public:tables',
  name: 'Tablas',
  kind: 'folder',
  database: 'druse_test',
  schema: 'public',
  hasChildren: true,
};

const tabla: DatabaseObject = {
  id: 'table:public.clientes',
  name: 'clientes',
  kind: 'table',
  database: 'druse_test',
  schema: 'public',
  hasChildren: true,
};

const columnas: DatabaseColumn[] = [
  { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, ordinal: 1 },
  { name: 'nombre', dataType: 'text', isNullable: true, isPrimaryKey: false, ordinal: 2 },
];

/** La sesión que el proceso local ya no reconoce. */
const sesionPerdida = new HttpErrorResponse({
  status: 404,
  error: { message: 'La sesión no está abierta.' },
});

class FakeGateway implements Partial<ApplicationGateway> {
  /** Hijos por identificador de nodo padre. */
  hijos: Record<string, DatabaseObject[]> = {
    'db:druse_test': [schema],
    'schema:public': [carpeta],
    'folder:public:tables': [tabla],
  };

  llamadas: string[] = [];
  fallaCon: unknown = null;

  getDatabases(): Observable<readonly DatabaseObject[]> {
    return of([database]);
  }

  getChildren(_sessionId: string, parent: DatabaseObject): Observable<readonly DatabaseObject[]> {
    this.llamadas.push(parent.id);

    if (this.fallaCon) {
      return throwError(() => this.fallaCon);
    }

    return of(this.hijos[parent.id] ?? []);
  }

  getColumns(_sessionId: string, parent: DatabaseObject): Observable<readonly DatabaseColumn[]> {
    this.llamadas.push(`columns:${parent.name}`);

    if (this.fallaCon) {
      return throwError(() => this.fallaCon);
    }

    return of(columnas);
  }
}

function conexion(id = 'c1'): ConnectionSummary {
  return {
    id,
    name: 'Pruebas',
    engine: 'postgresql',
    state: 'connected',
    expanded: true,
    sessionId: `sesion-${id}`,
    environment: 'development',
    readOnly: false,
    saved: true,
    hasStoredPassword: false,
    database: 'druse_test',
    authentication: 'password',
  };
}

describe('ExplorerStore', () => {
  let explorer: ExplorerStore;
  let connections: ConnectionStore;
  let notices: NoticeStore;
  let gateway: FakeGateway;

  beforeEach(async () => {
    gateway = new FakeGateway();

    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    });

    explorer = TestBed.inject(ExplorerStore);
    connections = TestBed.inject(ConnectionStore);
    notices = TestBed.inject(NoticeStore);

    connections.update(() => [conexion()]);
    await explorer.loadDatabases('c1', 'sesion-c1');
  });

  it('las bases de la conexión quedan como raíces del árbol', () => {
    expect(explorer.nodes().map((node) => node.label)).toEqual(['druse_test']);
    expect(explorer.databasesFor('c1')).toEqual(['druse_test']);
    expect(explorer.databasesFor('c2')).toEqual([]);
  });

  it('sin recuento de filas no pinta un cero', async () => {
    // La API manda `null`, no omite el campo: así llega todo lo que no es una
    // tabla, y el árbol ponía un «0» junto a cada base y cada carpeta.
    const sinRecuento = { ...database, approximateRowCount: null } as unknown as DatabaseObject;
    const conRecuento = { ...database, id: 'db:otra', name: 'otra', approximateRowCount: 0 };
    gateway.getDatabases = () => of([sinRecuento, conRecuento]);

    await explorer.loadDatabases('c1', 'sesion-c1');

    expect(explorer.nodes().map((node) => node.badge)).toEqual([undefined, '0']);
  });

  it('desplegar carga los hijos una sola vez', async () => {
    await explorer.toggleNode('c1||db:druse_test');
    expect(explorer.nodes().map((node) => node.label)).toEqual(['druse_test', 'public']);

    await explorer.toggleNode('c1||db:druse_test');
    await explorer.toggleNode('c1||db:druse_test');

    // Plegar y volver a desplegar no vuelve a preguntar: los hijos ya estaban.
    expect(gateway.llamadas.filter((llamada) => llamada === 'db:druse_test').length).toBe(1);
  });

  it('actualizar un nodo descarta lo que tenía y lo vuelve a pedir', async () => {
    await explorer.toggleNode('c1||db:druse_test');
    gateway.hijos['db:druse_test'] = [];

    await explorer.refreshNode('c1||db:druse_test');

    expect(explorer.nodes().map((node) => node.label)).toEqual(['druse_test']);
  });

  it('las columnas de una tabla se piden una vez y quedan guardadas', async () => {
    await explorer.primeSchemaIndexAsync('c1', 'druse_test');

    const traidas = await explorer.ensureColumnsAsync('public', 'clientes', 'c1', 'druse_test');

    expect(traidas.map((column) => column.name)).toEqual(['id', 'nombre']);
    expect(explorer.columnsFor('c1', 'druse_test', 'public', 'clientes')[0].isPrimaryKey).toBe(
      true,
    );

    await explorer.ensureColumnsAsync('public', 'clientes', 'c1', 'druse_test');

    expect(gateway.llamadas.filter((llamada) => llamada === 'columns:clientes').length).toBe(1);
  });

  it('el catálogo del editor se recorta a la conexión y la base activas', async () => {
    await explorer.primeSchemaIndexAsync('c1', 'druse_test');
    await explorer.ensureColumnsAsync('public', 'clientes', 'c1', 'druse_test');

    const propio = explorer.buildSchemaIndex('c1', 'druse_test');
    expect(propio.schemas).toEqual(['public']);
    expect(propio.relations.map((relation) => relation.qualified)).toEqual(['public.clientes']);
    expect(propio.relations[0].columns.map((column) => column.name)).toEqual(['id', 'nombre']);

    // Otra base de la misma conexión no debe ofrecer estas tablas: escribir el
    // nombre de una tabla que no está ahí es un error que se descubre tarde.
    expect(explorer.buildSchemaIndex('c1', 'otra').relations).toEqual([]);
    expect(explorer.buildSchemaIndex('c2', 'druse_test').relations).toEqual([]);
  });

  it('olvidar una conexión se lleva su árbol', async () => {
    await explorer.toggleNode('c1||db:druse_test');

    explorer.forget('c1');

    expect(explorer.nodes()).toEqual([]);
    expect(explorer.databasesFor('c1')).toEqual([]);
  });

  it('una sesión perdida se cuenta por quien sabe contarla', async () => {
    const perdidas: string[] = [];
    explorer.reportSessionLossWith((connectionId) => {
      perdidas.push(connectionId);

      return true;
    });

    gateway.fallaCon = sesionPerdida;
    await explorer.toggleNode('c1||db:druse_test');

    expect(perdidas).toEqual(['c1']);

    // El aviso lo da quien atendió la pérdida, con su botón de reconectar: aquí
    // repetirlo con el mensaje genérico solo taparía aquel.
    expect(notices.notice()).toBeNull();
  });

  it('un fallo cualquiera al desplegar sí se cuenta aquí', async () => {
    gateway.fallaCon = new HttpErrorResponse({ status: 500, error: {} });

    await explorer.toggleNode('c1||db:druse_test');

    expect(notices.notice()).toContain('Druse');
  });

  it('el precalentado carga esquemas y tablas sin desplegar nada', async () => {
    await explorer.primeSchemaIndexAsync('c1', 'druse_test');

    // Nada visible cambió —el árbol sigue plegado— y sin embargo el editor ya
    // conoce la tabla.
    expect(explorer.nodes().map((node) => node.label)).toEqual(['druse_test']);
    expect(explorer.buildSchemaIndex('c1', 'druse_test').relations.length).toBe(1);

    gateway.llamadas = [];
    await explorer.primeSchemaIndexAsync('c1', 'druse_test');

    expect(gateway.llamadas).toEqual([]);
  });

  it('sin nodo de esa base no se da por precalentada', async () => {
    await explorer.primeSchemaIndexAsync('c1', 'la_que_no_existe');

    gateway.llamadas = [];
    await explorer.primeSchemaIndexAsync('c1', 'la_que_no_existe');

    // Si se hubiera anotado, el intento bueno de después no se haría nunca.
    expect(explorer.buildSchemaIndex('c1', 'la_que_no_existe').relations).toEqual([]);
  });
});
