import { Injectable, signal } from '@angular/core';

/**
 * El aviso que se le está diciendo al usuario, si hay alguno.
 *
 * Es una pieza de una sola frase, y aun así tiene su propio servicio: al partir
 * `WorkspaceStore` en varias piezas, **todas necesitan avisar** —la transacción
 * que se deshizo sola, la conexión que se cayó, el archivo que no se pudo
 * escribir— y el aviso tiene que salir por el mismo sitio. Si cada pieza
 * guardara el suyo, dos avisos simultáneos se pisarían sin que nadie decidiera
 * cuál gana.
 *
 * Se muestra uno cada vez, el último: son mensajes de lo que acaba de pasar, y
 * una cola de avisos viejos molesta más de lo que informa.
 */
@Injectable({ providedIn: 'root' })
export class NoticeStore {
  private readonly _notice = signal<string | null>(null);
  private readonly _query = signal<string | null>(null);

  /** Lo que hay que decirle al usuario ahora mismo, o `null` si nada. */
  readonly notice = this._notice.asReadonly();

  /**
   * La consulta que enseña lo que el aviso cuenta, cuando el motor la trajo.
   *
   * Hay avisos que no se pueden arreglar leyéndolos: «hay filas que no cumplen
   * la condición» es cierto y no dice cuáles. El proceso local, que es quien
   * miró, sabe escribir la consulta que las encuentra y la manda con el rechazo.
   *
   * Viaja pegada al aviso y no aparte a propósito: solo hay un aviso a la vez, y
   * guardarla en otro sitio sería la forma de acabar ofreciendo la consulta de un
   * rechazo anterior debajo de un mensaje nuevo.
   */
  readonly query = this._query.asReadonly();

  /** Dice algo al usuario, reemplazando lo anterior. */
  set(message: string, query: string | null = null): void {
    this._notice.set(message);
    this._query.set(query);
  }

  /** Retira el aviso, porque el usuario lo cerró o dejó de valer. */
  clear(): void {
    this._notice.set(null);
    this._query.set(null);
  }
}
