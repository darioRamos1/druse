import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImportPreview } from '../../../core/application-gateway/application-gateway';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { ImportDialog } from './import-dialog';

describe('ImportDialog', () => {
  let fixture: ComponentFixture<ImportDialog>;
  let element: HTMLElement;
  let destinationSession = signal('sesion-1');
  let store: {
    importPreview: ReturnType<typeof signal<ImportPreview | null>>;
    importing: ReturnType<typeof signal<boolean>>;
    importRunning: ReturnType<typeof signal<boolean>>;
    clearImportPreview: ReturnType<typeof vi.fn>;
    hasImportPreview: ReturnType<typeof vi.fn>;
    previewImport: ReturnType<typeof vi.fn>;
    runImport: ReturnType<typeof vi.fn>;
    sessionForConnection: ReturnType<typeof vi.fn>;
  };
  const preview: ImportPreview = {
    mappings: [{ source: 'id', target: 'id' }],
    missingRequired: [],
    problems: [],
    rowCount: 1,
    statements: ['INSERT INTO users (id) VALUES (1)'],
  };

  beforeEach(async () => {
    destinationSession = signal('sesion-1');
    const importPreview = signal<ImportPreview | null>(null);
    store = {
      importPreview,
      importing: signal(false),
      importRunning: signal(false),
      clearImportPreview: vi.fn(() => importPreview.set(null)),
      hasImportPreview: vi.fn(() => true),
      previewImport: vi.fn(async () => importPreview.set(preview)),
      runImport: vi.fn(async () => true),
      sessionForConnection: vi.fn(() => destinationSession()),
    };
    await TestBed.configureTestingModule({
      imports: [ImportDialog],
      providers: [{ provide: WorkspaceStore, useValue: store }],
    }).compileComponents();
    fixture = TestBed.createComponent(ImportDialog);
    fixture.componentRef.setInput('table', {
      id: 'users',
      name: 'users',
      kind: 'table',
      schema: 'public',
    });
    fixture.componentRef.setInput('connectionId', 'conexion-1');
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  function button(text: string): HTMLButtonElement {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === text,
    )!;
  }

  async function analyze(): Promise<void> {
    const input = element.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', {
      value: [new File(['id\n1'], 'datos.csv')],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    button('Ver qué va a pasar').click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('cambiar una opción retira el resumen y exige otro análisis', async () => {
    await analyze();
    expect(button('Importar').disabled).toBe(false);
    const delimiter = element.querySelector<HTMLInputElement>('input[maxlength="1"]')!;
    delimiter.value = ';';
    delimiter.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(element.querySelector('.preview')).toBeNull();
    expect(button('Importar').disabled).toBe(true);
    expect(store.runImport).not.toHaveBeenCalled();
    button('Ver qué va a pasar').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button('Importar').disabled).toBe(false);
    expect(store.previewImport.mock.calls.at(-1)?.[2].delimiter).toBe(';');
  });

  it('cambiar el destino retira el análisis del destino anterior', async () => {
    await analyze();
    fixture.componentRef.setInput('connectionId', 'conexion-2');
    fixture.detectChanges();
    expect(button('Importar').disabled).toBe(true);
    expect(element.querySelector('.preview')).toBeNull();
  });

  it('una sesión nueva en la misma conexión exige volver a analizar', async () => {
    await analyze();
    destinationSession.set('sesion-2');
    fixture.detectChanges();
    expect(button('Importar').disabled).toBe(true);
    expect(element.querySelector('.preview')).toBeNull();
  });

  it('se puede cerrar durante el análisis pero no durante la escritura', async () => {
    await analyze();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    store.importing.set(true);
    fixture.detectChanges();
    expect(element.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(true);
    expect(button('Cancelar').disabled).toBe(false);
    button('Cancelar').click();
    expect(closed).toHaveBeenCalledOnce();

    store.importRunning.set(true);
    fixture.detectChanges();
    expect(button('Cancelar').disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalledOnce();
  });

  it('destruir el diálogo invalida su análisis', async () => {
    await analyze();
    fixture.destroy();
    expect(store.importPreview()).toBeNull();
  });
});
