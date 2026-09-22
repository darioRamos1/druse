import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import { I18nService } from '../i18n/i18n.service';
import {
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
  /** El proveedor falló a media respuesta. Se enseña debajo de lo que sí llegó. */
  readonly error?: string;
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
  private readonly _turns = signal<readonly ChatTurn[]>([]);
  private readonly _busy = signal(false);
  private readonly _canStoreKeys = signal(true);
  private readonly _storeDescription = signal('');

  /** Suscripción viva mientras el modelo escribe. Cancelarla corta la petición. */
  private _stream: Subscription | null = null;

  readonly providers = this._providers.asReadonly();
  readonly turns = this._turns.asReadonly();
  readonly busy = this._busy.asReadonly();
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

  /**
   * Manda la pregunta y va escribiendo la respuesta según llega.
   *
   * El turno del asistente se crea **vacío y marcado** antes de que llegue nada:
   * así la pantalla puede enseñar que está pensando en el sitio donde va a
   * aparecer el texto, en lugar de dejar un hueco.
   */
  ask(text: string, context?: string): void {
    const provider = this.active();

    if (!provider || this._busy()) {
      return;
    }

    const historia: AiMessage[] = [
      ...this._turns()
        .filter((turn) => !turn.error)
        .map((turn) => ({ role: turn.role, text: turn.text }) as AiMessage),
      { role: 'user', text },
    ];

    this._turns.update((turns) => [
      ...turns,
      { role: 'user', text },
      { role: 'assistant', text: '', streaming: true },
    ]);
    this._busy.set(true);

    this._stream = this._gateway
      .streamAiChat({ providerId: provider.id, messages: historia, context })
      .subscribe({
        next: (event) => {
          if (event.kind === 'chunk') {
            this.appendToLast(event.text);
          } else if (event.kind === 'error') {
            this.failLast(event.message);
          }
        },
        error: (error: unknown) => {
          this.failLast(error instanceof Error ? error.message : this._i18n.t('ai.noAnswer'));
          this.settle();
        },
        complete: () => {
          this.finishLast();
          this.settle();
        },
      });
  }

  /** Corta la respuesta a medias, dejando lo que ya se escribió. */
  cancel(): void {
    this._stream?.unsubscribe();
    this._stream = null;
    this.finishLast();
    this._busy.set(false);
  }

  /** Empieza de cero. No toca los proveedores. */
  clear(): void {
    this.cancel();
    this._turns.set([]);
  }

  private appendToLast(text: string): void {
    this._turns.update((turns) => {
      if (turns.length === 0) {
        return turns;
      }

      const last = turns[turns.length - 1];

      return [...turns.slice(0, -1), { ...last, text: last.text + text }];
    });
  }

  private failLast(message: string): void {
    this._turns.update((turns) => {
      if (turns.length === 0) {
        return turns;
      }

      const last = turns[turns.length - 1];

      return [...turns.slice(0, -1), { ...last, streaming: false, error: message }];
    });
  }

  private finishLast(): void {
    this._turns.update((turns) => {
      if (turns.length === 0) {
        return turns;
      }

      const last = turns[turns.length - 1];

      return last.streaming ? [...turns.slice(0, -1), { ...last, streaming: false }] : turns;
    });
  }

  private settle(): void {
    this._busy.set(false);
    this._stream = null;
  }

  /** Convierte un observable de una sola respuesta en promesa, que es como se usa aquí. */
  private once<T>(source: import('rxjs').Observable<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      source.subscribe({ next: resolve, error: reject });
    });
  }
}
