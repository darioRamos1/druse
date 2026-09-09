import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import { DatabaseObject, QueryTab } from '../../shared/models/workspace';

/**
 * Espera antes de guardar el trabajo sin ejecutar, en milisegundos.
 *
 * Corto porque lo que protege es un cierre inesperado, y largo porque escribir
 * cambia el estado en cada tecla: sin esta pausa habría una escritura en disco
 * por pulsación.
 */
const TABS_SAVE_DELAY_MS = 1000;

/**
 * De dónde sale el número de la próxima pestaña.
 *
 * Vive en el módulo y no en la clase, como vivía en `WorkspaceStore`: así dos
 * instancias del almacén —que en la aplicación no las hay, pero en las pruebas
 * sí— no reparten el mismo identificador dos veces.
 */
let tabCounter = 1;

/** Lo que hace falta saber para abrir una pestaña. */
export interface NewTab {
  readonly sql?: string;
  readonly sourceTable?: DatabaseObject;
  readonly connectionId?: string;
  readonly title?: string;
  readonly database?: string;
}

/**
 * Las pestañas del editor y el trabajo sin ejecutar que llevan dentro.
 *
 * Salió de `WorkspaceStore` con el plan de mejoras (FE-001/FE-002). Es la pieza
 * con la regla más fácil de romper de todo el almacén: **lo que se escribe se
 * guarda solo**, y basta con que un camino cambie las pestañas sin pasar por
 * {@link update} para que ese camino pierda lo escrito. Teniéndolas aquí, esa
 * regla se cumple en un archivo de doscientas líneas en vez de en tres mil.
 *
 * Lo que este servicio **no** hace es decidir qué pasa alrededor: cambiar de
 * pestaña también retira el resultado en pantalla y los cambios pendientes de la
 * cuadrícula, y eso es cosa del área de trabajo, que es quien los conoce.
 */
@Injectable({ providedIn: 'root' })
export class TabStore {
  private readonly _gateway = inject(ApplicationGateway);

  private readonly _tabs = signal<readonly QueryTab[]>([
    { id: 'q1', title: 'Consulta 1', active: true, dirty: false, sql: '' },
  ]);

  readonly tabs = this._tabs.asReadonly();

  /** La pestaña en la que se está trabajando. */
  readonly active = computed(() => this._tabs().find((tab) => tab.active) ?? null);

  /** Guardado pendiente del trabajo sin ejecutar, o `null` si no hay ninguno. */
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Hasta que no se ha leído lo guardado, no se guarda nada encima. */
  private _restored = false;

  /**
   * Cambia las pestañas y programa su guardado.
   *
   * Todo lo que las toca pasa por aquí para que recuperar el trabajo no dependa
   * de acordarse de guardar en cada sitio: son ocho, y el que se olvide sería
   * justo el que pierda lo escrito.
   */
  update(change: (tabs: readonly QueryTab[]) => readonly QueryTab[]): void {
    this._tabs.update(change);
    this.scheduleSave();
  }

  /**
   * Guarda el trabajo sin ejecutar, poco después de dejar de escribir.
   *
   * El retardo existe porque escribir cambia el estado en cada tecla y guardar
   * en cada una sería una escritura por pulsación. Un segundo es corto para lo
   * que se protege —un cierre inesperado— y suficiente para no castigar el
   * teclado.
   */
  private scheduleSave(): void {
    if (!this._restored) {
      // Antes de restaurar no se guarda nada: la pestaña vacía del arranque
      // pisaría lo que se dejó escrito en la sesión anterior.
      return;
    }

    if (this._saveTimer !== null) {
      clearTimeout(this._saveTimer);
    }

    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      void this.saveNow();
    }, TABS_SAVE_DELAY_MS);
  }

  /**
   * Guarda ya lo que estuviera esperando.
   *
   * El retardo deja una rendija: cerrar justo después de escribir se llevaría lo
   * último. Se llama al perder el foco y al cerrar, que es cuando esa rendija
   * importa.
   */
  flush(): void {
    if (this._saveTimer === null) {
      return;
    }

    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    void this.saveNow();
  }

  private async saveNow(): Promise<void> {
    const tabs = this._tabs().map((tab) => ({
      id: tab.id,
      title: tab.title,
      sql: tab.sql,
      isActive: tab.active,
      isDirty: tab.dirty,
      connectionId: tab.connectionId,
      database: tab.database,
      fileName: tab.fileName,
      documentId: tab.documentId,
    }));

    try {
      await firstValueFrom(this._gateway.saveEditorTabs(tabs));
    } catch {
      // Guardar el borrador es una red de seguridad: si falla, el usuario sigue
      // teniendo su trabajo delante y avisarle no le sirve de nada.
    }
  }

  /**
   * Devuelve las pestañas de la última sesión, con lo que no se llegó a ejecutar.
   *
   * Se llama una vez al arrancar. Si no hay nada guardado se deja la pestaña
   * vacía de siempre, que es lo que ve quien abre Druse por primera vez.
   */
  async restore(): Promise<void> {
    try {
      const stored = await firstValueFrom(this._gateway.getEditorTabs());

      if (stored.length > 0) {
        this._tabs.set(
          stored.map((tab, index) => ({
            id: tab.id,
            title: tab.title,
            active: tab.isActive || (index === 0 && !stored.some((other) => other.isActive)),
            dirty: tab.isDirty,
            sql: tab.sql,
            connectionId: tab.connectionId,
            database: tab.database,
            fileName: tab.fileName,
            documentId: tab.documentId,
          })),
        );

        // El contador se adelanta a lo restaurado: si volviera a empezar, la
        // siguiente pestaña nueva se llamaría igual que una recuperada y las dos
        // se pisarían.
        tabCounter = Math.max(
          tabCounter,
          ...stored.map((tab) => Number.parseInt(tab.id.replace(/^q/, ''), 10) || 0),
        );
      }
    } catch {
      // Sin lo guardado se arranca como siempre.
    } finally {
      this._restored = true;
    }
  }

  /** Aplica el resultado de guardar únicamente si el contenido no cambió mientras se escribía. */
  markSaved(id: string, sql: string, fileName: string, documentId?: string): void {
    this.update((tabs) =>
      tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              title: fileName,
              fileName,
              documentId: documentId || tab.documentId,
              dirty: tab.sql === sql ? false : tab.dirty,
            }
          : tab,
      ),
    );
  }

  select(id: string): void {
    this.update((tabs) => tabs.map((tab) => ({ ...tab, active: tab.id === id })));
  }

  close(id: string): void {
    this.update((tabs) => {
      const remaining = tabs.filter((tab) => tab.id !== id);

      if (remaining.length > 0 && !remaining.some((tab) => tab.active)) {
        return remaining.map((tab, index) => ({ ...tab, active: index === 0 }));
      }

      return remaining;
    });
  }

  /** Abre una pestaña nueva y la deja activa. */
  create({ sql = '', sourceTable, connectionId, title, database }: NewTab = {}): void {
    tabCounter++;

    this.update((tabs) => [
      ...tabs.map((tab) => ({ ...tab, active: false })),
      {
        id: `q${tabCounter}`,
        title: title ?? `Consulta ${tabCounter}`,
        active: true,
        dirty: false,
        sql,
        connectionId,
        database,
        sourceTable,
      },
    ]);
  }

  /**
   * Abre un archivo `.sql` en una pestaña que recuerda de dónde vino.
   *
   * `from` es lo que la pestaña hereda de donde se estaba trabajando —conexión y
   * base—: un archivo abierto sin conexión no se puede ejecutar, y tener que
   * elegirla otra vez sorprende a quien acaba de abrirlo desde una sesión viva.
   */
  openFile(fileName: string, sql: string, documentId?: string, from: NewTab = {}): void {
    this.create({ ...from, sql, title: fileName });
    this.update((tabs) =>
      tabs.map((tab) =>
        tab.active ? { ...tab, fileName, documentId: documentId || undefined } : tab,
      ),
    );
  }

  /**
   * Cambia el SQL de la pestaña activa.
   *
   * La procedencia se pierde a propósito: en cuanto se toca el texto, lo que hay
   * ya no es el `SELECT` que abrió el explorador, y seguir creyendo que sí es lo
   * que llevaría a editar filas de otra tabla.
   */
  updateSql(sql: string): void {
    this.update((tabs) =>
      tabs.map((tab) => (tab.active ? { ...tab, sql, dirty: true, sourceTable: undefined } : tab)),
    );
  }
}
