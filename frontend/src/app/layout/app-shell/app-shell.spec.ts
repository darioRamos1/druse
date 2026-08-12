import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApplicationGateway } from '../../core/application-gateway/application-gateway';
import { AppShell } from './app-shell';

/** Gateway que no habla con nadie: el shell debe montarse sin API detrás. */
function silentGateway(): Partial<ApplicationGateway> {
  return {
    getEngines: () => of([]),
    getDatabases: () => of([]),
    getChildren: () => of([]),
  };
}

describe('AppShell', () => {
  let fixture: ComponentFixture<AppShell>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [{ provide: ApplicationGateway, useValue: silentGateway() }],
    }).compileComponents();

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

  it('sin conexiones, invita a crear una', () => {
    expect(element.querySelector('.empty__action')?.textContent).toContain('Crear una conexión');
  });

  it('sin conexión, la barra de estado lo dice', () => {
    expect(element.querySelector('app-status-bar')?.textContent).toContain('Sin conexión');
  });

  it('sin conexión, no se puede ejecutar', () => {
    const run = element.querySelector<HTMLButtonElement>('app-editor-toolbar .run');

    expect(run?.disabled).toBe(true);
  });

  it('abre el diálogo de conexión desde la barra superior', async () => {
    expect(element.querySelector('app-connection-dialog')).toBeNull();

    element.querySelector<HTMLButtonElement>('app-top-bar .btn--primary')?.click();
    await fixture.whenStable();

    expect(element.querySelector('app-connection-dialog')).toBeTruthy();
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
    element.querySelector<HTMLButtonElement>('app-editor-tabs .tabs__add')?.click();
    await fixture.whenStable();

    element
      .querySelector<HTMLButtonElement>('app-editor-tabs .tab.is-active .tab__close')
      ?.click();
    await fixture.whenStable();

    // Nunca debe quedar el editor sin pestaña seleccionada.
    expect(element.querySelectorAll('app-editor-tabs .tab.is-active').length).toBe(1);
  });
});
