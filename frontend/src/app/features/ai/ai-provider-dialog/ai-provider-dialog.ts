import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';

import { AiStore } from '../../../core/ai/ai-store';
import {
  AiDisclosure,
  AiModelList,
  AiProvider,
  AiProviderKind,
  CliSessionState,
} from '../../../shared/models/ai';
import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { Icon } from '../../../shared/ui/icon/icon';
import { IconName } from '../../../shared/ui/icon/icon';

/** Una forma de llegar al modelo, tal y como se elige en el diálogo. */
interface ProviderOption {
  readonly id: string;
  readonly kind: AiProviderKind;
  readonly name: string;
  readonly detail: string;
  readonly icon: IconName;
  /** URL que se propone al elegirlo, para no partir de un campo en blanco. */
  readonly baseUrl: string;
  readonly model: string;
  /** Programa que atiende a esta opcion. Vacio en las que hablan por red. */
  readonly command?: string;
  /** URL de ejemplo, para que el campo vacio no sea una pregunta a ciegas. */
  readonly hint?: string;
  /** Se enseña para que se vea hacia dónde va el producto, pero no se puede elegir. */
  readonly available: boolean;
}

/**
 * Las formas de llegar a un modelo.
 *
 * «Compatible con OpenAI» y «IA local» son **el mismo mecanismo** con distinta
 * URL: se separan porque para quien configura no son la misma decisión —una
 * manda datos fuera y la otra no— y proponer `localhost:11434` ahorra buscar el
 * puerto de Ollama.
 *
 * Las dos ultimas son la misma pieza con distinto programa: hablan con un
 * ejecutable ya instalado y con la sesion iniciada de su dueno, que es lo unico
 * que permite usar una suscripcion personal sin pedirle credenciales a nadie.
 */
const OPTIONS: readonly ProviderOption[] = [
  {
    id: 'compatible',
    kind: 'openaicompatible',
    name: 'Compatible con OpenAI',
    detail: 'MaaS de empresa · Azure · OpenRouter',
    icon: 'schema',
    baseUrl: '',
    model: '',
    // Sin valores propuestos: cada empresa tiene su region y sus modelos, y uno
    // inventado se copia tal cual y falla con un 404 que no dice por que.
    hint: 'https://api-ap-southeast-1.modelarts-maas.com/openai/v1',
    available: true,
  },
  {
    id: 'local',
    kind: 'openaicompatible',
    name: 'IA local',
    detail: 'Ollama · LM Studio · vLLM',
    icon: 'console',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder',
    available: true,
  },
  {
    id: 'claude',
    kind: 'localcli',
    name: 'Tu cuenta Claude',
    detail: 'Pro o Max · por el programa claude',
    icon: 'sparkles',
    baseUrl: '',
    model: 'sonnet',
    command: 'claude',
    available: true,
  },
  {
    id: 'codex',
    kind: 'localcli',
    name: 'Tu cuenta ChatGPT',
    detail: 'Plus o Pro · por el programa codex',
    icon: 'sparkles',
    baseUrl: '',
    model: '',
    command: 'codex',
    available: true,
  },
];

/** Qué puede acompañar a la pregunta, dicho como lo entendería cualquiera. */
const DISCLOSURES: readonly { readonly value: AiDisclosure; readonly label: string }[] = [
  { value: 'schema', label: 'Estructura' },
  { value: 'schemaAndRows', label: 'Estructura y filas' },
  { value: 'nothing', label: 'Nada, solo lo que escriba' },
];

/**
 * Configurar quién responde al asistente.
 *
 * Sigue el patrón del diálogo de conexión, y no por parecido: es el mismo
 * problema —elegir un tipo, rellenar lo que ese tipo necesita, probar que
 * responde y guardarlo con su secreto aparte—, y resolverlo dos veces de dos
 * formas distintas obligaría a aprenderlo dos veces.
 */
@Component({
  selector: 'app-ai-provider-dialog',
  imports: [Icon],
  templateUrl: './ai-provider-dialog.html',
  styleUrl: './ai-provider-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiProviderDialog {
  private readonly _store = inject(AiStore);
  private readonly _gateway = inject(ApplicationGateway);

  readonly closed = output<void>();

  protected readonly options = OPTIONS;
  protected readonly disclosures = DISCLOSURES;

  protected readonly providers = this._store.providers;
  protected readonly canStoreKeys = this._store.canStoreKeys;
  protected readonly storeDescription = this._store.storeDescription;

  protected readonly chosen = signal<ProviderOption>(OPTIONS[0]);
  protected readonly editing = signal<AiProvider | null>(null);
  protected readonly name = signal('');
  protected readonly baseUrl = signal('');
  protected readonly model = signal('');
  protected readonly command = signal('');
  protected readonly disclosure = signal<AiDisclosure>('schema');
  protected readonly apiKey = signal<string | null>(null);
  protected readonly revealKey = signal(false);
  protected readonly probing = signal(false);
  protected readonly probe = signal<{ ok: boolean; detail: string; ms: number } | null>(null);
  protected readonly error = signal('');
  protected readonly saving = signal(false);

  /** Modelos que el proveedor dice tener, cuando se han pedido. */
  protected readonly models = signal<readonly string[]>([]);
  protected readonly listing = signal(false);

  /** Lo que se sabe de la sesion del programa elegido, cuando es uno. */
  protected readonly session = signal<CliSessionState | null>(null);
  protected readonly loggingIn = signal(false);

  protected readonly isLocalCli = computed(() => this.chosen().kind === 'localcli');

  /**
   * Un proveedor que vive aquí no manda nada a ninguna parte, y entonces la
   * pregunta de qué puede salir del equipo no tiene sentido.
   */
  /**
   * La clave viajaria en claro por la red.
   *
   * Se avisa y se deja seguir: en una red interna puede ser perfectamente
   * razonable, y quien lo sabe es quien la administra. Lo que no vale es
   * impedirlo, porque empuja a poner `https` sobre un puerto que no lo habla.
   */
  protected readonly unencrypted = computed(
    () =>
      this.baseUrl().toLowerCase().startsWith('http://') &&
      !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(this.baseUrl()),
  );

  protected readonly staysHere = computed(
    () => this.isLocalCli() || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(this.baseUrl()),
  );

  protected choose(option: ProviderOption): void {
    if (!option.available) {
      return;
    }

    this.chosen.set(option);
    this.probe.set(null);
    this.error.set('');

    // Los valores propuestos solo se ponen sobre un campo vacío: cambiar de
    // tarjeta no puede borrar la URL que alguien acaba de escribir.
    if (this.baseUrl().length === 0) {
      this.baseUrl.set(option.baseUrl);
    }

    if (this.model().length === 0) {
      this.model.set(option.model);
    }

    // El programa lo pone la tarjeta y no el usuario: de sus argumentos depende
    // que el asistente no pueda tocar el disco, y un campo donde escribirlo
    // seria un campo donde quitarlo.
    this.command.set(option.command ?? '');

    if (this.name().length === 0) {
      this.name.set(option.command ? option.name : '');
    }

    this.session.set(null);

    if (option.command) {
      void this.refreshSession(option.command);
    }
  }

  /**
   * Pregunta al programa si tiene sesion, y con quien.
   *
   * Es lo que evita el peor momento de esta pantalla: configurar el proveedor,
   * guardarlo, escribir una pregunta y descubrir entonces que faltaba iniciar
   * sesion.
   */
  private async refreshSession(command: string): Promise<void> {
    try {
      const state = await new Promise<CliSessionState>((resolve, reject) => {
        this._gateway.getCliSession(command).subscribe({ next: resolve, error: reject });
      });

      this.session.set(state);
    } catch {
      // No poder preguntarlo no impide configurar nada: la pantalla se queda
      // sin decir de la sesion, que es mejor que decir algo falso.
      this.session.set(null);
    }
  }

  /** Abre la consola donde el programa pide las credenciales. */
  protected async login(): Promise<void> {
    const command = this.chosen().command;

    if (!command) {
      return;
    }

    this.loggingIn.set(true);
    this.error.set('');

    try {
      const result = await new Promise<{ started: boolean; message?: string }>(
        (resolve, reject) => {
          this._gateway.startCliLogin(command).subscribe({ next: resolve, error: reject });
        },
      );

      if (!result.started) {
        this.error.set(result.message ?? 'No se pudo abrir el inicio de sesion.');
      }
    } catch (error) {
      this.error.set(describe(error));
    } finally {
      this.loggingIn.set(false);
    }
  }

  /** Vuelve a mirar la sesion, para cuando ya se ha iniciado en la consola. */
  protected async recheck(): Promise<void> {
    const command = this.chosen().command;

    if (command) {
      await this.refreshSession(command);
    }
  }

  protected edit(provider: AiProvider): void {
    this.editing.set(provider);
    this.chosen.set(
      OPTIONS.find((option) => option.kind === provider.kind && matches(option, provider)) ?? OPTIONS[0],
    );
    this.name.set(provider.name);
    this.baseUrl.set(provider.baseUrl);
    this.model.set(provider.model);
    this.command.set(provider.command);
    this.disclosure.set(provider.disclosure);

    // La clave guardada no se lee del almacén ni se enseña: `null` significa
    // «no la toques» al guardar.
    this.apiKey.set(null);
    this.probe.set(null);
    this.error.set('');
  }

  protected startNew(): void {
    this.editing.set(null);
    this.name.set('');
    this.baseUrl.set(this.chosen().baseUrl);
    this.model.set(this.chosen().model);
    this.command.set(this.chosen().command ?? '');
    this.disclosure.set('schema');
    this.apiKey.set(null);
    this.probe.set(null);
    this.error.set('');
  }

  /**
   * Pregunta al proveedor qué modelos tiene.
   *
   * Es lo que evita el fallo silencioso de esta pantalla: un modelo mal escrito
   * se guarda igual y solo falla en la primera pregunta, con un 404 que no dice
   * cuál era el bueno.
   */
  protected async loadModels(): Promise<void> {
    this.listing.set(true);
    this.error.set('');

    try {
      const answer = await new Promise<AiModelList>((resolve, reject) => {
        this._gateway.listAiModels(this.request()).subscribe({ next: resolve, error: reject });
      });

      this.models.set(answer.models);

      if (answer.models.length === 0) {
        // El motivo manda sobre el mensaje genérico: decir «no los enumera»
        // cuando lo que pasó fue que el certificado no valida esconde justo lo
        // que hay que arreglar.
        this.error.set(
          answer.detail ?? 'Ese proveedor no enumera sus modelos. Escribe el nombre a mano.',
        );
      } else if (this.model().length === 0) {
        this.model.set(answer.models[0]);
      }
    } catch (error) {
      this.error.set(describe(error));
    } finally {
      this.listing.set(false);
    }
  }

  protected async test(): Promise<void> {
    this.probing.set(true);
    this.probe.set(null);
    this.error.set('');

    try {
      const result = await new Promise<{ reachable: boolean; detail: string; elapsedMs: number }>(
        (resolve, reject) => {
          this._gateway.testAiProvider(this.request()).subscribe({ next: resolve, error: reject });
        },
      );

      this.probe.set({ ok: result.reachable, detail: result.detail, ms: result.elapsedMs });
    } catch (error) {
      this.probe.set({ ok: false, detail: describe(error), ms: 0 });
    } finally {
      this.probing.set(false);
    }
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set('');

    try {
      await this._store.save(this.request());
      this.closed.emit();
    } catch (error) {
      this.error.set(describe(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(provider: AiProvider): Promise<void> {
    await this._store.remove(provider.id);

    if (this.editing()?.id === provider.id) {
      this.startNew();
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  protected set(target: 'name' | 'baseUrl' | 'model' | 'command' | 'apiKey', event: Event): void {
    const value = (event.target as HTMLInputElement).value;

    ({
      name: this.name,
      baseUrl: this.baseUrl,
      model: this.model,
      command: this.command,
      apiKey: this.apiKey,
    })[target].set(value);
  }

  private request() {
    const editing = this.editing();

    return {
      id: editing?.id,
      name: this.name().trim(),
      kind: this.chosen().kind,
      baseUrl: this.baseUrl().trim(),
      model: this.model().trim(),
      command: this.command().trim(),
      disclosure: this.staysHere() ? ('schemaAndRows' as AiDisclosure) : this.disclosure(),
      // El primero que se configura es el que se usa: nadie configura uno para
      // luego tener que ir a marcarlo.
      isDefault: editing?.isDefault ?? this.providers().length === 0,
      ...(this.apiKey() === null ? {} : { apiKey: this.apiKey() ?? '' }),
    };
  }
}

/** Distingue el proveedor local del de fuera, que comparten mecanismo. */
function matches(option: ProviderOption, provider: AiProvider): boolean {
  if (provider.kind === 'localcli') {
    return option.command === provider.command;
  }

  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(provider.baseUrl);

  return option.id === 'local' ? local : !local;
}

/**
 * Convierte el fallo en algo que diga qué hacer.
 *
 * «No se pudo guardar» es lo que **no** hay que enseñar: pasó de verdad, y quien
 * lo vio no tenía forma de saber si había escrito mal la URL, si le faltaba la
 * clave o si la aplicación se había caído por detrás —que era el caso—. Cada
 * rama de aquí abajo existe porque distingue una de esas tres cosas.
 */
/** Las tres formas en que la API local dice por qué ha rechazado algo. */
interface ApiFailure {
  readonly message?: string;
  readonly detail?: string;
  readonly title?: string;
}

function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const response = error as { status: number; error?: unknown; message?: string };
    const body = response.error as ApiFailure | string | null | undefined;

    /*
     * El motivo viene en un campo distinto según quién rechace.
     *
     * Guardar lo devuelve en `message`; **probar lo devuelve en `detail`**, que
     * es lo que espera la pantalla del diálogo; y un rechazo del propio ASP.NET
     * —un cuerpo que no encaja— trae `title`. Mirar solo uno deja al usuario con
     * «La API respondió 400», que es exactamente el mensaje que no ayuda: pasó
     * de verdad al configurar el proveedor de una empresa.
     */
    const detail =
      typeof body === 'string' ? body : (body?.message ?? body?.detail ?? body?.title);

    if (detail) {
      return detail;
    }

    // Estado 0 es que la petición no llegó a salir. Casi siempre significa que
    // la API local no está: dice «se cayó», no «lo escribiste mal».
    if (response.status === 0) {
      return 'Druse no responde. ¿Sigue abierta la aplicación?';
    }

    if (response.status === 401) {
      return 'La sesión con la API local caducó. Vuelve a abrir Druse.';
    }

    return `La API respondió ${response.status}.`;
  }

  return error instanceof Error ? error.message : 'No se pudo guardar el proveedor.';
}
