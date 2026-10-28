import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError, Subject, firstValueFrom } from 'rxjs';
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
                  maxErrorBytes: 16384,
                  maxRowsBytes: 32768,
                  maxPlanBytes: 16384,
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
                  errorBytes: 0,
                  rowsBytes: 0,
                  planBytes: 0,
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
    const input = fixture.nativeElement.querySelector('.composer__input') as HTMLTextAreaElement;
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

  const planAttachment = {
    source: context.source,
    plan: {
      format: 'sqlite-query-plan' as const,
      executionId: 'e1',
      occurredAtUtc: '2026-10-19T12:00:00Z',
      sql: 'EXPLAIN QUERY PLAN SELECT * FROM clientes;',
      text: 'SCAN clientes',
    },
  };

  it('actualiza la pregunta sugerida al sustituir un plan y conserva una pregunta propia', () => {
    fixture.componentRef.setInput('requestedPlan', planAttachment);
    fixture.detectChanges();
    const planQuestion = fixture.nativeElement.querySelector('.composer__input').value;
    fixture.componentRef.setInput('requestedError', attachment);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.composer__input').value).not.toBe(planQuestion);
    fixture.componentRef.setInput('requestedPlan', { ...planAttachment });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.composer__input').value).toBe(planQuestion);
    write('Mi pregunta concreta');
    fixture.componentRef.setInput('requestedError', { ...attachment });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.composer__input').value).toBe(
      'Mi pregunta concreta',
    );
    expect(fixture.nativeElement.querySelector('app-ai-execution-plan')).toBeNull();
  });

  it('permite editar y quitar el plan sin restaurarlo al cambiar el editor', async () => {
    fixture.componentRef.setInput('requestedPlan', planAttachment);
    fixture.detectChanges();
    const editor = fixture.nativeElement.querySelector('app-ai-execution-plan');
    expect(editor.textContent).toContain('e1');
    const sql = editor.querySelector('textarea') as HTMLTextAreaElement;
    expect(sql.value).toBe(planAttachment.plan.sql);
    sql.value = 'SQL revisado';
    sql.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    enter(write('Analiza'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeTruthy();
    });
    expect(stream).not.toHaveBeenCalled();
    const preview = fixture.nativeElement.querySelector('app-ai-preview');
    preview.querySelectorAll('button')[1].click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('app-ai-execution-plan button').click();
    fixture.componentRef.setInput('context', { ...context, sql: 'SELECT posterior;' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-execution-plan')).toBeNull();
  });

  it('el plan se descarta al cambiar de base y el permiso solo pregunta bloquea su envío', async () => {
    fixture.componentRef.setInput('requestedPlan', planAttachment);
    fixture.detectChanges();
    const gateway = TestBed.inject(ApplicationGateway);
    vi.spyOn(gateway, 'getAiProviders').mockReturnValue(
      of({
        providers: [{ ...provider, disclosure: 'nothing' }],
        canStoreKeys: true,
        storeDescription: '',
      }),
    );
    await TestBed.inject(AiStore).refresh();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.composer__send').disabled).toBe(true);
    enter(write('Analiza'));
    await fixture.whenStable();
    expect(stream).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeNull();
    fixture.componentRef.setInput('context', {
      ...context,
      database: 'otra',
      source: { ...context.source, database: 'otra' },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-execution-plan')).toBeNull();
  });

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

  const rowsRequest = {
    source: context.source,
    executionId: 'filas-1',
    occurredAtUtc: '2026-10-19T13:00:00Z',
    resultSetIndex: 0,
    resultSet: {
      columns: [
        { name: 'id', dataType: 'integer', kind: 'number' as const, width: null },
        { name: 'secreto', dataType: 'text', kind: 'text' as const, width: null },
        { name: 'detalle', dataType: 'text', kind: 'text' as const, width: null },
      ],
      rows: [{ number: 1, values: ['1', 'DATO_PRIVADO', 'á'.repeat(600)] }],
      totalRows: 1,
      durationMs: 1,
      truncated: false,
    },
  };

  async function grantRows(): Promise<void> {
    vi.spyOn(TestBed.inject(ApplicationGateway), 'getAiProviders').mockReturnValue(
      of({
        providers: [{ ...provider, disclosure: 'schemaAndRows' }],
        canStoreKeys: true,
        storeDescription: '',
      }),
    );
    await TestBed.inject(AiStore).refresh();
    fixture.detectChanges();
  }

  it('consume la entrega del shell una vez y retiene solo el selector pendiente al limpiar la entrada', () => {
    const received = vi.fn(() => fixture.componentRef.setInput('requestedRows', null));
    fixture.componentInstance.rowsReceived.subscribe(received);
    fixture.componentRef.setInput('requestedRows', rowsRequest);
    fixture.detectChanges();
    expect(received).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.requestedRows()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-ai-rows')).toBeTruthy();
    fixture.componentRef.setInput('context', { ...context, sql: 'SELECT posterior;' });
    fixture.detectChanges();
    expect(received).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('app-ai-rows input:checked')).toBeNull();
  });

  function checkRows(selector: string): void {
    const checkbox = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
  }

  it('elegir filas requiere permiso, no envía nada al abrir y conserva la selección al volver de la revisión', async () => {
    fixture.componentRef.setInput('requestedRows', rowsRequest);
    fixture.detectChanges();
    expect(stream).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-ai-rows input:checked')).toBeNull();
    expect(fixture.nativeElement.querySelector('.composer__send').disabled).toBe(true);
    await grantRows();
    checkRows('app-ai-rows .column input');
    checkRows('app-ai-rows tbody input');
    enter(write('Analiza'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeTruthy();
    });
    const buttons = fixture.nativeElement.querySelectorAll('app-ai-preview .actions button');
    buttons[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('app-ai-rows tbody input').checked).toBe(true);
    expect(fixture.nativeElement.querySelector('app-ai-rows .column input').checked).toBe(true);
    enter(write('Analiza'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeTruthy();
    });
    fixture.nativeElement.querySelector('app-ai-preview .confirm').click();
    expect(stream).toHaveBeenCalledTimes(1);
    const payload = stream.mock.calls[0][0] as AiChatRequest;
    expect(payload.context?.sql).toBeUndefined();
    expect(payload.context?.rows?.columns.map((column) => column.name)).toEqual(['id']);
    expect(JSON.stringify(payload)).not.toContain('DATO_PRIVADO');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-rows')).toBeNull();
  });

  it('los textos grandes exigen aceptar el recorte y cambiar de base retira la muestra', async () => {
    await grantRows();
    fixture.componentRef.setInput('requestedRows', rowsRequest);
    fixture.detectChanges();
    checkRows('app-ai-rows .column:nth-child(3) input');
    checkRows('app-ai-rows tbody input');
    expect(fixture.nativeElement.querySelector('.composer__send').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('app-ai-rows').textContent).toContain('1200 bytes');
    checkRows('app-ai-rows .accept input');
    expect(fixture.nativeElement.querySelector('.composer__send').disabled).toBe(false);
    fixture.componentRef.setInput('context', {
      ...context,
      database: 'otra',
      source: { ...context.source, database: 'otra' },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-rows')).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  const attachment = {
    source: context.source,
    error: {
      executionId: 'ejecucion-1',
      occurredAtUtc: '2026-10-16T12:00:00Z',
      sql: 'SELECT fallo;',
      message: 'No existe fallo',
      code: '42703',
      line: 1,
      position: 8,
    },
  };

  it('adjunta solo el SQL ejecutado, permite ocultar datos y exige confirmar la revisión', async () => {
    fixture.componentRef.setInput('requestedError', attachment);
    fixture.detectChanges();
    const sql = fixture.nativeElement.querySelector(
      'app-ai-execution-error textarea',
    ) as HTMLTextAreaElement;
    expect(sql.value).toBe('SELECT fallo;');
    sql.value = 'SELECT ocultado;';
    sql.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(stream).not.toHaveBeenCalled();
    enter(write('Explica el error'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeTruthy();
    });
    fixture.componentRef.setInput('context', { ...context, sql: 'SELECT posterior;' });
    fixture.detectChanges();
    expect(stream).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('app-ai-preview .confirm').click();
    expect(stream).toHaveBeenCalledTimes(1);
    const request = stream.mock.calls[0][0];
    expect(request.context.sql).toBeUndefined();
    expect(request.context.executionError).toEqual({
      ...attachment.error,
      sql: 'SELECT ocultado;',
    });
    expect(request.context.source).toEqual(attachment.source);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-execution-error')).toBeNull();
    expect(attachment.error.sql).toBe('SELECT fallo;');
  });

  it('retira el error al cambiar de base y no lo recupera al editar SQL', () => {
    fixture.componentRef.setInput('requestedError', attachment);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-execution-error')).toBeTruthy();
    fixture.componentRef.setInput('context', {
      ...context,
      database: 'otra',
      source: { ...context.source, database: 'otra' },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-execution-error')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Se retiró el error adjunto');
    fixture.componentRef.setInput('context', { ...context, sql: 'SELECT posterior;' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-execution-error')).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it('quitar el adjunto invalida una revisión que todavía está llegando', async () => {
    fixture.componentRef.setInput('requestedError', attachment);
    fixture.detectChanges();
    const gateway = TestBed.inject(ApplicationGateway);
    const request = TestBed.inject(AiStore).prepare('Explica', {
      source: context.source,
      tables: [],
    })!;
    const preview = await firstValueFrom(gateway.previewAiChat(request.payload));
    const pending = new Subject<typeof preview>();
    vi.spyOn(gateway, 'previewAiChat').mockReturnValue(pending);
    enter(write('Explica'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('app-ai-execution-error button').click();
    pending.next(preview);
    pending.complete();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-ai-execution-error')).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it('no muestra posiciones vacías cuando el motor devuelve null', () => {
    fixture.componentRef.setInput('requestedError', {
      ...attachment,
      error: { ...attachment.error, line: null, position: null },
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('app-ai-execution-error').textContent;
    expect(text).not.toContain('Línea:');
    expect(text).not.toContain('Posición:');
  });

  it('bloquea el envío del error cuando se revoca el permiso de contexto', async () => {
    fixture.componentRef.setInput('requestedError', attachment);
    fixture.detectChanges();
    const gateway = TestBed.inject(ApplicationGateway);
    vi.spyOn(gateway, 'getAiProviders').mockReturnValue(
      of({
        providers: [{ ...provider, disclosure: 'nothing' }],
        canStoreKeys: true,
        storeDescription: '',
      }),
    );
    await TestBed.inject(AiStore).refresh();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.composer__send').disabled).toBe(true);
    enter(write('Explica'));
    await fixture.whenStable();
    expect(stream).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-ai-preview')).toBeNull();
    fixture.nativeElement.querySelector('app-ai-execution-error button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.composer__send').disabled).toBe(false);
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
