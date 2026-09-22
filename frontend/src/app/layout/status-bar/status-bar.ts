import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { BackupStore } from '../../core/backup/backup.store';
import { RestoreStore } from '../../core/backup/restore.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { RunningJobsService } from '../../core/jobs/running-jobs.service';
import { SessionStatus } from '../../shared/models/workspace';
import { EngineBadge } from '../../shared/ui/engine-badge/engine-badge';

/** Barra inferior: estado de la sesión, posición del cursor y codificación. */
@Component({
  selector: 'app-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EngineBadge, TranslatePipe],
  templateUrl: './status-bar.html',
  styleUrl: './status-bar.scss',
})
export class StatusBar {
  readonly session = input.required<SessionStatus>();
  readonly line = input(1);
  readonly column = input(1);
  /**
   * Codificación y fin de línea del documento.
   *
   * Van juntos y **solo aquí**: la fila de pestañas decía lo mismo unos píxeles
   * más arriba, así que la misma información aparecía dos veces en la pantalla y
   * a 900 px le quitaba sitio a las pestañas.
   */
  readonly encoding = input('UTF-8 · LF');

  /** Volver al detalle del respaldo en marcha. */
  readonly showBackup = output<void>();

  /** Volver al detalle de la restauración en marcha. */
  readonly showRestore = output<void>();
  readonly showActivity = output<void>();

  /**
   * El respaldo se mira desde aquí porque **sobrevive al asistente**.
   *
   * Cerrar el diálogo no para el trabajo, y sin este indicador el usuario se
   * queda a ciegas justo cuando más dura la operación. Se lee del almacén y no
   * de una entrada porque el estado no es de la ventana: es de la aplicación.
   */
  protected readonly backup = inject(BackupStore);

  /**
   * Lo que quedó a medias la última vez que se cerró Druse.
   *
   * Va aquí y no en un diálogo porque no exige hacer nada: es un dato que el
   * usuario tiene que ver al volver —«aquel respaldo no terminó»— y decidir por
   * su cuenta qué hacer con lo que quedó escrito.
   */
  protected readonly jobs = inject(RunningJobsService);
  private readonly _i18n = inject(I18nService);

  protected readonly interrupted = this.jobs.interrupted;

  protected readonly interruptedLabel = computed(() => {
    return this._i18n.t('status.interrupted', { count: this.interrupted().length });
  });

  /** El aviso abre la actividad; descartarlo es una decisión aparte. */
  protected readonly interruptedDetail = computed(() =>
    [
      this._i18n.t('status.interruptedWhy'),
      '',
      ...this.interrupted().map((job) => {
        const kind = this._i18n.t('status.jobKind', { kind: job.kind });

        return job.subject
          ? this._i18n.t('status.jobWithSubject', { kind, subject: job.subject })
          : this._i18n.t('status.job', { kind });
      }),
      '',
      this._i18n.t('status.interruptedMore'),
    ].join('\n'),
  );

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

  protected readonly restoreSubject = computed(() =>
    shorten(this.restore.progress()?.currentObject),
  );
}

/** Recorta un nombre largo para que no empuje al resto de la barra. */
function shorten(name: string | undefined): string {
  const text = name ?? '';

  return text.length > 32 ? `${text.slice(0, 31)}…` : text;
}
