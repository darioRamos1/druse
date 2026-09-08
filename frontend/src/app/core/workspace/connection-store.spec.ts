import { TestBed } from '@angular/core/testing';

import { ConnectionSummary } from '../../shared/models/workspace';
import { ConnectionStore } from './connection-store';

function conexion(partial: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: 'c1',
    name: 'Pruebas',
    engine: 'postgresql',
    state: 'connected',
    expanded: false,
    sessionId: 'sesion-1',
    environment: 'development',
    readOnly: false,
    saved: true,
    hasStoredPassword: false,
    database: 'druse_test',
    authentication: 'password',
    ...partial,
  };
}

describe('ConnectionStore', () => {
  let connections: ConnectionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    connections = TestBed.inject(ConnectionStore);
  });

  it('sin conexiones no resuelve ninguna', () => {
    expect(connections.resolve(null)).toBeNull();
    expect(connections.resolve('c1')).toBeNull();
  });

  it('sin preferencia coge cualquiera abierta', () => {
    connections.update(() => [
      conexion({ id: 'c1', sessionId: undefined }),
      conexion({ id: 'c2' }),
    ]);

    expect(connections.resolve(null)?.id).toBe('c2');
  });

  it('la conexión pedida manda sobre la activa', () => {
    connections.update(() => [conexion({ id: 'c1' }), conexion({ id: 'c2' })]);
    connections.activate('c1');

    expect(connections.resolve('c2')?.id).toBe('c2');
    expect(connections.resolve(null)?.id).toBe('c1');
  });

  it('una conexión pedida sin sesión no vale, aunque haya otras abiertas', () => {
    connections.update(() => [
      conexion({ id: 'c1', sessionId: undefined }),
      conexion({ id: 'c2' }),
    ]);

    // Una pestaña puede recordar una conexión ya cerrada: ejecutar «en la otra»
    // sería ejecutar contra un servidor que nadie eligió.
    expect(connections.resolve('c1')).toBeNull();
  });

  it('cambia solo lo indicado de una conexión', () => {
    connections.update(() => [conexion({ id: 'c1' })]);

    connections.patch('c1', { state: 'error', error: 'La conexión se perdió.' });

    expect(connections.find('c1')?.state).toBe('error');
    expect(connections.find('c1')?.name).toBe('Pruebas');
  });

  it('señala la conexión que se perdió', () => {
    connections.update(() => [conexion({ id: 'c1' }), conexion({ id: 'c2', lost: true })]);

    expect(connections.lost()?.id).toBe('c2');
  });

  it('la sesión se guarda, se retoca y se olvida por conexión', () => {
    connections.setSession('c1', {
      connected: true,
      engine: 'postgresql',
      engineVersion: 'PostgreSQL 18',
      database: 'druse_test',
      user: 'postgres',
      lastDurationMs: null,
    });

    connections.patchSession('c1', { lastDurationMs: 42 });
    expect(connections.sessionFor('c1')?.lastDurationMs).toBe(42);

    // Retocar una sesión que no existe no la inventa: sin sesión no hay nada que
    // contar de ella.
    connections.patchSession('c2', { lastDurationMs: 7 });
    expect(connections.sessionFor('c2')).toBeUndefined();

    connections.forgetSession('c1');
    expect(connections.sessionFor('c1')).toBeUndefined();
  });

  it('quitar una conexión la saca de la lista', () => {
    connections.update(() => [conexion({ id: 'c1' }), conexion({ id: 'c2' })]);

    connections.remove('c1');

    expect(connections.connections().map((connection) => connection.id)).toEqual(['c2']);
  });
});
