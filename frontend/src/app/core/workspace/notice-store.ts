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

  /** Lo que hay que decirle al usuario ahora mismo, o `null` si nada. */
  readonly notice = this._notice.asReadonly();

  /** Dice algo al usuario, reemplazando lo anterior. */
  set(message: string): void {
    this._notice.set(message);
  }

  /** Retira el aviso, porque el usuario lo cerró o dejó de valer. */
  clear(): void {
    this._notice.set(null);
  }
}
