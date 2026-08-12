import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

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
}
