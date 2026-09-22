import { Injectable } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';

/** Ruta donde `angular.json` copia el paquete de Monaco. */
const MONACO_BASE = 'assets/monaco';

/** Tope de espera. Pasado esto se da por fallido y se puede reintentar. */
const LOAD_TIMEOUT_MS = 20000;

/** Lo que se pueda decir de un error del cargador AMD, que no siempre es `Error`. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  const detail = error as { errorCode?: string; moduleId?: string } | null;

  return detail?.moduleId
    ? `no se encontró ${detail.moduleId}`
    : (detail?.errorCode ?? 'motivo desconocido');
}

declare global {
  interface Window {
    /** Cargador AMD que expone `loader.js` de Monaco. */
    require?: {
      (modules: string[], onLoad: () => void, onError?: (error: unknown) => void): void;
      config?: (options: { paths: Record<string, string> }) => void;
    };
    monaco?: typeof MonacoApi;
  }
}

/**
 * Carga Monaco una sola vez y bajo demanda.
 *
 * Se usa el cargador AMD que Monaco distribuye en lugar de importarlo como ESM:
 * el paquete trae sus propios *web workers* y resolverlos a través del bundler
 * obliga a configuración frágil que se rompe en cada versión. Copiando `min/vs`
 * como recurso estático, Monaco resuelve sus workers él solo.
 *
 * Como contrapartida, Monaco queda fuera del bundle principal y no infla la
 * carga inicial de la aplicación.
 */
@Injectable({ providedIn: 'root' })
export class MonacoLoader {
  private _loading: Promise<typeof MonacoApi> | null = null;

  load(): Promise<typeof MonacoApi> {
    if (window.monaco) {
      return Promise.resolve(window.monaco);
    }

    // Un intento fallido no se guarda: si se cachea la promesa rechazada, el
    // editor no vuelve a cargar en toda la sesión aunque el problema haya sido
    // pasajero —un recurso que todavía no estaba servido, la red un instante—.
    this._loading ??= this.injectLoader().catch((error: unknown) => {
      this._loading = null;
      throw error;
    });

    return this._loading;
  }

  /**
   * Los textos de Monaco en español, antes que Monaco.
   *
   * Sin esto, el menú contextual mezclaba «Abrir en el compositor» con «Cut»,
   * «Copy» y «Change All Occurrences». El paquete trae la traducción en
   * `vs/nls/lang/es.js`, que **no es un módulo AMD**: es un script que deja los
   * textos en `globalThis._VSCODE_NLS_MESSAGES`, y Monaco los lee de ahí al
   * evaluarse. Pedirlo por la opción `vs/nls` del cargador lo dejaba esperando
   * un `define` que nunca llega, y el editor no arrancaba. Por eso va como
   * script suelto y delante.
   *
   * Si falla, se sigue: un editor en inglés es mucho mejor que ninguno.
   */
  private loadMessages(): Promise<void> {
    return new Promise<void>((resolve) => {
      const script = document.createElement('script');
      script.src = `${MONACO_BASE}/vs/nls/lang/es.js`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }

  private async injectLoader(): Promise<typeof MonacoApi> {
    await this.loadMessages();

    return new Promise<typeof MonacoApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${MONACO_BASE}/vs/loader.js`;
      script.async = true;

      script.onload = () => {
        const amdRequire = window.require;

        if (!amdRequire?.config) {
          reject(new Error('El cargador de Monaco no quedó disponible.'));
          return;
        }

        amdRequire.config({ paths: { vs: `${MONACO_BASE}/vs` } });

        // El segundo callback no es opcional en la práctica: sin él, un módulo
        // que no carga deja la promesa **colgada para siempre** y el editor se
        // queda intentando, sin editor y sin error que enseñar.
        amdRequire(
          ['vs/editor/editor.main'],
          () => {
            if (!window.monaco) {
              reject(new Error('Monaco no se inicializó correctamente.'));
              return;
            }

            resolve(window.monaco);
          },
          (error: unknown) => {
            reject(new Error(`No se pudieron cargar los módulos del editor: ${describe(error)}`));
          },
        );
      };

      script.onerror = () => reject(new Error('No se pudo cargar Monaco.'));

      // Un cargador que no responde tampoco puede dejar la promesa en el aire:
      // sin esto, el editor esperaría indefinidamente a un script que nunca
      // llegó.
      setTimeout(() => reject(new Error('El editor tardó demasiado en cargar.')), LOAD_TIMEOUT_MS);

      document.head.appendChild(script);
    });
  }
}
