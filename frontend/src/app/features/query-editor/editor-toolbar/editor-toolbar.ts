import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

import { Icon } from '../../../shared/ui/icon/icon';

/**
 * Barra de acciones del editor.
 *
 * Los botones solo emiten intenciones; quién puede ejecutar y con qué límites lo
 * decide el store, y el servidor lo vuelve a comprobar.
 */
@Component({
  selector: 'app-editor-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './editor-toolbar.html',
  styleUrl: './editor-toolbar.scss',
})
export class EditorToolbar {
  readonly context = input.required<string>();
  readonly timeoutSeconds = input(30);
  readonly running = input(false);
  readonly hasSelection = input(false);
  /** Hay una conexión abierta contra la que ejecutar. */
  readonly canExecute = input(false);

  readonly execute = output<void>();
  readonly executeSelection = output<void>();
  readonly cancel = output<void>();
  readonly format = output<void>();
  readonly timeoutChange = output<number>();

  /** Valores habituales, para no obligar a teclear un número. */
  protected readonly timeoutOptions = [5, 10, 30, 60, 300, 600];

  protected readonly editingTimeout = signal(false);

  protected toggleTimeout(): void {
    this.editingTimeout.update((open) => !open);
  }

  protected chooseTimeout(seconds: number): void {
    this.editingTimeout.set(false);
    this.timeoutChange.emit(seconds);
  }

  /** Etiqueta compacta: 600 s se lee peor que 10 min. */
  protected label(seconds: number): string {
    return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
  }
}
