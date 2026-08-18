import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { BackupStore } from '../../core/backup/backup.store';
import { RestoreStore } from '../../core/backup/restore.store';
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

  /** Volver al detalle del respaldo en marcha. */
  readonly showBackup = output<void>();

  /** Volver al detalle de la restauración en marcha. */
  readonly showRestore = output<void>();

  /**
   * El respaldo se mira desde aquí porque **sobrevive al asistente**.
   *
   * Cerrar el diálogo no para el trabajo, y sin este indicador el usuario se
   * queda a ciegas justo cuando más dura la operación. Se lee del almacén y no
   * de una entrada porque el estado no es de la ventana: es de la aplicación.
   */
  protected readonly backup = inject(BackupStore);

  /** Porcentaje redondeado, o `null` mientras no se conozca el total. */
  protected readonly percent = computed(() => {
    const overall = this.backup.overall();

    return overall === null ? null : Math.round(overall * 100);
  });

  /** El objeto en curso, recortado: la barra no puede crecer a lo ancho. */
  protected readonly subject = computed(() => shorten(this.backup.progress()?.currentObject));

  /**
   * La restauración se mira desde aquí por lo mismo, y con más motivo: mientras
   * corre **se está escribiendo en la base**, así que perderla de vista es peor
   * que perder de vista un respaldo.
   */
  protected readonly restore = inject(RestoreStore);

  protected readonly restorePercent = computed(() => {
    const overall = this.restore.overall();

    return overall === null ? null : Math.round(overall * 100);
  });

  protected readonly restoreSubject = computed(() => shorten(this.restore.progress()?.currentObject));
}

/** Recorta un nombre largo para que no empuje al resto de la barra. */
function shorten(name: string | undefined): string {
  const text = name ?? '';

  return text.length > 32 ? `${text.slice(0, 31)}…` : text;
}
