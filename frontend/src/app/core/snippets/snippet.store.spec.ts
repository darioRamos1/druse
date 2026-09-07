import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApplicationGateway, SavedSnippet } from '../application-gateway/application-gateway';
import { SnippetStore } from './snippet.store';

class FakeGateway implements Partial<ApplicationGateway> {
  stored: SavedSnippet[] = [];
  saved: SavedSnippet[] = [];
  deleted: string[] = [];

  /** Con esto, el proceso local no responde y el store tiene que aguantarlo. */
  falla = false;

  getSnippets(): Observable<readonly SavedSnippet[]> {
    return this.falla ? throwError(() => new Error('sin respuesta')) : of(this.stored);
  }

  saveSnippet(snippet: SavedSnippet): Observable<void> {
    if (this.falla) {
      return throwError(() => new Error('sin respuesta'));
    }

    this.saved.push(snippet);

    return of(undefined);
  }

  deleteSnippet(id: string): Observable<void> {
    if (this.falla) {
      return throwError(() => new Error('sin respuesta'));
    }

    this.deleted.push(id);

    return of(undefined);
  }
}

describe('SnippetStore', () => {
  let gateway: FakeGateway;
  let store: SnippetStore;

  beforeEach(() => {
    gateway = new FakeGateway();

    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    });

    store = TestBed.inject(SnippetStore);
  });

  it('lee los guardados al arrancar', async () => {
    gateway.stored = [{ id: 'a', name: 'Uno', sql: 'SELECT 1' }];

    await store.load();

    expect(store.count()).toBe(1);
    expect(store.snippets()[0].name).toBe('Uno');
  });

  it('guarda uno nuevo y lo pone al frente', async () => {
    gateway.stored = [{ id: 'a', name: 'Antiguo', sql: 'SELECT 1' }];
    await store.load();

    const saved = await store.save('  Reciente  ', 'SELECT 2');

    expect(saved?.name).toBe('Reciente');
    expect(gateway.saved[0].sql).toBe('SELECT 2');
    expect(store.snippets().map((snippet) => snippet.name)).toEqual(['Reciente', 'Antiguo']);
  });

  /** Guardar con el mismo identificador es corregirlo, no tener dos. */
  it('reemplaza el que ya existe en lugar de duplicarlo', async () => {
    gateway.stored = [{ id: 'a', name: 'Antes', sql: 'SELECT 1' }];
    await store.load();

    await store.save('Después', 'SELECT 2', 'a');

    expect(store.snippets()).toEqual([{ id: 'a', name: 'Después', sql: 'SELECT 2' }]);
  });

  it('borra y lo quita de la lista', async () => {
    gateway.stored = [{ id: 'a', name: 'Uno', sql: 'SELECT 1' }];
    await store.load();

    const removed = await store.remove('a');

    expect(removed).toBe(true);
    expect(gateway.deleted).toEqual(['a']);
    expect(store.count()).toBe(0);
  });

  /**
   * No poder leerlos no puede impedir escribir SQL: la lista se queda vacía y el
   * editor sigue funcionando sin ellos.
   */
  it('aguanta que el proceso local no responda', async () => {
    gateway.falla = true;

    await store.load();

    expect(store.count()).toBe(0);
    expect(store.error()).toContain('No se pudieron leer');

    const saved = await store.save('Nombre', 'SELECT 1');

    expect(saved).toBeNull();
    expect(store.count()).toBe(0);
    expect(store.error()).toContain('No se pudo guardar');
  });

  describe('nombre propuesto', () => {
    it('usa la primera línea con contenido, saltándose los comentarios', () => {
      const name = SnippetStore.suggestName('\n-- lo de siempre\nSELECT * FROM pedidos\n');

      expect(name).toBe('SELECT * FROM pedidos');
    });

    it('recorta las líneas largas', () => {
      const name = SnippetStore.suggestName(`SELECT ${'columna, '.repeat(20)}FROM t`);

      expect(name.length).toBeLessThanOrEqual(49);
      expect(name.endsWith('…')).toBe(true);
    });

    it('no se queda sin nombre cuando no hay nada que leer', () => {
      expect(SnippetStore.suggestName('   \n\n')).toBe('Fragmento');
    });
  });
});
