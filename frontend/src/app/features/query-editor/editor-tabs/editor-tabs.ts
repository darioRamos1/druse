import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { QueryTab } from '../../../shared/models/workspace';

/** Barra de pestañas de consultas abiertas. */
@Component({
  selector: 'app-editor-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor-tabs.html',
  styleUrl: './editor-tabs.scss',
})
export class EditorTabs {
  readonly tabs = input.required<readonly QueryTab[]>();
  readonly encoding = input('UTF-8 · LF');

  readonly select = output<string>();
  readonly close = output<string>();
  readonly create = output<void>();

  /** Evita que cerrar una pestaña la seleccione antes. */
  protected onClose(event: Event, id: string): void {
    event.stopPropagation();
    this.close.emit(id);
  }
}
