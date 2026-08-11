import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { SessionStatus } from '../../shared/models/workspace';
import { EngineBadge } from '../../shared/ui/engine-badge/engine-badge';

/** Barra inferior: estado de la sesión, posición del cursor y codificación. */
@Component({
  selector: 'app-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EngineBadge],
  templateUrl: './status-bar.html',
  styleUrl: './status-bar.scss',
})
export class StatusBar {
  readonly session = input.required<SessionStatus>();
  readonly line = input(1);
  readonly column = input(1);
  readonly encoding = input('UTF-8');
}
