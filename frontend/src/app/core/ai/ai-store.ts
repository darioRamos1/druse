import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import { I18nService } from '../i18n/i18n.service';
import { aiFailureMessage } from './ai-failure';
import {
  AiContextSnapshot,
  AiChatRequest,
  AiChatPreview,
  AiChatUsage,
  AiSource,
  AiMessage,
  AiProvider,
  AiProviderList,
  SaveAiProviderRequest,
} from '../../shared/models/ai';

/** Un turno de la conversación tal y como se pinta. */
export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  /** Todavía llegando. Solo puede serlo el último. */
  readonly streaming?: boolean;
  /** Copia de la petición: cambiar de base o editar el SQL no reescribe el pasado. */
  readonly request?: AiChatRequestSnapshot;
  /** El proveedor falló a media respuesta. Se enseña debajo de lo que sí llegó. */
  readonly error?: string;
  readonly errorDetail?: string;
}

export interface AiChatRequestSnapshot {
  readonly source: AiSource;
  readonly provider: AiProvider;
  readonly createdAt: string;
  readonly context?: AiContextSnapshot;
  /** Confirmación del servidor de lo preparado para el proveedor. */
  readonly sentContext?: string;
  readonly sentHash?: string;
  readonly sentUsage?: AiChatUsage;
  readonly payload: AiChatRequest;
  readonly conversationKey: string;
  readonly historyTurnIndices: readonly number[];
  readonly omittedTurnIndices: readonly number[];
  readonly preview?: AiChatPreview;
}

interface Conversation {
  readonly turns: readonly ChatTurn[];
  readonly busy: boolean;
}

/**
 * El asistente: sus proveedores, su conversación y su estado.
 *
 * Vive en `core` y no en el componente porque la conversación **sobrevive a que
 * se cierre el panel**: quien lo cierra para ver una tabla y lo vuelve a abrir
 * espera encontrar lo que estaba leyendo, no una pantalla en blanco.
 */
@Injectable({ providedIn: 'root' })
export class AiStore {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _i18n = inject(I18nService);

  private readonly _providers = signal<readonly AiProvider[]>([]);
  private readonly _activeId = signal<string | null>(null);
  private readonly _source = signal<AiSource>({
    connectionId: '',
    connectionName: '',
    database: '',
  });
  private readonly _conversations = signal<ReadonlyMap<string, Conversation>>(new Map());
  private readonly _canStoreKeys = signal(true);
  private readonly _storeDescription = signal('');

  /** Suscripción viva mientras el modelo escribe. Cancelarla corta la petición. */
  private readonly _streams = new Map<string, Subscription>();

  readonly providers = this._providers.asReadonly();
  private readonly _key = computed(() => {
    const source = this._source();
    const provider = this.active();
    // Cambiar permisos o destino tampoco debe recuperar un historial más permisivo.
    return JSON.stringify([
      source.connectionId,
      source.database,
      source.engine,
      provider?.id,
      provider?.model,
      provider?.disclosure,
      provider?.shareBusinessNotes ?? false,
      provider?.baseUrl,
      provider?.kind,
      provider?.command,
      provider?.ownSession,
    ]);
  });
  readonly turns = computed(() => this._conversations().get(this._key())?.turns ?? []);
  readonly busy = computed(() => this._conversations().get(this._key())?.busy ?? false);

  setSource(source: AiSource): void {
    this._source.set({ ...source });
  }
  readonly canStoreKeys = this._canStoreKeys.asReadonly();
  readonly storeDescription = this._storeDescription.asReadonly();

  /**
   * El proveedor con el que se está hablando.
   *
   * Cae al marcado por omisión y, si no hay ninguno, al primero: un menú donde
   * lo primero no es lo que se va a usar engaña.
   */
  readonly active = computed(() => {
    const all = this._providers();
    const chosen = all.find((provider) => provider.id === this._activeId());

    return chosen ?? all.find((provider) => provider.isDefault) ?? all[0] ?? null;
  });

  /** Sin proveedores no hay asistente, y hay que decirlo en vez de fallar al preguntar. */
  readonly configured = computed(() => this._providers().length > 0);

  async refresh(): Promise<void> {
    const list = await this.once<AiProviderList>(this._gateway.getAiProviders());

    this._providers.set(list.providers);
    this._canStoreKeys.set(list.canStoreKeys);
    this._storeDescription.set(list.storeDescription);
  }

  async setNotesSharing(id: string, enabled: boolean): Promise<void> {
    const saved = await this.once(this._gateway.setAiNotesSharing(id, enabled));
    this._providers.update((providers) =>
      providers.map((provider) => (provider.id === id ? saved : provider)),
    );
  }

  use(id: string): void {
    this._activeId.set(id);
  }

  async save(request: SaveAiProviderRequest): Promise<AiProvider> {
    const saved = await this.once(this._gateway.saveAiProvider(request));

    await this.refresh();

    // El recién guardado pasa a ser el activo: quien acaba de configurarlo
    // quiere probarlo, no buscarlo en el menú.
    this._activeId.set(saved.id);

    return saved;
  }

  async remove(id: string): Promise<void> {
    await this.once(this._gateway.deleteAiProvider(id));

    if (this._activeId() === id) {
      this._activeId.set(null);
    }

    await this.refresh();
  }

  readonly historyQuestions = computed(() =>
    this.turns().flatMap((question, index, turns) => {
      const answer = turns[index + 1];
      return question.role === 'user' &&
        answer?.role === 'assistant' &&
        !answer.error &&
        !answer.streaming &&
        answer.text.trim()
        ? [{ index, text: question.text }]
        : [];
    }),
  );

  prepare(
    text: string,
    context?: AiContextSnapshot,
    historyLimit: number | null = null,
  ): AiChatRequestSnapshot | null {
    const provider = this.active();
    if (!provider || this.busy() || !text.trim()) return null;
    const attached =
      provider.disclosure === 'nothing' || !context
        ? undefined
        : cloneContext({
            ...context,
            notes: provider.shareBusinessNotes ? context.notes : undefined,
          });
    const questions = this.historyQuestions();
    const selected =
      historyLimit === null
        ? questions
        : historyLimit <= 0
          ? []
          : questions.slice(-Math.floor(historyLimit));
    const historyTurnIndices = selected.map((question) => question.index);
    const messages: AiMessage[] = selected.flatMap((question) => [
      {
        role: 'user' as const,
        text: question.text,
        context: this.turns()[question.index].request?.context,
      },
      { role: 'assistant' as const, text: this.turns()[question.index + 1].text },
    ]);
    messages.push({ role: 'user', text: text.trim() });
    return {
      source: { ...this._source() },
      provider: { ...provider },
      createdAt: new Date().toISOString(),
      context: attached,
      conversationKey: this._key(),
      historyTurnIndices,
      omittedTurnIndices: questions
        .filter((question) => !historyTurnIndices.includes(question.index))
        .map((question) => question.index),
      payload: {
        providerId: provider.id,
        model: provider.model,
        disclosure: provider.disclosure,
        shareBusinessNotes: provider.shareBusinessNotes ?? false,
        context: attached,
        messages: messages.map((message) => ({
          ...message,
          context: message.context ? cloneContext(message.context) : undefined,
        })),
      },
    };
  }

  preview(request: AiChatRequestSnapshot): Promise<AiChatPreview> {
    return this.once(this._gateway.previewAiChat(request.payload));
  }

  /**
   * Manda la pregunta y va escribiendo la respuesta según llega.
   *
   * El turno del asistente se crea **vacío y marcado** antes de que llegue nada:
   * así la pantalla puede enseñar que está pensando en el sitio donde va a
   * aparecer el texto, en lugar de dejar un hueco.
   */
  ask(text: string, context?: AiContextSnapshot): void {
    const request = this.prepare(text, context);
    if (request) this.sendPrepared(request);
  }

  /** Envía la copia revisada, aunque cambie el editor; otro origen o proveedor la invalida. */
  sendPrepared(request: AiChatRequestSnapshot, preview?: AiChatPreview): boolean {
    if (this.busy() || request.conversationKey !== this._key() || (preview && !preview.valid))
      return false;
    const captured = {
      ...request,
      preview,
      payload: { ...request.payload, previewHash: preview?.hash },
    };
    this.patch(
      request.conversationKey,
      [
        ...this.turns(),
        { role: 'user', text: request.payload.messages.at(-1)!.text, request: captured },
        { role: 'assistant', text: '', streaming: true },
      ],
      true,
    );
    this.start(request.conversationKey, captured);
    return true;
  }

  /** Repite la última pregunta fallida con su contexto original, sin otro turno de usuario. */
  retry(): void {
    const turns = this.turns();
    const last = turns.at(-1);
    const question = turns.at(-2);
    const request = question?.request;
    if (this.busy() || !last?.error || question?.role !== 'user' || !request) return;
    const key = this._key();
    this.patch(
      key,
      [...turns.slice(0, -1), { role: 'assistant', text: '', streaming: true }],
      true,
    );
    this.start(key, request);
  }

  private start(key: string, request: AiChatRequestSnapshot): void {
    // Registrar antes de suscribir evita que una respuesta síncrona deje una suscripción fantasma.
    const stream = new Subscription();
    this._streams.set(key, stream);
    stream.add(
      this._gateway.streamAiChat(request.payload).subscribe({
        next: (event) => {
          if (event.kind === 'context') {
            this.update(key, (current) =>
              current.map((turn, index) =>
                index === current.length - 2
                  ? {
                      ...turn,
                      request: {
                        ...request,
                        sentContext: event.text,
                        sentHash: event.hash,
                        sentUsage: event.usage,
                      },
                    }
                  : turn,
              ),
            );
          } else if (event.kind === 'chunk') {
            this.updateLast(key, (last) => ({ ...last, text: last.text + event.text }));
          } else if (event.kind === 'error') {
            this.updateLast(key, (last) => ({
              ...last,
              streaming: false,
              error: aiFailureMessage(event, this._i18n),
              errorDetail: event.detail ?? event.message,
            }));
          }
        },
        error: (error: unknown) => {
          this.updateLast(key, (last) => ({
            ...last,
            streaming: false,
            error: error instanceof Error ? error.message : this._i18n.t('ai.noAnswer'),
          }));
          this.settle(key);
        },
        complete: () => this.settle(key),
      }),
    );
  }

  /** Cancelar y reiniciar solo afectan a la conversación que se está viendo. */
  cancel(): void {
    const key = this._key();
    this._streams.get(key)?.unsubscribe();
    this.settle(key);
  }

  clear(): void {
    this.cancel();
    this.patch(this._key(), [], false);
  }

  private patch(key: string, turns: readonly ChatTurn[], busy: boolean): void {
    this._conversations.update((all) => new Map(all).set(key, { turns, busy }));
  }

  private update(key: string, change: (turns: readonly ChatTurn[]) => readonly ChatTurn[]): void {
    const current = this._conversations().get(key);
    if (current) this.patch(key, change(current.turns), current.busy);
  }

  private updateLast(key: string, change: (turn: ChatTurn) => ChatTurn): void {
    this.update(key, (turns) =>
      turns.length ? [...turns.slice(0, -1), change(turns.at(-1)!)] : turns,
    );
  }

  private settle(key: string): void {
    this._streams.delete(key);
    const current = this._conversations().get(key);
    if (current)
      this.patch(
        key,
        current.turns.map((turn) => (turn.streaming ? { ...turn, streaming: false } : turn)),
        false,
      );
  }

  private once<T>(source: import('rxjs').Observable<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      source.subscribe({ next: resolve, error: reject });
    });
  }
}

function cloneContext(context: AiContextSnapshot): AiContextSnapshot {
  return {
    ...context,
    source: { ...context.source },
    tables: [...context.tables],
    warnings: context.warnings ? [...context.warnings] : undefined,
    notes: context.notes?.map((note) => ({
      ...note,
      reference: note.reference ? { ...note.reference } : null,
    })),
  };
}
