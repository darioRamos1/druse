import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of } from 'rxjs';

import { AiStore } from './ai-store';
import { ApplicationGateway } from '../application-gateway/application-gateway';
import {
  AiChatRequest,
  AiContextSnapshot,
  AiProvider,
  AiStreamEvent,
} from '../../shared/models/ai';

const provider: AiProvider = {
  id: 'p1',
  name: 'MaaS corporativo',
  kind: 'openaicompatible',
  baseUrl: 'https://maas.local/v1',
  model: 'DeepSeek-V3',
  command: '',
  disclosure: 'schema',
  ownSession: false,
  isDefault: true,
  hasStoredKey: true,
};

describe('AiStore', () => {
  let stream: Subject<AiStreamEvent>;
  let lastRequest: AiChatRequest | null;
  let subscriptions: number;
  let unsubscriptions: number;
  let savedProvider: AiProvider;
  let providers: AiProvider[];

  beforeEach(() => {
    savedProvider = provider;
    providers = [provider, { ...provider, id: 'p2', name: 'Otro proveedor' }];
    stream = new Subject<AiStreamEvent>();
    lastRequest = null;
    subscriptions = 0;
    unsubscriptions = 0;

    const gateway = {
      getAiProviders: () => of({ providers, canStoreKeys: true, storeDescription: 'Credenciales' }),
      saveAiProvider: () => of(savedProvider),
      setAiNotesSharing: (_id: string, enabled: boolean) =>
        of({ ...provider, shareBusinessNotes: enabled }),
      streamAiChat: (request: AiChatRequest) => {
        lastRequest = request;

        return new Observable<AiStreamEvent>((subscriber) => {
          subscriptions += 1;
          const inner = stream.subscribe(subscriber);

          return () => {
            unsubscriptions += 1;
            inner.unsubscribe();
          };
        });
      },
    };

    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    });
  });

  async function ready(): Promise<AiStore> {
    const store = TestBed.inject(AiStore);

    await store.refresh();

    return store;
  }

  it('congela el error y su procedencia para el reintento y el historial', async () => {
    const store = await ready();
    const source = { connectionId: 'c1', connectionName: 'Prueba', database: 'ventas' };
    store.setSource(source);
    const error = {
      executionId: 'e1',
      occurredAtUtc: '2026-10-16T12:00:00Z',
      sql: 'SELECT fallo;',
      message: 'Fallo original',
    };
    const request = store.prepare('Explica', { source, tables: [], executionError: error })!;
    error.sql = 'SELECT cambiado;';
    error.message = 'Otro error';
    expect(request.context?.executionError?.sql).toBe('SELECT fallo;');
    store.sendPrepared(request);
    stream.next({ kind: 'error', message: 'Fallo del proveedor' });
    stream.complete();
    stream = new Subject<AiStreamEvent>();
    store.retry();
    expect(lastRequest?.context?.executionError?.message).toBe('Fallo original');
    stream.next({ kind: 'chunk', text: 'Respuesta' });
    stream.next({ kind: 'done' });
    stream.complete();
    const following = store.prepare('Siguiente');
    expect(following?.payload.messages[0].context?.executionError?.sql).toBe('SELECT fallo;');
    expect(following?.context?.executionError).toBeUndefined();
  });

  /**
   * El proveedor va a la base local y su clave al llavero del sistema: dos
   * escrituras, y la segunda puede fallar sola. El aviso tiene que llegar entero
   * hasta quien guardó, porque el diálogo lo enseña en lugar de cerrarse; si el
   * almacén lo perdiera por el camino, el usuario cerraría creyendo que su clave
   * quedó recordada.
   */
  it('devuelve el aviso del llavero al guardar', async () => {
    savedProvider = {
      ...provider,
      secretWarning: 'No se pudo guardar la clave del proveedor en Credenciales.',
    };

    const store = await ready();

    const saved = await store.save({
      name: provider.name,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      model: provider.model,
      command: provider.command,
      disclosure: provider.disclosure,
      ownSession: provider.ownSession,
      isDefault: true,
    });

    expect(saved.secretWarning).toContain('No se pudo guardar la clave');
  });

  it('toma como activo el marcado por omisión', async () => {
    const store = await ready();

    expect(store.active()?.id).toBe('p1');
    expect(store.configured()).toBe(true);
  });

  /**
   * El turno del asistente se crea vacío antes de que llegue nada, para que la
   * pantalla pueda enseñar que está pensando donde va a aparecer el texto.
   */
  it('abre el turno del asistente antes del primer trozo', async () => {
    const store = await ready();

    store.ask('¿cuántos accionistas hay?');

    expect(store.turns().length).toBe(2);
    expect(store.turns()[1]).toEqual({ role: 'assistant', text: '', streaming: true });
    expect(store.busy()).toBe(true);
  });

  it('va concatenando los trozos según llegan', async () => {
    const store = await ready();

    store.ask('dame el SQL');
    stream.next({ kind: 'chunk', text: 'SELECT ' });
    stream.next({ kind: 'chunk', text: '1' });

    expect(store.turns()[1].text).toBe('SELECT 1');
  });

  it('al terminar deja de estar ocupado y quita la marca', async () => {
    const store = await ready();

    store.ask('hola');
    stream.next({ kind: 'chunk', text: 'hola' });
    stream.complete();

    expect(store.busy()).toBe(false);
    expect(store.turns()[1].streaming).toBeFalsy();
  });

  /**
   * El fallo se enseña **debajo de lo que sí llegó**: perder media respuesta
   * porque el proveedor cortó al final sería perder lo único útil que hubo.
   */
  it('conserva lo escrito cuando el proveedor falla a media respuesta', async () => {
    const store = await ready();

    store.ask('dame el SQL');
    stream.next({ kind: 'chunk', text: 'SELECT 1' });
    stream.next({ kind: 'error', message: 'El proveedor rechazó la clave.' });

    expect(store.turns()[1].text).toBe('SELECT 1');
    expect(store.turns()[1].error).toBe('El proveedor rechazó la clave.');
  });

  it('cancelar corta la petición de verdad', async () => {
    const store = await ready();

    store.ask('algo largo');
    stream.next({ kind: 'chunk', text: 'parcial' });
    store.cancel();

    expect(unsubscriptions).toBe(1);
    expect(store.busy()).toBe(false);
    expect(store.turns()[1].text).toBe('parcial');
  });

  it('explica el rechazo del modelo y conserva el detalle original', async () => {
    const store = await ready();
    store.ask('hola');
    stream.next({
      kind: 'error',
      code: 'unsupportedModel',
      message: 'model is not supported',
      detail: '{"error":"model is not supported"}',
    });
    stream.complete();
    expect(store.turns()[1].error).toContain('no admite este modelo');
    expect(store.turns()[1].errorDetail).toBe('{"error":"model is not supported"}');
    expect(store.busy()).toBe(false);
  });

  it('no lanza dos peticiones a la vez', async () => {
    const store = await ready();

    store.ask('una');
    store.ask('otra');

    expect(subscriptions).toBe(1);
  });

  /** El contexto es lo que sale del equipo: solo viaja si se le pasa. */
  it('manda el contexto solo cuando se le da', async () => {
    const store = await ready();

    store.ask('con esquema', context());
    expect(lastRequest!.context?.schema).toBe('TABLE accionista;');

    store.cancel();
    store.ask('sin esquema');
    expect(lastRequest!.context).toBeUndefined();
  });

  /** La conversación anterior viaja para que el modelo entienda un «y ahora ordénalo». */
  it('manda los turnos anteriores con la pregunta nueva', async () => {
    const store = await ready();

    store.ask('primera');
    stream.next({ kind: 'chunk', text: 'respuesta' });
    stream.complete();

    store.ask('segunda');

    expect(lastRequest!.messages.map((message) => message.text)).toEqual([
      'primera',
      'respuesta',
      'segunda',
    ]);
  });

  it('empezar de nuevo vacía la conversación pero no los proveedores', async () => {
    const store = await ready();

    store.ask('algo');
    store.clear();

    expect(store.turns()).toEqual([]);
    expect(store.providers().length).toBe(2);
  });

  function context(): AiContextSnapshot {
    return {
      source: { connectionId: 'c1', connectionName: 'Pruebas', database: 'ventas' },
      schema: 'TABLE accionista;',
      sql: 'SELECT 1',
      tables: ['accionista'],
    };
  }

  it('recupera el historial por conexión y base sin mezclar bases homónimas', async () => {
    const store = await ready();
    const source = context().source;
    store.setSource(source);
    store.ask('primera base', context());
    store.cancel();
    store.setSource({ ...source, database: 'otra' });
    expect(store.turns()).toEqual([]);
    store.setSource({ ...source, connectionId: 'c2' });
    expect(store.turns()).toEqual([]);
    store.setSource(source);
    expect(store.turns()[0].text).toBe('primera base');
  });

  it('separa proveedores y recupera su conversación al volver', async () => {
    const store = await ready();
    store.ask('para p1');
    store.cancel();
    store.use('p2');
    expect(store.turns()).toEqual([]);
    store.ask('para p2');
    expect(lastRequest!.messages.map((message) => message.text)).toEqual(['para p2']);
    store.cancel();
    store.use('p1');
    expect(store.turns()[0].text).toBe('para p1');
  });

  it('no recupera historial al cambiar modelo o reducir permisos', async () => {
    const store = await ready();
    store.ask('con estructura', context());
    store.cancel();
    providers = [{ ...provider, model: 'otro-modelo' }];
    await store.refresh();
    expect(store.turns()).toEqual([]);
    providers = [{ ...provider, disclosure: 'nothing' }];
    await store.refresh();
    store.ask('sin estructura', context());
    expect(lastRequest!.context).toBeUndefined();
    expect(lastRequest!.messages).toEqual([{ role: 'user', text: 'sin estructura' }]);
  });

  it('la respuesta en curso termina en su base aunque haya otra petición abierta', async () => {
    const store = await ready();
    const source = context().source;
    store.setSource(source);
    store.ask('base A');
    const first = stream;
    store.setSource({ ...source, database: 'B' });
    expect(store.busy()).toBe(false);
    stream = new Subject<AiStreamEvent>();
    store.ask('base B');
    first.next({ kind: 'chunk', text: 'respuesta A' });
    first.complete();
    expect(store.turns()[1].text).toBe('');
    expect(store.busy()).toBe(true);
    stream.next({ kind: 'chunk', text: 'respuesta B' });
    stream.complete();
    store.setSource(source);
    expect(store.turns()[1].text).toBe('respuesta A');
    expect(store.busy()).toBe(false);
  });

  it('conserva una copia del contexto y reintenta sin duplicar la pregunta', async () => {
    const store = await ready();
    const original = { ...context(), tables: ['accionista'] };
    store.ask('consulta', original);
    stream.next({ kind: 'error', message: 'Falló' });
    stream.complete();
    original.tables.push('otra');
    original.sql = 'SELECT cambiado';
    stream = new Subject<AiStreamEvent>();
    store.retry();
    expect(store.turns().length).toBe(2);
    expect(lastRequest!.messages.map((message) => message.text)).toEqual(['consulta']);
    expect(lastRequest!.context?.tables).toEqual(['accionista']);
    expect(lastRequest!.context?.sql).toBe('SELECT 1');
    stream.next({ kind: 'chunk', text: 'Ahora sí' });
    stream.complete();
    expect(store.turns()[1].error).toBeUndefined();
    expect(store.turns()[1].text).toBe('Ahora sí');
  });

  it('registra la confirmación del servidor y conserva el contexto de preguntas anteriores', async () => {
    const store = await ready();
    store.ask('primera', context());
    stream.next({
      kind: 'context',
      text: 'Contexto filtrado',
      hash: 'revisado',
      providerId: 'p1',
      model: provider.model,
      disclosure: 'schema',
    });
    stream.next({ kind: 'chunk', text: 'respuesta' });
    stream.complete();
    expect(store.turns()[0].request?.sentContext).toBe('Contexto filtrado');
    expect(store.turns()[0].request?.sentHash).toBe('revisado');
    store.ask('segunda');
    expect(lastRequest!.messages[0].context?.sql).toBe('SELECT 1');
    expect(store.turns()[0].request?.sentContext).toBe('Contexto filtrado');
  });

  it('aísla el historial al cambiar el permiso y conserva las notas originales al reintentar', async () => {
    const store = await ready();
    const note = {
      id: 'n1',
      connectionId: 'c1',
      database: 'ventas',
      text: 'Sin IVA',
      enabled: true,
      reference: {
        objectId: 't1',
        schema: 'public',
        table: 'facturas',
        kind: 'table' as const,
        column: 'importe',
      },
      updatedAtUtc: '2026-10-16T00:00:00Z',
      formatVersion: 1,
    };
    store.ask('sin permiso', { ...context(), notes: [note] });
    expect(lastRequest!.context?.notes).toBeUndefined();
    store.cancel();
    await store.setNotesSharing('p1', true);
    expect(store.turns()).toEqual([]);
    stream = new Subject<AiStreamEvent>();
    store.ask('con permiso', { ...context(), notes: [note] });
    stream.next({ kind: 'error', message: 'Falló' });
    stream.complete();
    note.text = 'Con IVA';
    note.reference.column = 'otra';
    stream = new Subject<AiStreamEvent>();
    store.retry();
    expect(lastRequest!.shareBusinessNotes).toBe(true);
    expect(lastRequest!.context?.notes?.[0].text).toBe('Sin IVA');
    expect(lastRequest!.context?.notes?.[0].reference?.column).toBe('importe');
    store.cancel();
    await store.setNotesSharing('p1', false);
    expect(store.turns()[0].text).toBe('sin permiso');
    store.ask('otra sin permiso', { ...context(), notes: [note] });
    expect(lastRequest!.shareBusinessNotes).toBe(false);
    expect(lastRequest!.messages.map((message) => message.text)).not.toContain('con permiso');
  });

  it('omite también la pregunta de una respuesta fallida al continuar', async () => {
    const store = await ready();
    store.ask('fallida');
    stream.next({ kind: 'error', message: 'Falló' });
    stream.complete();
    store.ask('otra pregunta');
    expect(lastRequest!.messages.map((message) => message.text)).toEqual(['otra pregunta']);
  });

  it('prepara sin enviar y reduce el historial sin quitar mensajes visibles', async () => {
    const store = await ready();
    store.ask('primera', context());
    stream.next({ kind: 'chunk', text: 'respuesta primera' });
    stream.complete();
    stream = new Subject<AiStreamEvent>();
    store.ask('segunda');
    stream.next({ kind: 'chunk', text: 'respuesta segunda' });
    stream.complete();
    stream = new Subject<AiStreamEvent>();
    const snapshot = store.prepare('tercera', context(), 1)!;
    expect(subscriptions).toBe(2);
    expect(store.turns()).toHaveLength(4);
    expect(snapshot.historyTurnIndices).toEqual([2]);
    expect(snapshot.omittedTurnIndices).toEqual([0]);
    expect(snapshot.payload.messages.map((message) => message.text)).toEqual([
      'segunda',
      'respuesta segunda',
      'tercera',
    ]);
    expect(store.sendPrepared(snapshot)).toBe(true);
    expect(store.turns()).toHaveLength(6);
    stream.next({ kind: 'error', message: 'Falló' });
    stream.complete();
    const originalPayload = lastRequest;
    stream = new Subject<AiStreamEvent>();
    store.retry();
    expect(lastRequest).toEqual(originalPayload);
    expect(store.turns()).toHaveLength(6);
  });

  it('no envía una copia preparada para otro proveedor o base', async () => {
    const store = await ready();
    const request = store.prepare('preparada', context())!;
    store.use('p2');
    expect(store.sendPrepared(request)).toBe(false);
    store.use('p1');
    store.setSource({ ...context().source, database: 'otra' });
    expect(store.sendPrepared(request)).toBe(false);
    expect(subscriptions).toBe(0);
  });
});
