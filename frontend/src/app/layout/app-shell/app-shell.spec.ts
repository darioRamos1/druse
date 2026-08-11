import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppShell } from './app-shell';

describe('AppShell', () => {
  let fixture: ComponentFixture<AppShell>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppShell] }).compileComponents();

    fixture = TestBed.createComponent(AppShell);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('reproduce las cinco zonas del mockup', () => {
    expect(element.querySelector('app-top-bar')).toBeTruthy();
    expect(element.querySelector('app-connections-sidebar')).toBeTruthy();
    expect(element.querySelector('app-editor-tabs')).toBeTruthy();
    expect(element.querySelector('app-results-panel')).toBeTruthy();
    expect(element.querySelector('app-status-bar')).toBeTruthy();
  });

  it('arranca con las proporciones del mockup', () => {
    const sidebar = element.querySelector<HTMLElement>('app-connections-sidebar');
    const results = element.querySelector<HTMLElement>('app-results-panel');

    expect(sidebar?.style.width).toBe('274px');
    expect(results?.style.height).toBe('322px');
  });

  it('ofrece un tirador por cada panel redimensionable', () => {
    const handles = element.querySelectorAll('app-resize-handle');

    expect(handles.length).toBe(2);
    expect(handles[0].getAttribute('aria-orientation')).toBe('vertical');
    expect(handles[1].getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('abre una pestaña nueva y la deja activa', async () => {
    const tabsBefore = element.querySelectorAll('app-editor-tabs .tab').length;

    element.querySelector<HTMLButtonElement>('app-editor-tabs .tabs__add')?.click();
    await fixture.whenStable();

    const tabs = element.querySelectorAll('app-editor-tabs .tab');
    const active = element.querySelectorAll('app-editor-tabs .tab.is-active');

    expect(tabs.length).toBe(tabsBefore + 1);
    expect(active.length).toBe(1);
    expect(tabs[tabs.length - 1].classList).toContain('is-active');
  });

  it('al cerrar la pestaña activa deja otra activa', async () => {
    const closeActive = element.querySelector<HTMLButtonElement>(
      'app-editor-tabs .tab.is-active .tab__close',
    );

    closeActive?.click();
    await fixture.whenStable();

    const active = element.querySelectorAll('app-editor-tabs .tab.is-active');

    // Nunca debe quedar el editor sin pestaña seleccionada.
    expect(active.length).toBe(1);
  });

  it('pliega y despliega una conexión', async () => {
    const connection = element.querySelector<HTMLButtonElement>('.node--connection.is-active');
    expect(connection?.getAttribute('aria-expanded')).toBe('true');

    connection?.click();
    await fixture.whenStable();

    const nodes = element.querySelectorAll('.node--object');
    expect(nodes.length).toBe(0);
  });
});
