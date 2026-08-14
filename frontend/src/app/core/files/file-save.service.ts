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
@Injectable({ providedIn: 'root' })
export class FileSaveService {
  private readonly _desktop = inject(DesktopHost);

  /**
   * Guarda el contenido con el nombre propuesto.
   *
   * @returns `true` si el archivo quedó guardado; `false` si el usuario cerró el
   * diálogo sin elegir destino. Distinguir ambos casos es lo que permite no
   * anunciar una exportación que no ocurrió.
   */
  async save(fileName: string, blob: Blob): Promise<boolean> {
    if (this._desktop.isDesktop) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const path = await this._desktop.saveExport(fileName, bytes);

      return path !== null;
    }

    this.download(fileName, blob);

    return true;
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
