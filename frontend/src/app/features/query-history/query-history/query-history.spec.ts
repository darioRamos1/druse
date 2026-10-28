import { ComponentFixture, TestBed } from '@angular/core/testing';
import { QueryHistory } from './query-history';
import { QueryHistoryEntry } from '../../../shared/models/workspace';

describe('historial de consultas', () => {
  let fixture: ComponentFixture<QueryHistory>;
  let element: HTMLElement;
  const entry: QueryHistoryEntry = {
    id: '1',
    connectionId: 'origen',
    connectionName: 'Servidor',
    database: 'ventas',
    sql: 'SELECT 1;\nSELECT 2;',
    executedAtUtc: '2026-10-02T12:00:00Z',
    durationMs: 10,
    succeeded: false,
    errorMessage: 'error original',
  };
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [QueryHistory] }).compileComponents();
    fixture = TestBed.createComponent(QueryHistory);
    fixture.componentRef.setInput('entries', [entry]);
    element = fixture.nativeElement;
    await fixture.whenStable();
  });
  it('muestra la base, el SQL íntegro y el error sin emitir una reutilización', () => {
    const reuse = vi.fn();
    fixture.componentInstance.reuse.subscribe(reuse);
    expect(element.querySelector('.item__meta')?.textContent).toContain('ventas');
    expect(element.querySelector('pre')?.textContent).toBe(entry.sql);
    element.querySelector<HTMLElement>('.item__detail summary')!.click();
    expect(reuse).not.toHaveBeenCalled();
    expect(element.textContent).toContain('error original');
    element.querySelector<HTMLButtonElement>('.item__sql')!.click();
    expect(reuse).toHaveBeenCalledExactlyOnceWith(entry);
  });
  it('combina el resultado con los filtros existentes', async () => {
    fixture.componentRef.setInput('filter', { search: 'SQL', database: 'ventas' });
    await fixture.whenStable();
    const search = vi.fn();
    fixture.componentInstance.search.subscribe(search);
    const select = element.querySelector('select')!;
    select.value = 'false';
    select.dispatchEvent(new Event('change'));
    expect(search).toHaveBeenCalledExactlyOnceWith({
      search: 'SQL',
      database: 'ventas',
      succeeded: false,
    });
  });
  it('distingue carga, error y lista vacía y permite reintentar', async () => {
    fixture.componentRef.setInput('entries', []);
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Cargando');
    expect(element.querySelector('.empty')).toBeNull();
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', 'falló');
    await fixture.whenStable();
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);
    element.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(element.querySelector('.empty')).toBeNull();
  });
});
