import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject } from '../../../shared/models/workspace';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';

/**
 * Importar un archivo dentro de una tabla.
 *
 * El diálogo tiene dos estados y no se puede saltar del primero al último:
 * elegir el archivo, y **ver qué va a pasar** antes de escribir. Esa segunda
 * pantalla es la razón de ser de toda la función: una importación mal mapeada no
 * falla, funciona, y mete los datos en la columna equivocada.
 */
@Component({
  selector: 'app-import-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogFocus, FormsModule],
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.scss',
})
export class ImportDialog {
  private readonly _store = inject(WorkspaceStore);

  /** Tabla de destino, la que el usuario eligió en el explorador. */
  readonly table = input.required<DatabaseObject>();
  readonly connectionId = input.required<string>();

  readonly closed = output<void>();

  protected readonly file = signal<File | null>(null);

  // Opciones de lectura. Se preguntan en lugar de adivinarlas: equivocarse al
  // adivinar sobre un archivo que va a acabar en una tabla es peor que preguntar.
  protected readonly hasHeaders = signal(true);
  protected readonly delimiter = signal(',');
  protected readonly encoding = signal('utf8bom');
  protected readonly nullText = signal('');

  protected readonly preview = this._store.importPreview;
  protected readonly busy = this._store.importing;

  protected readonly qualified = computed(() => {
    const table = this.table();

    return table.schema ? `${table.schema}.${table.name}` : table.name;
  });

  /** Columnas del archivo que no van a ninguna parte. */
  protected readonly ignored = computed(
    () => this.preview()?.mappings.filter((mapping) => !mapping.target) ?? [],
  );

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;

    this.file.set(input.files?.[0] ?? null);
    this._store.clearImportPreview();
  }

  protected async analyze(): Promise<void> {
    const file = this.file();

    if (!file) {
      return;
    }

    await this._store.previewImport(
      this.table(),
      file,
      {
        hasHeaders: this.hasHeaders(),
        delimiter: this.delimiter(),
        encoding: this.encoding(),
        nullText: this.nullText(),
      },
      this.connectionId(),
    );
  }

  protected async run(): Promise<void> {
    const file = this.file();

    if (!file) {
      return;
    }

    const ok = await this._store.runImport(
      this.table(),
      file,
      {
        hasHeaders: this.hasHeaders(),
        delimiter: this.delimiter(),
        encoding: this.encoding(),
        nullText: this.nullText(),
      },
      this.connectionId(),
    );

    if (ok) {
      this.close();
    }
  }

  protected close(): void {
    this._store.clearImportPreview();
    this.closed.emit();
  }
}
