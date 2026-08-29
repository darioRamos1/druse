/**
 * El asistente: quién responde y qué se le manda.
 *
 * Los nombres coinciden con los del backend a propósito —`openaicompatible`,
 * `schema`— para que un dato no cambie de nombre al cruzar la red y haya que
 * traducirlo dos veces.
 */

/**
 * Por dónde se llega al modelo.
 *
 * `openaicompatible` no es una marca sino una forma de hablar: bajo ella caben
 * el MaaS de una empresa, Ollama en el propio equipo, Azure, OpenRouter y la
 * propia OpenAI, porque todos atienden el mismo formato.
 */
export type AiProviderKind = 'openaicompatible' | 'anthropic' | 'gemini' | 'localcli';

/**
 * Cuánto del trabajo puede acompañar a la pregunta.
 *
 * No es comodidad: decide qué sale de este equipo. `schema` manda nombres de
 * tablas, columnas y tipos, y **ninguna fila**; es lo que hace útil al asistente
 * sin mandar fuera datos de nadie, y por eso es lo que se propone.
 */
export type AiDisclosure = 'nothing' | 'schema' | 'schemaAndRows';

/** Un proveedor configurado. **Nunca lleva la clave.** */
export interface AiProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: AiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  /** Programa que atiende a un proveedor `localcli`. Vacío en los demás. */
  readonly command: string;
  readonly disclosure: AiDisclosure;
  /**
   * Este perfil inicia sesion por su cuenta, aparte de la del equipo.
   *
   * Es lo que permite tener dos cuentas —la personal y la del trabajo— sin
   * que una cierre la sesion de la otra, y sin tocar la que usa quien
   * programa con esa misma herramienta.
   */
  readonly ownSession: boolean;
  readonly isDefault: boolean;
  /** Hay una clave suya en el almacén del sistema. */
  readonly hasStoredKey: boolean;
}

/** Lo que sabe la aplicación sobre los proveedores y sobre dónde guardar sus claves. */
export interface AiProviderList {
  readonly providers: readonly AiProvider[];
  readonly canStoreKeys: boolean;
  readonly storeDescription: string;
}

/**
 * Lo que manda el diálogo al guardar o al probar.
 *
 * `apiKey` ausente significa «no la toques» y cadena vacía «retírala»: el
 * formulario no puede mostrar la clave guardada, así que llega vacío aunque
 * exista una.
 */
export interface SaveAiProviderRequest {
  readonly id?: string;
  readonly name: string;
  readonly kind: AiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly command: string;
  readonly disclosure: AiDisclosure;
  readonly ownSession: boolean;
  readonly isDefault: boolean;
  readonly apiKey?: string;
}

/**
 * Los modelos que un proveedor dice tener, o por qué no se pudieron pedir.
 *
 * No poder enumerarlos **no impide configurarlo**: el campo admite texto escrito
 * a mano. Por eso el motivo viaja como dato y no como error, pero viaja: sin él,
 * la pantalla solo puede decir «no enumera sus modelos», que esconde justo lo
 * que hay que arreglar —una clave mal pegada, un certificado, un proxy—.
 */
export interface AiModelList {
  readonly models: readonly string[];
  readonly detail?: string;
}

/**
 * Lo que se sabe de la sesion de un programa de consola.
 *
 * `loggedIn` en `null` significa **no se pudo averiguar**, que no es lo mismo
 * que «no»: decirle «sin sesion» a quien la tiene lo manda a repetir un inicio
 * de sesion que sobra.
 */
export interface CliSessionState {
  readonly installed: boolean;
  readonly loggedIn: boolean | null;
  readonly account?: string;
  readonly plan?: string;
  readonly detail: string;
}

/** Resultado de probar un proveedor antes de guardarlo. */
export interface AiProbeResult {
  readonly reachable: boolean;
  readonly detail: string;
  readonly elapsedMs: number;
}

export type AiRole = 'user' | 'assistant' | 'system';

/** Un turno de la conversación. */
export interface AiMessage {
  readonly role: AiRole;
  readonly text: string;
}

/** Lo que se le pide al asistente en una vuelta. */
export interface AiChatRequest {
  readonly providerId: string;
  readonly messages: readonly AiMessage[];
  /**
   * Estructura de las tablas en juego, ya compuesta.
   *
   * Va aparte de los mensajes para que el backend pueda **negarse a enviarla**
   * cuando el proveedor no tiene permiso para verla: la decisión de qué sale de
   * este equipo no puede depender de que la pantalla se acuerde.
   */
  readonly context?: string;
}

/**
 * Un trozo de respuesta según llega, o el final, o el fallo.
 *
 * El fallo viaja como un suceso más y no como error de transporte porque para
 * cuando ocurre ya empezó a llegar la respuesta: lo que hay que hacer es
 * enseñarlo debajo de lo escrito, no perderlo todo.
 */
export type AiStreamEvent =
  | { readonly kind: 'chunk'; readonly text: string }
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly message: string };
