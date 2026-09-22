import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway, SavedSnippet } from '../application-gateway/application-gateway';
import { I18nService } from '../i18n/i18n.service';

/**
 * Los fragmentos de SQL guardados.
 *
 * Vive en `core` porque los usan dos sitios que no se conocen entre sí: la
 * paleta, para insertar uno sin soltar el teclado, y el editor, que los ofrece
 * al escribir. Tenerlos en un solo lugar evita que uno guarde y el otro siga
 * enseñando la lista de antes.
 *
 * Se leen una vez al arrancar y se mantienen en memoria: son pocos, caben de
 * sobra y una consulta al proceso local por cada pulsación del autocompletado
 * sería pagar un viaje por letra.
 */
@Injectable({ providedIn: 'root' })
export class SnippetStore {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _i18n = inject(I18nService);

  private readonly _snippets = signal<readonly SavedSnippet[]>([]);
  private readonly _error = signal<string | null>(null);

  /** Del último tocado al más antiguo, que es como los devuelve el proceso local. */
  readonly snippets = this._snippets.asReadonly();

  /** Lo último que falló al guardar o borrar. Se limpia al volver a intentarlo. */
  readonly error = this._error.asReadonly();

  readonly count = computed(() => this._snippets().length);

  async load(): Promise<void> {
    try {
      this._snippets.set(await firstValueFrom(this._gateway.getSnippets()));
      this._error.set(null);
    } catch {
      // No poder leerlos no puede impedir escribir SQL: la lista se queda vacía
      // y el editor sigue funcionando sin ellos.
      this._error.set(this._i18n.t('snippets.readFailed'));
    }
  }

  /**
   * Guarda uno nuevo, o corrige el que ya tenga ese identificador.
   *
   * Devuelve el fragmento tal como quedó, para que quien lo guarde pueda
   * nombrarlo en el aviso sin volver a leer la lista.
   */
  async save(name: string, sql: string, id?: string): Promise<SavedSnippet | null> {
    const snippet: SavedSnippet = {
      id: id ?? crypto.randomUUID(),
      name: name.trim(),
      sql,
    };

    try {
      await firstValueFrom(this._gateway.saveSnippet(snippet));
      this._error.set(null);
    } catch {
      this._error.set(this._i18n.t('snippets.saveFailed', { name: snippet.name }));

      return null;
    }

    // Al frente: acaba de tocarse, y es el orden en que los devuelve el proceso
    // local la próxima vez que se lean.
    this._snippets.update((current) => [
      snippet,
      ...current.filter((existing) => existing.id !== snippet.id),
    ]);

    return snippet;
  }

  async remove(id: string): Promise<boolean> {
    try {
      await firstValueFrom(this._gateway.deleteSnippet(id));
      this._error.set(null);
    } catch {
      this._error.set(this._i18n.t('snippets.deleteFailed'));

      return false;
    }

    this._snippets.update((current) => current.filter((snippet) => snippet.id !== id));

    return true;
  }

  /**
   * Nombre a partir del SQL, para proponer algo cuando el usuario no escribe uno.
   *
   * Se queda con la primera línea con contenido y la recorta: es lo que
   * distingue un fragmento de otro en una lista, y casi siempre empieza por el
   * verbo y la tabla.
   */
  static suggestName(sql: string): string {
    const line = sql
      .split('\n')
      .map((text) => text.trim())
      .find((text) => text.length > 0 && !text.startsWith('--'));

    if (!line) {
      return 'Fragmento';
    }

    return line.length > 48 ? `${line.slice(0, 48).trimEnd()}…` : line;
  }
}
