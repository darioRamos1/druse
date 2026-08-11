import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { Icon } from '../../../shared/ui/icon/icon';

/**
 * Barra de acciones del editor.
 *
 * En la Fase 1 los botones solo emiten eventos; la ejecución real llega en la
 * Fase 2. «Cancelar» aparece deshabilitado mientras no hay consulta en curso.
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

  readonly execute = output<void>();
  readonly executeSelection = output<void>();
  readonly cancel = output<void>();
  readonly format = output<void>();
}
