import { Injectable } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';

/** Ruta donde `angular.json` copia el paquete de Monaco. */
const MONACO_BASE = 'assets/monaco';

declare global {
  interface Window {
    /** Cargador AMD que expone `loader.js` de Monaco. */
    require?: {
      (modules: string[], onLoad: () => void): void;
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

    this._loading ??= this.injectLoader();
    return this._loading;
  }

  private injectLoader(): Promise<typeof MonacoApi> {
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

        amdRequire(['vs/editor/editor.main'], () => {
          if (!window.monaco) {
            reject(new Error('Monaco no se inicializó correctamente.'));
            return;
          }

          resolve(window.monaco);
        });
      };

      script.onerror = () => reject(new Error('No se pudo cargar Monaco.'));

      document.head.appendChild(script);
    });
  }
}
