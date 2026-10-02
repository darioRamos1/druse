import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject } from '../../../shared/models/workspace';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';
import { DialogBackdrop } from '../../../shared/a11y/dialog-backdrop';
import { Icon } from '../../../shared/ui/icon/icon';

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
  imports: [Icon, DialogBackdrop, DialogFocus, FormsModule, TranslatePipe],
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.scss',
})
export class ImportDialog {
  private readonly _store = inject(WorkspaceStore);
  private readonly _i18n = inject(I18nService);

  /** El aviso de columnas obligatorias sin valor, con los nombres en negrita. */
  protected missingParts(columns: readonly string[]) {
    return this._i18n.tParts('import.missingRequired', { columns: columns.join(', ') });
  }

  /** Tabla de destino, la que el usuario eligió en el explorador. */
  readonly table = input.required<DatabaseObject>();
  readonly connectionId = input.required<string>();
  private readonly destinationSession = computed(() =>
    this._store.sessionForConnection(this.connectionId()),
  );

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
  protected readonly running = this._store.importRunning;
  private readonly options = computed(() => ({
    hasHeaders: this.hasHeaders(),
    delimiter: this.delimiter(),
    encoding: this.encoding(),
    nullText: this.nullText(),
  }));
  protected readonly canImport = computed(() => {
    const file = this.file();
    return (
      !!file &&
      !this.busy() &&
      this.preview()?.problems.length === 0 &&
      this._store.hasImportPreview(this.table(), file, this.options(), this.connectionId())
    );
  });

  constructor() {
    effect(() => {
      this.file();
      this.options();
      this.table();
      this.connectionId();
      this.destinationSession();
      this._store.clearImportPreview();
    });
    inject(DestroyRef).onDestroy(() => this._store.clearImportPreview());
  }

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

    if (!file || this.busy()) {
      return;
    }

    await this._store.previewImport(this.table(), file, this.options(), this.connectionId());
  }

  protected async run(): Promise<void> {
    const file = this.file();

    if (!file || !this.canImport()) {
      return;
    }

    const ok = await this._store.runImport(this.table(), file, this.options(), this.connectionId());

    if (ok) {
      this.close();
    }
  }

  protected close(): void {
    if (this.running()) {
      return;
    }
    this._store.clearImportPreview();
    this.closed.emit();
  }
}
