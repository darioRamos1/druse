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
  readonly shareBusinessNotes?: boolean;
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
  /**
   * Qué salió mal con el almacén del sistema al guardar, si algo salió mal.
   *
   * El proveedor se guardó igual: va a la base local, que no depende del
   * llavero. Solo llega en la respuesta de guardar, nunca al listar.
   */
  readonly secretWarning?: string;
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
  readonly shareBusinessNotes?: boolean;
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
  readonly version?: string;
}

/**
 * Que paso al intentar abrir la consola del inicio de sesion.
 *
 * `manual` es la orden equivalente, con la variable de entorno dentro. Llega
 * siempre: abrir una ventana de consola es lo unico del asistente que depende
 * del escritorio que haya delante, y donde no se pueda —un Linux sin ninguno
 * instalado— ensenar que teclear deja el trabajo terminable.
 */
export interface CliLaunch {
  readonly started: boolean;
  readonly manual: string;
  readonly message?: string;
}

/** Resultado de probar un proveedor antes de guardarlo. */
export interface AiProbeResult {
  readonly reachable: boolean;
  readonly detail: string;
  readonly elapsedMs: number;
  readonly modelVerified?: boolean;
}

export type AiRole = 'user' | 'assistant' | 'system';

/** Identidad estable de la base; no contiene credenciales ni el identificador de sesión. */
export interface AiSource {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly database: string;
  readonly engine?: string;
  readonly serverVersion?: string;
  readonly schema?: string;
}

/** Categorías separadas para que el servidor aplique los permisos antes de componer. */
export interface AiContextSnapshot {
  readonly source: AiSource;
  readonly sql?: string;
  readonly schema?: string;
  readonly tables: readonly string[];
  readonly warnings?: readonly string[];
  readonly notes?: readonly AiBusinessNote[];
}

/** Un turno de la conversación. */
export interface AiMessage {
  readonly role: AiRole;
  readonly text: string;
  readonly context?: AiContextSnapshot;
}

/** Lo que se le pide al asistente en una vuelta. */
export interface AiChatRequest {
  readonly providerId: string;
  readonly model: string;
  readonly disclosure: AiDisclosure;
  readonly shareBusinessNotes?: boolean;
  readonly messages: readonly AiMessage[];
  /**
   * SQL y estructura elegidos para la pregunta actual, separados por categoría.
   *
   * Va aparte de los mensajes para que el backend pueda **negarse a enviarla**
   * cuando el proveedor no tiene permiso para verla: la decisión de qué sale de
   * este equipo no puede depender de que la pantalla se acuerde.
   */
  readonly context?: AiContextSnapshot;
  readonly previewHash?: string;
}

export interface AiChatLimits {
  readonly maxSqlBytes: number;
  readonly maxSchemaBytes: number;
  readonly maxNotesBytes: number;
  readonly maxContextBytes: number;
  readonly maxHistoryBytes: number;
  readonly maxInputBytes: number;
  readonly maxQuestionBytes: number;
  readonly maxHistoryTurns: number;
  readonly windowTokens: number;
  readonly questionReserveTokens: number;
  readonly responseReserveTokens: number;
  readonly capacityKnown: boolean;
}

export interface AiChatUsage {
  readonly sqlBytes: number;
  readonly schemaBytes: number;
  readonly notesBytes: number;
  readonly contextBytes: number;
  readonly historyBytes: number;
  readonly inputBytes: number;
  readonly questionBytes: number;
  readonly historyTurns: number;
  readonly estimatedTokens: number;
  readonly questionReserveTokens: number;
  readonly responseReserveTokens: number;
}

export interface AiChatPreview {
  readonly hash: string;
  readonly context: string;
  readonly messages: readonly AiMessage[];
  readonly limits: AiChatLimits;
  readonly usage: AiChatUsage;
  readonly issues: readonly {
    readonly code: string;
    readonly used: number;
    readonly max: number;
  }[];
  readonly valid: boolean;
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
  | {
      readonly kind: 'context';
      readonly text: string;
      readonly providerId: string;
      readonly model: string;
      readonly disclosure: AiDisclosure;
      readonly hash?: string;
      readonly usage?: AiChatUsage;
    }
  | { readonly kind: 'done' }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly code?: string;
      readonly detail?: string;
    };

export interface AiNoteReference {
  readonly objectId: string;
  readonly schema: string;
  readonly table: string;
  readonly kind: 'table' | 'view';
  readonly column?: string | null;
}

export interface AiBusinessNote {
  readonly id: string;
  readonly connectionId: string;
  readonly database: string;
  readonly text: string;
  readonly enabled: boolean;
  readonly reference: AiNoteReference | null;
  readonly updatedAtUtc: string;
  readonly formatVersion: number;
}
