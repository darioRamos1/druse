import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConnectionSummary, QueryTab } from '../../../shared/models/workspace';
import { EditorTabs } from './editor-tabs';

const connection: ConnectionSummary = {
  id: 'connection-1',
  name: 'Producción',
  engine: 'sqlserver',
  state: 'connected',
  expanded: true,
  sessionId: 'session-1',
  environment: 'production',
  readOnly: false,
  saved: true,
  hasStoredPassword: true,
  database: 'ventas',
  authentication: 'password',
};

const tab: QueryTab = {
  id: 'q1',
  title: 'pedidos · SELECT',
  active: true,
  dirty: false,
  sql: 'SELECT 1',
  connectionId: connection.id,
};

describe('EditorTabs', () => {
  let fixture: ComponentFixture<EditorTabs>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EditorTabs] }).compileComponents();

    fixture = TestBed.createComponent(EditorTabs);
    fixture.componentRef.setInput('tabs', [tab]);
    fixture.componentRef.setInput('connections', [connection]);
    fixture.detectChanges();
  });

  it('muestra objeto, conexión y base en la pestaña', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.tab__title')?.textContent).toContain('pedidos · SELECT');
    expect(element.querySelector('.tab__context')?.textContent).toContain('Producción · ventas');
    expect(element.querySelector('.tab')?.getAttribute('data-environment')).toBe('production');
  });

  it('usa un único tab stop y permite navegar con flechas', () => {
    fixture.componentRef.setInput('tabs', [
      tab,
      { ...tab, id: 'q2', title: 'Query 2', active: false },
    ]);
    fixture.detectChanges();
    const selected: string[] = [];
    fixture.componentInstance.select.subscribe((id) => selected.push(id));
    const tabs = fixture.nativeElement.querySelectorAll('[role="tab"]');

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(tabs[0].getAttribute('tabindex')).toBe('0');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');
    expect(selected).toEqual(['q2']);
  });
  it('lista todas las abiertas y va a la que se elige', () => {
    const otras = Array.from({ length: 11 }, (_, index) => ({
      ...tab,
      id: `q${index + 2}`,
      title: `consulta ${index + 2}`,
      active: false,
    }));
    fixture.componentRef.setInput('tabs', [tab, ...otras]);
    fixture.detectChanges();
    const selected: string[] = [];
    fixture.componentInstance.select.subscribe((id) => selected.push(id));

    const toggle = fixture.nativeElement.querySelector('.listing__toggle') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.listing__option').length).toBe(12);
    expect(toggle.textContent).toContain('12');

    // La que se busca es una de las que ya no caben en la barra.
    const search = fixture.nativeElement.querySelector(
      '.listing__search input',
    ) as HTMLInputElement;
    search.value = 'consulta 11';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const options = fixture.nativeElement.querySelectorAll('.listing__option');

    expect(options.length).toBe(1);
    options[0].click();
    fixture.detectChanges();

    expect(selected).toEqual(['q11']);
    expect(fixture.nativeElement.querySelector('.listing__menu')).toBeNull();
  });

  it('no trae buscador con pocas pestañas', () => {
    (fixture.nativeElement.querySelector('.listing__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.listing__option')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.listing__search')).toBeNull();
  });
});
