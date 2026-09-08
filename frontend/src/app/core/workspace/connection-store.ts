import { Injectable, computed, signal } from '@angular/core';

import { ConnectionSummary, SessionStatus } from '../../shared/models/workspace';

/**
 * Las conexiones que el usuario tiene delante y la sesión viva de cada una.
 *
 * Salió de `WorkspaceStore` con el plan de mejoras (FE-001/FE-002). Son tres
 * datos que siempre se mueven juntos —la lista de conexiones, lo que la API dice
 * de cada sesión, y sobre cuál se está trabajando— y que casi todo lo demás del
 * área de trabajo consulta pero nadie más debería poder cambiar a su manera.
 *
 * Aquí no se abre ni se cierra nada: **abrir una sesión tiene consecuencias**
 * —el árbol, el catálogo, las pestañas— y esas las coordina el área de trabajo.
 * Esta pieza guarda lo que se sabe y responde preguntas sobre ello.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionStore {
  private readonly _connections = signal<readonly ConnectionSummary[]>([]);

  readonly connections = this._connections.asReadonly();

  private readonly _sessions = signal<ReadonlyMap<string, SessionStatus>>(new Map());

  /**
   * Sobre qué conexión se trabaja cuando la pestaña no dice otra cosa.
   *
   * Es una preferencia, no una verdad: la conexión de la pestaña manda sobre
   * esta, y {@link resolve} es donde se decide entre las dos.
   */
  private readonly _activeId = signal<string | null>(null);

  readonly activeId = this._activeId.asReadonly();

  /**
   * La conexión que perdió su sesión, si hay alguna.
   *
   * Sirve para poner «Reconectar» en el aviso: quien acaba de leer que se cayó
   * la conexión no debería tener que buscar dónde se arregla.
   */
  readonly lost = computed(() => this._connections().find((connection) => connection.lost) ?? null);

  find(id: string): ConnectionSummary | undefined {
    return this._connections().find((connection) => connection.id === id);
  }

  /**
   * Cambia la lista entera.
   *
   * Lo usan los dos caminos que no son un cambio puntual: releer los perfiles
   * guardados y anotar una conexión recién abierta, que además de añadir tienen
   * que decidir qué pasa con lo que ya había.
   */
  update(
    change: (connections: readonly ConnectionSummary[]) => readonly ConnectionSummary[],
  ): void {
    this._connections.update(change);
  }

  /** Cambia solo lo indicado de una conexión, dejando el resto como estaba. */
  patch(id: string, patch: Partial<ConnectionSummary>): void {
    this._connections.update((connections) =>
      connections.map((connection) =>
        connection.id === id ? { ...connection, ...patch } : connection,
      ),
    );
  }

  /** Quita una conexión de la lista. */
  remove(id: string): void {
    this._connections.update((connections) =>
      connections.filter((connection) => connection.id !== id),
    );
  }

  /** Lo que la API dijo de la sesión de una conexión, si está abierta. */
  sessionFor(connectionId: string): SessionStatus | undefined {
    return this._sessions().get(connectionId);
  }

  setSession(connectionId: string, session: SessionStatus): void {
    this._sessions.update((sessions) => new Map(sessions).set(connectionId, session));
  }

  /** Cambia solo lo indicado de una sesión abierta; si no hay ninguna, no hace nada. */
  patchSession(connectionId: string, patch: Partial<SessionStatus>): void {
    this._sessions.update((sessions) => {
      const current = sessions.get(connectionId);

      if (!current) {
        return sessions;
      }

      return new Map(sessions).set(connectionId, { ...current, ...patch });
    });
  }

  forgetSession(connectionId: string): void {
    this._sessions.update((sessions) => {
      const next = new Map(sessions);
      next.delete(connectionId);

      return next;
    });
  }

  /** Deja esta conexión como la preferida mientras la pestaña no diga otra. */
  activate(connectionId: string | null): void {
    this._activeId.set(connectionId);
  }

  /**
   * Sobre qué conexión se ejecuta, dado lo que pida quien pregunta.
   *
   * Con conexión pedida —la de la pestaña— se exige además que tenga sesión: una
   * pestaña puede recordar una conexión que ya se cerró, y ejecutar «en la
   * anterior» sería exactamente lo que no se quiere. Sin ella se coge cualquiera
   * abierta, que es lo que hace útil el arranque con una sola conexión.
   */
  resolve(preferredId: string | null | undefined): ConnectionSummary | null {
    const connectionId = preferredId ?? this._activeId();

    return connectionId
      ? (this._connections().find(
          (connection) => connection.id === connectionId && connection.sessionId,
        ) ?? null)
      : (this._connections().find((connection) => connection.sessionId) ?? null);
  }
}
