import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { ConnectionSummary, QueryTab } from '../../../shared/models/workspace';
import { EngineBadge } from '../../../shared/ui/engine-badge/engine-badge';

/** Barra de pestañas de consultas abiertas. */
@Component({
  selector: 'app-editor-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EngineBadge],
  templateUrl: './editor-tabs.html',
  styleUrl: './editor-tabs.scss',
})
export class EditorTabs {
  readonly tabs = input.required<readonly QueryTab[]>();
  readonly connections = input.required<readonly ConnectionSummary[]>();
  readonly encoding = input('UTF-8 · LF');

  readonly select = output<string>();
  readonly close = output<string>();
  readonly create = output<void>();

  /** Evita que cerrar una pestaña la seleccione antes. */
  protected onClose(event: Event, id: string): void {
    event.stopPropagation();
    this.close.emit(id);
  }

  protected onTabKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    let target = index;

    if (event.key === 'ArrowRight') {
      target = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      target = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      target = 0;
    } else if (event.key === 'End') {
      target = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    this.select.emit(tabs[target].id);
    const tabElements = (
      event.currentTarget as HTMLElement
    ).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
    queueMicrotask(() => tabElements?.[target]?.focus());
  }

  protected stopCloseKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
  }

  protected connectionFor(tab: QueryTab): ConnectionSummary | undefined {
    return this.connections().find((connection) => connection.id === tab.connectionId);
  }
}
