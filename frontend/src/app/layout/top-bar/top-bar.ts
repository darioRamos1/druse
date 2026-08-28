import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { ThemeName } from '../../core/theme/theme.service';
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
  /** Tema en uso. La barra lo enseña, pero no lo decide ni lo guarda. */
  readonly theme = input<ThemeName>('dark');

  readonly newConnection = output<void>();
  readonly newQuery = output<void>();
  readonly openSql = output<void>();
  readonly saveSql = output<void>();
  readonly saveSqlAs = output<void>();
  readonly openPalette = output<void>();
  readonly themeSelected = output<ThemeName>();
  readonly openSettings = output<void>();

  /** El panel del asistente esta abierto. El boton se queda encendido mientras. */
  readonly assistantOpen = input(false);

  readonly toggleAssistant = output<void>();
}
