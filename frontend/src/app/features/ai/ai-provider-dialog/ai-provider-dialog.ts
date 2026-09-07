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
  CliLaunch,
  CliSessionState,
} from '../../../shared/models/ai';
import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { Icon } from '../../../shared/ui/icon/icon';
import { IconName } from '../../../shared/ui/icon/icon';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';

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
  /**
   * Modelos que se sabe que acepta, cuando el programa no los enumera.
   *
   * Los de linea de ordenes no tienen forma de listarlos, y dejar un campo de
   * texto vacio obliga a saberselos de memoria.
   */
  readonly known?: readonly string[];
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
    id: 'openai',
    kind: 'openaicompatible',
    name: 'OpenAI API',
    detail: 'GPT · con clave de plataforma',
    icon: 'sparkles',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    available: true,
  },
  {
    id: 'anthropic',
    kind: 'anthropic',
    name: 'Anthropic API',
    detail: 'Claude · con clave de consola',
    icon: 'sparkles',
    baseUrl: 'https://api.anthropic.com/v1',
    model: '',
    available: true,
  },
  {
    id: 'gemini',
    kind: 'gemini',
    name: 'Google Gemini',
    detail: 'Gemini · con clave de Google AI',
    icon: 'sparkles',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: '',
    available: true,
  },
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
    // Los que declara su propia ayuda: alias del ultimo de cada familia. El
    // campo sigue admitiendo el nombre completo, como `claude-fable-5`.
    known: ['opus', 'sonnet', 'fable'],
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
  { value: 'schema', label: 'SQL y estructura' },
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
  imports: [DialogFocus, Icon],
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
  private readonly _models = signal<readonly string[]>([]);

  /**
   * Los que se pueden elegir: lo que diga el proveedor, o lo que sepa la tarjeta.
   *
   * Un programa de línea de órdenes no enumera nada, así que sin esta segunda
   * fuente el campo se quedaba con un solo nombre escrito a fuego y no había
   * forma de saber que había otros.
   */
  protected readonly models = computed<readonly string[]>(() => {
    const fromServer = this._models();

    return fromServer.length > 0 ? fromServer : (this.chosen().known ?? []);
  });
  protected readonly listing = signal(false);

  /** Lo que se sabe de la sesion del programa elegido, cuando es uno. */
  protected readonly session = signal<CliSessionState | null>(null);
  protected readonly sessionLoading = signal(false);
  protected readonly sessionError = signal('');
  protected readonly loggingIn = signal(false);

  /**
   * La orden del inicio de sesion, para teclearla donde no se abra la ventana.
   *
   * Vacia mientras no haga falta. Se pone solo cuando el intento falla, porque
   * ensenarla siempre convertiria el camino normal —pulsar un boton— en una
   * pantalla llena de instrucciones que nadie necesita leer.
   */
  protected readonly manual = signal('');

  /**
   * Este perfil usa su propia cuenta, no la del equipo.
   *
   * Apagado por omision porque quien ya tiene sesion iniciada no deberia
   * volver a entrar. Se enciende justo para lo contrario: cuando se quiere
   * **otra** cuenta sin cerrar la que ya hay.
   */
  protected readonly ownSession = signal(false);

  protected readonly isLocalCli = computed(() => this.chosen().kind === 'localcli');
  protected readonly canListModels = computed(
    () => !this.isLocalCli() || this.command() === 'codex',
  );
  protected readonly accountProvider = computed(() =>
    this.command() === 'codex' ? 'ChatGPT' : 'Claude',
  );

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

  protected readonly staysHere = computed(() =>
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(this.baseUrl()),
  );

  protected choose(option: ProviderOption): void {
    if (!option.available) {
      return;
    }

    const changed = this.chosen().id !== option.id;

    this.chosen.set(option);
    this.probe.set(null);
    this.error.set('');

    // Los que trajo el proveedor anterior no valen para este: dejarlos a la
    // vista ofreceria elegir un modelo que aqui no existe.
    this._models.set([]);

    // Cada protocolo tiene una raíz distinta. Al cambiar de tarjeta se propone
    // la suya; después el campo sigue siendo editable para proxies empresariales.
    if (changed || this.baseUrl().length === 0) {
      this.baseUrl.set(option.baseUrl);
    }

    // Un modelo de otro protocolo casi nunca es válido aquí. Solo se conserva
    // cuando se vuelve a pulsar la misma tarjeta, para no borrar texto propio.
    if (changed || this.model().length === 0) {
      this.model.set(option.model);
    }

    // El programa lo pone la tarjeta y no el usuario: de sus argumentos depende
    // que el asistente no pueda tocar el disco, y un campo donde escribirlo
    // seria un campo donde quitarlo.
    this.command.set(option.command ?? '');

    if (this.name().length === 0 || OPTIONS.some((candidate) => candidate.name === this.name())) {
      this.name.set(option.id === 'compatible' ? '' : option.name);
    }

    this.session.set(null);

    if (option.command) {
      void this.refreshSession(option.command);
    }
  }

  /**
   * Cambiar entre la cuenta del equipo y una propia son dos sesiones distintas.
   *
   * Al cambiar hay que volver a preguntar: la misma maquina puede tener sesion
   * en una y no en la otra, y dejar el estado anterior en pantalla diria que
   * hay cuenta donde no la hay.
   */
  protected toggleOwnSession(): void {
    this.ownSession.set(!this.ownSession());
    this.session.set(null);

    const command = this.chosen().command;

    if (command) {
      void this.refreshSession(command);
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
    this.sessionLoading.set(true);
    this.sessionError.set('');

    try {
      const state = await new Promise<CliSessionState>((resolve, reject) => {
        this._gateway
          .getCliSession(command, this.sessionOwner())
          .subscribe({ next: resolve, error: reject });
      });

      this.session.set(state);

      if (command === 'codex' && state.loggedIn === true && this._models().length === 0) {
        await this.loadModels();
      }
    } catch (error) {
      this.session.set(null);
      this.sessionError.set(describe(error));
    } finally {
      this.sessionLoading.set(false);
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
    this.manual.set('');

    try {
      // Una sesión separada necesita un identificador para tener su propia
      // carpeta de credenciales. Se crea aquí, en la misma acción de conectar,
      // para no obligar a guardar, cerrar y volver a abrir el proveedor.
      if (this.ownSession() && !this.editing()) {
        const saved = await this._store.save(this.request());
        this.editing.set(saved);
      }

      const result = await new Promise<CliLaunch>((resolve, reject) => {
        this._gateway
          .startCliLogin(command, this.sessionOwner())
          .subscribe({ next: resolve, error: reject });
      });

      if (!result.started) {
        // Sin ventana que abrir, lo unico util que queda es la orden: se
        // ensena entera, con su variable, para poder pegarla en una consola.
        this.error.set(result.message ?? 'No se pudo abrir el inicio de sesion.');
        this.manual.set(result.manual);
      } else {
        this.session.set(null);
        this.sessionError.set(
          `Completa el inicio de sesión con ${this.accountProvider()} en la ventana que se abrió.`,
        );
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
      OPTIONS.find((option) => option.kind === provider.kind && matches(option, provider)) ??
        OPTIONS[0],
    );
    this.name.set(provider.name);
    this.baseUrl.set(provider.baseUrl);
    this.model.set(provider.model);
    this.command.set(provider.command);
    this.ownSession.set(provider.ownSession);
    this.disclosure.set(provider.disclosure === 'schemaAndRows' ? 'schema' : provider.disclosure);

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
    this.ownSession.set(false);
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

      this._models.set(answer.models);

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

  /**
   * De quien es la sesion que se mira o se inicia.
   *
   * El identificador del perfil cuando tiene cuenta propia —cada uno guarda sus
   * credenciales aparte— y nada cuando comparte la del equipo. Un perfil que
   * todavia no se ha guardado no tiene identificador, asi que hasta entonces se
   * mira la del equipo: es lo unico que se puede saber de el.
   */
  private sessionOwner(): string | undefined {
    return this.ownSession() ? this.editing()?.id : undefined;
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
      disclosure: this.staysHere() ? ('schema' as AiDisclosure) : this.disclosure(),
      ownSession: this.ownSession(),
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

  if (provider.kind !== option.kind) {
    return false;
  }

  if (provider.kind !== 'openaicompatible') {
    return true;
  }

  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(provider.baseUrl);

  if (option.id === 'openai') {
    return /^https:\/\/api\.openai\.com\//i.test(provider.baseUrl);
  }

  return option.id === 'local'
    ? local
    : option.id === 'compatible' &&
        !local &&
        !/^https:\/\/api\.openai\.com\//i.test(provider.baseUrl);
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
    const detail = typeof body === 'string' ? body : (body?.message ?? body?.detail ?? body?.title);

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
