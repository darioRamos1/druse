import { Injectable, inject } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';

import {
  DesktopHost,
  OpenedSqlDocument,
  SavedSqlDocument,
} from '../application-gateway/desktop-host';

/** Tope de tamaño de un `.sql`: por encima, el editor no lo aguanta. */
const MAX_SQL_BYTES = 10 * 1024 * 1024;

/** Lo poco que se usa de `showOpenFilePicker`, que TypeScript aún no declara. */
type FilePicker = (options: {
  multiple: boolean;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ getFile(): Promise<File> }[]>;

export interface SqlFileSaveRequest {
  readonly documentId?: string;
  readonly fileName?: string;
  readonly title: string;
  readonly contents: string;
}

@Injectable({ providedIn: 'root' })
export class SqlFileService {
  private readonly _desktop = inject(DesktopHost);
  private readonly _i18n = inject(I18nService);

  async open(): Promise<OpenedSqlDocument | null> {
    if (this._desktop.isDesktop) {
      return this._desktop.openSqlFile();
    }

    return this.openInBrowser();
  }

  async save(request: SqlFileSaveRequest, saveAs = false): Promise<SavedSqlDocument | null> {
    if (this._desktop.isDesktop) {
      if (request.documentId && !saveAs) {
        return this._desktop.saveSqlFile(request.documentId, request.contents);
      }

      return this._desktop.saveSqlFileAs(
        request.fileName ?? this.fileName(request.title),
        request.contents,
        request.documentId,
      );
    }

    const fileName = request.fileName ?? this.fileName(request.title);
    this.download(fileName, request.contents);
    return { documentId: '', fileName };
  }

  /**
   * Abre un `.sql` desde el navegador.
   *
   * Se prefiere el selector del sistema —`showOpenFilePicker`— porque **entrega
   * el archivo y ya está**: sin eventos, sin carreras y con una forma inequívoca
   * de saber que el usuario cerró el diálogo sin elegir. Donde no existe se
   * recurre al `<input>` de toda la vida.
   */
  private async openInBrowser(): Promise<OpenedSqlDocument | null> {
    const picker = (window as Window & { showOpenFilePicker?: FilePicker }).showOpenFilePicker;

    if (typeof picker !== 'function') {
      return this.openWithInput();
    }

    let file: File;

    try {
      const [handle] = await picker.call(window, {
        multiple: false,
        types: [{ description: 'Consultas SQL', accept: { 'text/sql': ['.sql'] } }],
      });

      file = await handle.getFile();
    } catch (error) {
      // Cerrar el diálogo sin elegir nada no es un error que enseñar.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null;
      }

      // Un navegador que lo anuncia pero lo tiene capado —dentro de un iframe,
      // por ejemplo— no debe dejar sin abrir archivos: se prueba por el otro
      // camino antes de darse por vencido.
      return this.openWithInput();
    }

    return this.read(file);
  }

  /**
   * El camino de siempre: un `<input type="file">` invisible.
   *
   * **Ya no se mira el foco de la ventana para adivinar si se canceló.** Eso era
   * lo que rompía el caso normal: al elegir un archivo, el navegador devuelve el
   * foco *antes* de despachar el `change`, así que se quitaba el input del DOM
   * —matando el evento que estaba por llegar— y se resolvía como si no se
   * hubiera elegido nada. El archivo se seleccionaba y no se abría nunca.
   *
   * Lo que sí dice si se canceló es el evento `cancel` del propio input, que es
   * exactamente para lo que existe.
   */
  private openWithInput(): Promise<OpenedSqlDocument | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');

      input.type = 'file';
      input.accept = '.sql,text/plain';
      input.hidden = true;
      document.body.append(input);

      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0];
          input.remove();

          if (!file) {
            resolve(null);
            return;
          }

          this.read(file).then(resolve, reject);
        },
        { once: true },
      );

      input.addEventListener(
        'cancel',
        () => {
          input.remove();
          resolve(null);
        },
        { once: true },
      );

      input.click();
    });
  }

  /** Comprueba el archivo elegido y devuelve su contenido. */
  private async read(file: File): Promise<OpenedSqlDocument> {
    if (!file.name.toLowerCase().endsWith('.sql')) {
      throw new Error(this._i18n.t('sqlFile.wrongExtension'));
    }

    if (file.size > MAX_SQL_BYTES) {
      throw new Error(this._i18n.t('sqlFile.tooBig'));
    }

    let contents: string;

    try {
      contents = await file.text();
    } catch {
      throw new Error(this._i18n.t('sqlFile.readFailed'));
    }

    return {
      documentId: '',
      fileName: file.name,
      // El BOM es del archivo, no del SQL: dejarlo delante del primer `SELECT`
      // haría que el motor no reconociera la instrucción.
      contents: contents.replace(/^\uFEFF/, ''),
    };
  }

  private download(fileName: string, contents: string): void {
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/sql;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  private fileName(title: string): string {
    const base = title.trim().replace(/[<>:"/\\|?*]/g, '_') || 'consulta';
    return base.toLowerCase().endsWith('.sql') ? base : `${base}.sql`;
  }
}
