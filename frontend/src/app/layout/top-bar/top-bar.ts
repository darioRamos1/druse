import { ChangeDetectionStrategy, Component, output } from '@angular/core';

import { Icon } from '../../shared/ui/icon/icon';

/** Barra superior: marca, acciones principales, búsqueda global y controles de ventana. */
@Component({
  selector: 'app-top-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.scss',
})
export class TopBar {
  readonly newConnection = output<void>();
  readonly newQuery = output<void>();
  readonly openPalette = output<void>();
}
