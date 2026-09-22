import { TestBed } from '@angular/core/testing';

import { ExplorerNode } from '../../shared/models/workspace';
import { ComposedQueries, normalizeSql } from './composed-queries';

const node = {
  id: 'connection-1|ventas|table:public.pedidos',
  label: 'pedidos',
  kind: 'table',
  depth: 4,
  expandable: true,
  expanded: false,
  loading: false,
  connectionId: 'connection-1',
  source: {
    id: 'table:public.pedidos',
    name: 'pedidos',
    kind: 'table',
    database: 'ventas',
    schema: 'public',
    hasChildren: true,
  },
} as ExplorerNode;

describe('ComposedQueries', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  const service = () => TestBed.inject(ComposedQueries);

  it('reconoce la consulta aunque cambien los espacios o el punto y coma', () => {
    service().remember({ sql: 'SELECT *\nFROM pedidos\nLIMIT 10;\n', state: { limit: 10 }, node });

    expect(service().find('SELECT * FROM pedidos LIMIT 10')?.state).toEqual({ limit: 10 });
    expect(service().find('  SELECT   *\n\n FROM pedidos\n LIMIT 10 ;')).toBeDefined();
  });

  it('no reconoce una consulta retocada', () => {
    service().remember({ sql: 'SELECT * FROM pedidos LIMIT 10;', state: {}, node });

    expect(service().find('SELECT * FROM pedidos LIMIT 20;')).toBeUndefined();
    expect(service().find('')).toBeUndefined();
  });

  it('la misma consulta compuesta otra vez se queda con el último formulario', () => {
    service().remember({ sql: 'SELECT 1;', state: { v: 1 }, node });
    service().remember({ sql: 'SELECT 1;', state: { v: 2 }, node });

    expect(service().find('SELECT 1')?.state).toEqual({ v: 2 });
  });

  it('sobrevive a reiniciar la aplicación', () => {
    service().remember({ sql: 'SELECT 1;', state: { v: 1 }, node });

    TestBed.resetTestingModule();

    expect(TestBed.inject(ComposedQueries).find('SELECT 1')?.node.label).toBe('pedidos');
  });

  it('olvida las más viejas pasado el tope', () => {
    for (let i = 0; i < 35; i++) {
      service().remember({ sql: `SELECT ${i};`, state: {}, node });
    }

    expect(service().find('SELECT 34')).toBeDefined();
    expect(service().find('SELECT 0')).toBeUndefined();
  });

  it('normaliza sin tocar lo que cambia el significado', () => {
    expect(normalizeSql('SELECT  a,\n  b\nFROM t ;  ')).toBe('SELECT a, b FROM t');
    expect(normalizeSql('SELECT a FROM t WHERE x = 1')).not.toBe(
      normalizeSql('SELECT a FROM t WHERE x = 2'),
    );
  });
});
