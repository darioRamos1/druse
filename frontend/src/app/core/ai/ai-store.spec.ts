import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of } from 'rxjs';

import { AiStore } from './ai-store';
import { ApplicationGateway } from '../application-gateway/application-gateway';
import { AiChatRequest, AiProvider, AiStreamEvent } from '../../shared/models/ai';

const provider: AiProvider = {
  id: 'p1',
  name: 'MaaS corporativo',
  kind: 'openaicompatible',
  baseUrl: 'https://maas.local/v1',
  model: 'DeepSeek-V3',
  command: '',
  disclosure: 'schema',
  isDefault: true,
  hasStoredKey: true,
};

describe('AiStore', () => {
  let stream: Subject<AiStreamEvent>;
  let lastRequest: AiChatRequest | null;
  let subscriptions: number;
  let unsubscriptions: number;

  beforeEach(() => {
    stream = new Subject<AiStreamEvent>();
    lastRequest = null;
    subscriptions = 0;
    unsubscriptions = 0;

    const gateway = {
      getAiProviders: () =>
        of({ providers: [provider], canStoreKeys: true, storeDescription: 'Credenciales' }),
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

  it('no lanza dos peticiones a la vez', async () => {
    const store = await ready();

    store.ask('una');
    store.ask('otra');

    expect(subscriptions).toBe(1);
  });

  /** El contexto es lo que sale del equipo: solo viaja si se le pasa. */
  it('manda el contexto solo cuando se le da', async () => {
    const store = await ready();

    store.ask('con esquema', 'Tablas disponibles: accionista.');
    expect(lastRequest!.context).toBe('Tablas disponibles: accionista.');

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
    expect(store.providers().length).toBe(1);
  });
});
