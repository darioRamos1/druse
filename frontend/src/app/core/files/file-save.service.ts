import { Injectable, inject } from '@angular/core';

import { DesktopHost } from '../application-gateway/desktop-host';

/**
 * Deja un archivo generado en manos del usuario.
 *
 * Existe porque **las dos formas de ejecutar Druse guardan de manera distinta** y
 * el resto de la aplicación no debería enterarse. En el navegador se descarga; en
 * la ventana empaquetada hay que pedirle al envoltorio que abra el diálogo del
 * sistema y escriba el archivo.
 *
 * La descarga del navegador **no funciona dentro de Tauri**: la CSP solo admite
 * `blob:` para imágenes y workers, y el WebView no trae gestor de descargas. Lo
 * grave es que tampoco falla —`click()` sobre el enlace no lanza nada—, así que
 * la aplicación anunciaba «Exportado» sin haber escrito ningún archivo. Es la
 * misma clase de fallo que la hoja de estilos bloqueada por la CSP: **solo se ve
 * empaquetando**.
 */
/**
 * Qué pasó al guardar.
 *
 * `path` solo lo hay en el escritorio, donde el usuario eligió la ruta; en el
 * navegador el archivo se descarga y nadie sabe dónde acaba.
 */
export type SaveOutcome =
  { readonly saved: false } | { readonly saved: true; readonly path: string | null };

/**
 * Cómo contarle a alguien dónde quedó su archivo.
 *
 * En el escritorio se nombra la ruta entera: es la respuesta a «lo exporté y no
 * sé dónde está». En el navegador no se inventa nada, porque no se sabe.
 */
export function describeSave(
  outcome: SaveOutcome,
  done: string,
  cancelled = 'Guardado cancelado.',
): string {
  if (!outcome.saved) {
    return cancelled;
  }

  return outcome.path ? `${done} en ${outcome.path}` : `${done}.`;
}

@Injectable({ providedIn: 'root' })
export class FileSaveService {
  private readonly _desktop = inject(DesktopHost);

  /**
   * Guarda el contenido con el nombre propuesto.
   *
   * Devuelve **dónde** quedó, no solo si quedó. En el escritorio la ruta la
   * elige el usuario en el diálogo del sistema, y decírsela de vuelta es la
   * diferencia entre «Exportado» y saber qué archivo abrir: es literalmente lo
   * que se preguntaba —«no sé dónde se guardan»—. En el navegador no hay ruta
   * que dar: el archivo va a donde el navegador descargue, y `path` es `null`.
   */
  async save(fileName: string, blob: Blob): Promise<SaveOutcome> {
    if (this._desktop.isDesktop) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const path = await this._desktop.saveExport(fileName, bytes);

      // `null` es que el usuario cerró el diálogo sin elegir destino. Distinguir
      // ese caso es lo que permite no anunciar una exportación que no ocurrió.
      return path === null ? { saved: false } : { saved: true, path };
    }

    this.download(fileName, blob);

    return { saved: true, path: null };
  }

  /**
   * Descarga desde el navegador.
   *
   * La URL se revoca después: sin revocarla, el navegador conserva el archivo en
   * memoria hasta recargar la página, y exportar varias veces iría acumulando
   * copias de tablas que pueden pesar cientos de megas.
   */
  private download(fileName: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.click();

    URL.revokeObjectURL(url);
  }
}
