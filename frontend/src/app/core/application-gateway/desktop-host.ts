import { Injectable, signal } from '@angular/core';

/** Cómo alcanzar la API local. */
export interface ApiConnection {
  /** Vacío en desarrollo: las rutas relativas las resuelve el proxy. */
  readonly baseUrl: string;
  readonly token: string | null;
}

export interface OpenedSqlDocument {
  readonly documentId: string;
  readonly fileName: string;
  readonly contents: string;
}

export interface SavedSqlDocument {
  readonly documentId: string;
  readonly fileName: string;
}

/** Forma en que Tauri expone sus comandos en la ventana. */
interface TauriBridge {
  core?: { invoke<T>(command: string, args?: unknown): Promise<T> };
  invoke?<T>(command: string, args?: unknown): Promise<T>;
}

declare global {
  interface Window {
    __TAURI__?: TauriBridge;
  }
}

/**
 * Detecta si la aplicación corre dentro del envoltorio de escritorio y, en ese
 * caso, obtiene de él el puerto y el token de la API.
 *
 * El navegador no puede leer archivos del disco, así que alguien con acceso al
 * sistema tiene que pasarle esos datos. En desarrollo lo hace el proxy del
 * servidor de Angular, que inyecta la cabecera y redirige `/api`; empaquetado,
 * lo hace Tauri. **El resto de la aplicación no distingue un caso del otro.**
 */
@Injectable({ providedIn: 'root' })
export class DesktopHost {
  private readonly _connection = signal<ApiConnection>({ baseUrl: '', token: null });

  /** Punto de conexión vigente. En desarrollo, rutas relativas y sin token. */
  readonly connection = this._connection.asReadonly();

  get isDesktop(): boolean {
    return typeof window !== 'undefined' && !!window.__TAURI__;
  }

  /**
   * Pide al envoltorio los datos de conexión.
   *
   * Si no estamos dentro de Tauri no hace nada: las rutas relativas siguen
   * funcionando a través del proxy.
   */
  async initialize(): Promise<void> {
    if (!this.isDesktop) {
      return;
    }

    try {
      const bridge = window.__TAURI__!;
      const invoke = bridge.core?.invoke ?? bridge.invoke;

      if (!invoke) {
        return;
      }

      const result = await invoke<{ base_url: string; token: string }>('api_connection');

      this._connection.set({ baseUrl: result.base_url, token: result.token });
    } catch {
      // Si el envoltorio no responde, se sigue con rutas relativas: fallará más
      // adelante con un error claro en lugar de impedir que la ventana abra.
    }
  }

  openSqlFile(): Promise<OpenedSqlDocument | null> {
    return this.invoke('open_sql_file');
  }

  saveSqlFile(documentId: string, contents: string): Promise<SavedSqlDocument> {
    return this.invoke('save_sql_file', { documentId, contents });
  }

  saveSqlFileAs(
    suggestedName: string,
    contents: string,
    documentId?: string,
  ): Promise<SavedSqlDocument | null> {
    return this.invoke('save_sql_file_as', { documentId, suggestedName, contents });
  }

  /**
   * Guarda un archivo exportado con el diálogo del sistema.
   *
   * Devuelve la ruta elegida, o `null` si el usuario cerró el diálogo. Los bytes
   * van como array de números porque es lo que entiende el puente: un `Blob` no
   * sobrevive a la serialización.
   *
   * @returns Ruta donde quedó el archivo, o `null` si se canceló.
   */
  saveExport(suggestedName: string, contents: Uint8Array): Promise<string | null> {
    return this.invoke('save_export', {
      suggestedName,
      contents: Array.from(contents),
    });
  }

  /**
   * Declara si hay trabajo sin confirmar que se perdería al cerrar.
   *
   * El aviso lo enseña el envoltorio y no la página: dentro del WebView,
   * `beforeunload` no es de fiar, porque quien cierra la ventana es el sistema.
   */
  setTransactionPending(pending: boolean): Promise<void> {
    return this.invoke('set_transaction_pending', { pending });
  }

  /**
   * Pide al envoltorio que ponga la ventana en el mismo tema que la interfaz.
   *
   * El marco y la barra de título los dibuja el sistema y no leen CSS, así que
   * son la única parte de la ventana que no cambia sola. En el navegador no hay
   * nada que pedir y la llamada se descarta sin ruido: no poder teñir un marco
   * que no existe no es un error del que haya que enterar a nadie.
   */
  async setWindowTheme(theme: string): Promise<void> {
    if (!this.isDesktop) {
      return;
    }

    try {
      await this.invoke('set_window_theme', { theme });
    } catch {
      // Una ventana con la cabecera del otro color es un defecto menor; no
      // justifica interrumpir un cambio de tema que ya se ha aplicado.
    }
  }

  /**
   * Abre el diálogo del sistema para elegir la imagen de fondo del editor.
   *
   * El envoltorio la copia a la carpeta de datos de la aplicación y la devuelve
   * ya leída. Se traen los bytes en lugar de una ruta porque la CSP solo admite
   * imágenes propias o `data:`: servirla desde el disco obligaría a abrir el
   * protocolo de recursos, que es relajar una protección real para ahorrarse una
   * lectura que ocurre una vez por arranque.
   */
  chooseEditorBackground(): Promise<{ name: string; source: string } | null> {
    return this.invoke('choose_editor_background');
  }

  /** La imagen de fondo guardada, o `null` si no hay ninguna. */
  readEditorBackground(): Promise<string | null> {
    return this.invoke('read_editor_background');
  }

  clearEditorBackground(): Promise<void> {
    return this.invoke('clear_editor_background');
  }

  private invoke<T>(command: string, args?: unknown): Promise<T> {
    const bridge = typeof window === 'undefined' ? undefined : window.__TAURI__;
    const invoke = bridge?.core?.invoke ?? bridge?.invoke;

    if (!invoke) {
      return Promise.reject(new Error('La función requiere el envoltorio de escritorio.'));
    }

    return invoke<T>(command, args);
  }
}
