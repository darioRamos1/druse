import { inject, ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { Icon } from '../icon/icon';
import { formatNumber } from '../../../core/i18n/locale-format';

/**
 * Cómo va una operación larga, con lo que hace falta para no mentir.
 *
 * **Dos barras y no una.** Con la global sola, una tabla de ocho millones de
 * filas deja el indicador inmóvil veinte minutos y el usuario concluye que se
 * colgó; la segunda barra existe justo para ese rato.
 *
 * **Nada de barras falsas.** Cuando no se conoce el total —una tabla con
 * condición, una lectura sin estimación— la barra va indeterminada y se enseña el
 * contador absoluto. Una barra que llega al 90 % y se queda ahí es peor que no
 * tener barra, porque miente sobre lo que falta.
 *
 * Vive en `shared/ui` y no dentro de los respaldos porque el problema no es suyo:
 * exportar un resultado grande e importar un archivo tienen el mismo y hoy no lo
 * resuelven.
 */
@Component({
  selector: 'app-operation-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  templateUrl: './operation-progress.html',
  styleUrl: './operation-progress.scss',
})
export class OperationProgress {
  /** Qué se está haciendo ahora: «Escribiendo datos». */
  readonly step = input<string>('');

  /** El objeto en curso, con su nombre propio. Nunca un porcentaje suelto. */
  readonly subject = input<string>('');

  /** Avance global entre 0 y 1, o `null` si no se conoce el total. */
  readonly overall = input<number | null>(null);

  /** Avance del objeto en curso entre 0 y 1, o `null` si no hay estimación. */
  readonly current = input<number | null>(null);

  readonly done = input<number>(0);

  readonly total = input<number>(0);

  readonly rowsDone = input<number>(0);

  /** Filas esperadas del objeto en curso. Ausente: indeterminada con contador. */
  readonly rowsEstimated = input<number | null>(null);

  readonly elapsedMs = input<number>(0);

  readonly cancellable = input<boolean>(true);

  readonly cancelRequested = output<void>();

  private readonly _i18n = inject(I18nService);

  protected readonly percent = computed(() => toPercent(this.overall()));

  protected readonly currentPercent = computed(() => toPercent(this.current()));

  /** Si la barra del objeto tiene que ir indeterminada. */
  protected readonly indeterminate = computed(() => this.current() === null && this.rowsDone() > 0);

  /**
   * Las filas del objeto en curso, con la virgulilla que avisa de que el total es
   * una estimación del catálogo y no un recuento.
   */
  protected readonly rows = computed(() => {
    const done = format(this.rowsDone());
    const estimated = this.rowsEstimated();

    if (!estimated || estimated <= 0) {
      return this.rowsDone() > 0 ? this._i18n.t('progress.rowsWritten', { done }) : '';
    }

    return this._i18n.t('progress.rowsOf', { done, estimated: format(estimated) });
  });

  protected readonly objects = computed(() =>
    this.total() > 0
      ? this._i18n.t('progress.objects', { done: this.done(), total: this.total() })
      : '',
  );

  protected readonly elapsed = computed(() => {
    const seconds = Math.floor(this.elapsedMs() / 1000);

    if (seconds < 60) {
      return this._i18n.t('progress.seconds', { seconds });
    }

    const minutes = Math.floor(seconds / 60);

    return this._i18n.t('progress.minutes', { minutes, seconds: seconds % 60 });
  });
}

function toPercent(value: number | null): number | null {
  return value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/** Separa los miles para que un millón se lea de un vistazo. */
function format(value: number): string {
  return formatNumber(value);
}
