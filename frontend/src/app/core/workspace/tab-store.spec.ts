import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { ApplicationGateway, StoredEditorTab } from '../application-gateway/application-gateway';
import { TabStore } from './tab-store';

/** Gateway que solo sabe de pestañas guardadas, que es lo único que se usa aquí. */
class FakeGateway implements Partial<ApplicationGateway> {
  stored: StoredEditorTab[] = [];
  saved: StoredEditorTab[][] = [];
  saveShouldFail = false;

  getEditorTabs(): Observable<StoredEditorTab[]> {
    return of(this.stored);
  }

  saveEditorTabs(tabs: StoredEditorTab[]): Observable<void> {
    if (this.saveShouldFail) {
      return throwError(() => new Error('sin respuesta'));
    }

    this.saved.push(tabs);

    return of(undefined);
  }
}

function guardada(partial: Partial<StoredEditorTab> = {}): StoredEditorTab {
  return {
    id: 'q7',
    title: 'Consulta 7',
    sql: 'select 1',
    isActive: true,
    isDirty: true,
    ...partial,
  };
}

describe('TabStore', () => {
  let tabs: TabStore;
  let gateway: FakeGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    gateway = new FakeGateway();

    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    });

    tabs = TestBed.inject(TabStore);
  });

  afterEach(() => vi.useRealTimers());

  it('arranca con una pestaña vacía activa', () => {
    expect(tabs.tabs().length).toBe(1);
    expect(tabs.active()?.sql).toBe('');
  });

  it('no guarda nada antes de haber restaurado', async () => {
    tabs.updateSql('select 1');

    await vi.advanceTimersByTimeAsync(2000);

    // Guardar antes de leer lo anterior pisaría el trabajo de la sesión pasada.
    expect(gateway.saved).toEqual([]);
  });

  it('guarda lo escrito un segundo después de dejar de escribir', async () => {
    await tabs.restore();

    tabs.updateSql('select 1');
    await vi.advanceTimersByTimeAsync(500);

    expect(gateway.saved.length).toBe(0);

    tabs.updateSql('select 2');
    await vi.advanceTimersByTimeAsync(1000);

    // Una sola escritura, con lo último: el retardo existe justo para eso.
    expect(gateway.saved.length).toBe(1);
    expect(gateway.saved[0][0].sql).toBe('select 2');
  });

  it('al vaciar la espera guarda ya, sin aguardar el retardo', async () => {
    await tabs.restore();

    tabs.updateSql('select 3');
    tabs.flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(gateway.saved.length).toBe(1);
    expect(gateway.saved[0][0].sql).toBe('select 3');
  });

  it('un fallo al guardar no interrumpe el trabajo', async () => {
    await tabs.restore();
    gateway.saveShouldFail = true;

    tabs.updateSql('select 4');
    await vi.advanceTimersByTimeAsync(1000);

    expect(tabs.active()?.sql).toBe('select 4');
  });

  it('restaura lo guardado y numera la siguiente pestaña por encima', async () => {
    gateway.stored = [guardada({ id: 'q7' })];

    await tabs.restore();

    expect(tabs.tabs().length).toBe(1);
    expect(tabs.active()?.id).toBe('q7');

    tabs.create();

    // Sin adelantar el contador, la nueva se llamaría igual que la restaurada.
    expect(tabs.active()?.id).toBe('q8');
  });

  it('si lo guardado no marca ninguna activa, activa la primera', async () => {
    gateway.stored = [
      guardada({ id: 'q1', isActive: false }),
      guardada({ id: 'q2', isActive: false }),
    ];

    await tabs.restore();

    expect(tabs.active()?.id).toBe('q1');
  });

  it('cerrar la pestaña activa deja activa otra', async () => {
    await tabs.restore();
    tabs.create({ sql: 'select 1' });
    const abierta = tabs.active()!.id;

    tabs.close(abierta);

    expect(tabs.tabs().some((tab) => tab.id === abierta)).toBe(false);
    expect(tabs.active()).not.toBeNull();
  });

  it('escribir olvida de qué tabla venía la pestaña', async () => {
    await tabs.restore();
    tabs.create({
      sql: 'select * from clientes',
      sourceTable: { id: 't1', name: 'clientes', kind: 'table', hasChildren: false },
    });

    tabs.updateSql('select * from otra');

    // Con la procedencia puesta, la cuadrícula dejaría editar filas de una tabla
    // que ya no es la que se está consultando.
    expect(tabs.active()?.sourceTable).toBeUndefined();
    expect(tabs.active()?.dirty).toBe(true);
  });

  it('marcar guardado limpia el sucio solo si el texto no cambió mientras tanto', async () => {
    await tabs.restore();
    tabs.create({ sql: 'select 1' });
    const id = tabs.active()!.id;

    tabs.markSaved(id, 'select 1', 'consulta.sql');
    expect(tabs.active()?.dirty).toBe(false);
    expect(tabs.active()?.title).toBe('consulta.sql');

    tabs.updateSql('select 2');
    tabs.markSaved(id, 'select 1', 'consulta.sql');

    // Lo escrito después de pedir el guardado sigue sin guardar.
    expect(tabs.active()?.dirty).toBe(true);
  });

  it('un archivo abierto hereda la conexión de donde se estaba trabajando', async () => {
    await tabs.restore();

    tabs.openFile('informe.sql', 'select 1', 'doc-1', {
      connectionId: 'c1',
      database: 'druse_test',
    });

    expect(tabs.active()?.connectionId).toBe('c1');
    expect(tabs.active()?.database).toBe('druse_test');
    expect(tabs.active()?.fileName).toBe('informe.sql');
    expect(tabs.active()?.documentId).toBe('doc-1');
  });
});
