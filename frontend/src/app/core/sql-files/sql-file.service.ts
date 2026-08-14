import { Injectable, inject } from '@angular/core';

import {
  DesktopHost,
  OpenedSqlDocument,
  SavedSqlDocument,
} from '../application-gateway/desktop-host';

export interface SqlFileSaveRequest {
  readonly documentId?: string;
  readonly fileName?: string;
  readonly title: string;
  readonly contents: string;
}

@Injectable({ providedIn: 'root' })
export class SqlFileService {
  private readonly _desktop = inject(DesktopHost);

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

  private openInBrowser(): Promise<OpenedSqlDocument | null> {
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
          if (!file.name.toLowerCase().endsWith('.sql')) {
            reject(new Error('Solo se pueden abrir archivos con extensión .sql.'));
            return;
          }
          if (file.size > 10 * 1024 * 1024) {
            reject(new Error('El archivo SQL supera el límite de 10 MB.'));
            return;
          }

          file
            .text()
            .then((contents) =>
              resolve({
                documentId: '',
                fileName: file.name,
                contents: contents.replace(/^\uFEFF/, ''),
              }),
            )
            .catch(() => reject(new Error('No se pudo leer el archivo SQL.')));
        },
        { once: true },
      );
      window.addEventListener(
        'focus',
        () => {
          window.setTimeout(() => {
            if (input.isConnected && !input.files?.length) {
              input.remove();
              resolve(null);
            }
          });
        },
        { once: true },
      );
      input.click();
    });
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
