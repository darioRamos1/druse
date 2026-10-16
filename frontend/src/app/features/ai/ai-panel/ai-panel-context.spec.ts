import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { AiPanel } from './ai-panel';
import { AiCatalog } from '../../../core/ai/ai-catalog';
import { AiStore } from '../../../core/ai/ai-store';
import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { AiProvider, AiStreamEvent, AiChatRequest } from '../../../shared/models/ai';
import { DatabaseObject } from '../../../shared/models/workspace';

const table: DatabaseObject = {
  id: 't',
  name: 'facturas',
  schema: 'main',
  database: 'bd',
  kind: 'table',
  hasChildren: true,
};
const context = {
  database: 'bd',
  sessionId: 's1',
  sql: 'SELECT 1;',
  schema: '',
  tables: [],
  source: { connectionId: 'c1', connectionName: 'Pruebas', database: 'bd', engine: 'sqlite' },
};
const provider: AiProvider = {
  id: 'p1',
  name: 'Prueba',
  kind: 'openaicompatible',
  baseUrl: 'https://example.test',
  model: 'prueba',
  command: '',
  disclosure: 'schema',
  ownSession: false,
  isDefault: true,
  hasStoredKey: true,
};

describe('selección de contexto del panel de IA', () => {
  let fixture: ComponentFixture<AiPanel>;
  let catalog: AiCatalog;
  let stream: ReturnType<typeof vi.fn>;
  let columns: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    stream = vi.fn(() => of({ kind: 'done' } as AiStreamEvent));
    columns = vi.fn(() =>
      of([{ name: 'id', dataType: 'integer', ordinal: 0, isPrimaryKey: true, isNullable: false }]),
    );
    TestBed.configureTestingModule({
      imports: [AiPanel],
      providers: [
        {
          provide: ApplicationGateway,
          useValue: {
            getAiProviders: () =>
              of({ providers: [provider], canStoreKeys: true, storeDescription: 'Pruebas' }),
            getDatabases: () => of([{ id: 'bd', name: 'bd', kind: 'database', hasChildren: true }]),
            getChildren: () => of([table]),
            getColumns: columns,
            getTableStructure: () =>
              of({ indexes: [], foreignKeys: [], checkConstraints: [], uniqueConstraints: [] }),
            streamAiChat: stream,
            previewAiChat: (request: AiChatRequest) =>
              of({
                hash: 'preparado',
                valid: true,
                issues: [],
                context: request.context?.schema ?? '',
                messages: [{ role: 'system', text: 'Instrucciones' }, ...request.messages],
                limits: {
                  maxSqlBytes: 16384,
                  maxSchemaBytes: 32768,
                  maxNotesBytes: 16384,
                  maxContextBytes: 49152,
                  maxHistoryBytes: 32768,
                  maxInputBytes: 65536,
                  maxQuestionBytes: 8192,
                  maxHistoryTurns: 20,
                  windowTokens: 16384,
                  questionReserveTokens: 1024,
                  responseReserveTokens: 2048,
                  capacityKnown: false,
                },
                usage: {
                  sqlBytes: 9,
                  schemaBytes: 0,
                  notesBytes: 0,
                  contextBytes: 9,
                  historyBytes: 0,
                  inputBytes: 100,
                  questionBytes: 20,
                  historyTurns: 0,
                  estimatedTokens: 100,
                  questionReserveTokens: 900,
                  responseReserveTokens: 2048,
                },
              }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AiPanel);
    fixture.componentRef.setInput('context', context);
    await TestBed.inject(AiStore).refresh();
    fixture.detectChanges();
    await fixture.whenStable();
    catalog = TestBed.inject(AiCatalog);
  });

  function write(value: string): HTMLTextAreaElement {
    const input = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    return input;
  }

  function enter(input: HTMLTextAreaElement): void {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  }

  it('una mención resuelta con Enter selecciona la tabla y no envía todavía la pregunta', async () => {
    const input = write('Usa @fact');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.catalog-option')).toBeTruthy();
    });
    enter(input);
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    expect(catalog.selected()[0].table.name).toBe('facturas');
    expect(stream).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(input.value).toContain('"main"."facturas"');
  });

  it('un fallo de metadatos mantiene el borrador y exige aceptar el contexto parcial', async () => {
    columns.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Sin permiso' } })),
    );
    catalog.add(table);
    await vi.waitFor(() => expect(catalog.loading()).toBe(false));
    const input = write('Explica facturas');
    enter(input);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.catalog-status')).toBeNull();
      expect(fixture.nativeElement.querySelector('.catalog-picker')).toBeTruthy();
    });
    expect(stream).not.toHaveBeenCalled();
    expect(input.value).toBe('Explica facturas');
    catalog.allowPartial.set(true);
    enter(input);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeTruthy();
    });
    expect(stream).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('app-ai-preview .confirm').click();
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    const request = stream.mock.calls[0][0];
    expect(request.context.warnings[0]).toContain('facturas');
    expect(request.context.schema).toBeUndefined();
  });

  it('envía la copia revisada aunque cambie el SQL abierto y conserva el hash', async () => {
    enter(write('Pregunta preparada'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeTruthy();
    });
    expect(stream).not.toHaveBeenCalled();
    fixture.componentRef.setInput('context', { ...context, sql: 'SELECT cambiado;' });
    fixture.detectChanges();
    fixture.nativeElement.querySelector('app-ai-preview .confirm').click();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0].context.sql).toBe('SELECT 1;');
    expect(stream.mock.calls[0][0].previewHash).toBe('preparado');
  });

  it('cambiar de base descarta una vista previa sin enviar', async () => {
    enter(write('Pregunta preparada'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeTruthy();
    });
    fixture.componentRef.setInput('context', {
      ...context,
      database: 'otra',
      source: { ...context.source, database: 'otra' },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it('la petición del explorador se consume una vez y editar SQL no vuelve a añadir una tabla quitada', async () => {
    fixture.componentRef.setInput('requestedTable', table);
    fixture.detectChanges();
    await vi.waitFor(() => expect(catalog.selected()).toHaveLength(1));
    catalog.remove(table);
    fixture.componentRef.setInput('context', { ...context, sql: 'SELECT 2;' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(catalog.selected()).toEqual([]);
  });

  it('un selector abierto carga el catálogo de la nueva base al cambiar de origen', async () => {
    write('Usa @fact');
    await vi.waitFor(() => expect(catalog.catalog()).toHaveLength(1));
    const gateway = TestBed.inject(ApplicationGateway);
    vi.spyOn(gateway, 'getDatabases').mockReturnValue(
      of([{ id: 'otra', name: 'otra', kind: 'database', hasChildren: true }]),
    );
    vi.spyOn(gateway, 'getChildren').mockImplementation((_, parent) =>
      of([{ ...table, database: parent.database }]),
    );
    fixture.componentRef.setInput('context', {
      ...context,
      database: 'otra',
      source: { ...context.source, database: 'otra' },
    });
    fixture.detectChanges();
    await vi.waitFor(() => expect(catalog.catalog()[0]?.database).toBe('otra'));
    expect(catalog.selected()).toEqual([]);
    expect(stream).not.toHaveBeenCalled();
  });
});
