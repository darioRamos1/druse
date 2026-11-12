import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { formatDate, formatNumber } from '../../../core/i18n/locale-format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ReportRun, ReportStorage } from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { serverText } from '../report-messages';

/** Bytes en la unidad que se lee de un vistazo, con el formato del idioma. */
export function formatBytes(bytes: number): string {
  const units = [
    ['byte', 1],
    ['kilobyte', 1024],
    ['megabyte', 1024 ** 2],
    ['gigabyte', 1024 ** 3],
  ] as const;
  const [unit, size] = [...units].reverse().find(([, step]) => bytes >= step) ?? units[0];

  return formatNumber(bytes / size, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: size === 1 ? 0 : 1,
  });
}

/** Cuánto tardó un intento, en segundos o minutos. */
export function formatDuration(startedAtUtc: string, completedAtUtc: string): string {
  const seconds = Math.max(0, (Date.parse(completedAtUtc) - Date.parse(startedAtUtc)) / 1000);

  return seconds < 60
    ? formatNumber(seconds, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 })
    : formatNumber(seconds / 60, { style: 'unit', unit: 'minute', unitDisplay: 'short', maximumFractionDigits: 1 });
}

/**
 * El historial de intentos de un conjunto y lo que ocupa.
 *
 * Los intentos ya se guardaban —20 por conjunto— para contar el último fallo;
 * aquí se ven todos, con su origen, para entender por qué un dato es de ayer.
 * Abajo, el espacio y «Borrar datos guardados», que pide confirmación en el
 * propio botón: no hay nada que deshacer, pero sí se puede volver a actualizar.
 */
@Component({
  selector: 'app-report-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  template: `
    <section class="history" [attr.aria-label]="'reports.history.title' | t">
      <header class="history__head">
        <p class="history__title">{{ 'reports.history.title' | t }}</p>
        <button type="button" class="icon-button" [attr.aria-label]="'common.close' | t" (click)="closed.emit()">
          <app-icon name="close" [size]="11" />
        </button>
      </header>

      @if (runs().length === 0) {
        <p class="field__hint">{{ 'reports.history.empty' | t }}</p>
      } @else {
        <div class="history__scroll">
          <table class="runs">
            <thead>
              <tr>
                <th scope="col">{{ 'reports.history.when' | t }}</th>
                <th scope="col">{{ 'reports.history.originLabel' | t }}</th>
                <th scope="col">{{ 'reports.history.result' | t }}</th>
                <th scope="col" class="is-number">{{ 'reports.history.rows' | t }}</th>
                <th scope="col" class="is-number">{{ 'reports.history.duration' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (run of runs(); track run.id) {
                <tr [class.is-failed]="run.status !== 'Succeeded'">
                  <td>{{ when(run.startedAtUtc) }}</td>
                  <!-- i18n-keys: reports.history.origin.*, reports.history.status.* -->
                  <td>{{ 'reports.history.origin.' + run.origin | t }}</td>
                  <td>
                    <span class="status" [class.status--ok]="run.status === 'Succeeded'">
                      <app-icon [name]="run.status === 'Succeeded' ? 'check' : 'alert'" [size]="10" />
                      {{ 'reports.history.status.' + run.status | t }}
                    </span>
                    @if (run.status !== 'Succeeded' && reason(run); as text) {
                      <span class="runs__message">{{ text }}</span>
                    }
                  </td>
                  <td class="is-number">{{ run.status === 'Succeeded' ? count(run.rowCount) : '—' }}</td>
                  <td class="is-number">{{ duration(run.startedAtUtc, run.completedAtUtc) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="field__hint">{{ 'reports.history.retention' | t }}</p>
      }

      <div class="space">
        <div class="space__text">
          @if (storage(); as usage) {
            <span>
              {{ 'reports.history.datasetSpace' | t: { size: bytes(datasetBytes()) } }}
            </span>
            <span class="space__total">
              {{ 'reports.history.totalSpace' | t: { used: bytes(usage.snapshotBytes), quota: bytes(usage.quotaBytes), file: bytes(usage.fileBytes) } }}
            </span>
            <span class="meter" aria-hidden="true">
              <span class="meter__fill" [style.width.%]="share()"></span>
            </span>
          } @else {
            <span class="space__total">{{ 'reports.loading' | t }}</span>
          }
        </div>
        @if (hasData()) {
          @if (confirming()) {
            <div class="space__confirm" role="group" [attr.aria-label]="'reports.history.clearConfirm' | t">
              <span>{{ 'reports.history.clearConfirm' | t }}</span>
              <button type="button" class="button" (click)="confirming.set(false)">{{ 'common.cancel' | t }}</button>
              <button type="button" class="button button--danger" [disabled]="busy()" (click)="clear()">
                <app-icon name="trash" [size]="11" />
                {{ 'reports.history.clearYes' | t }}
              </button>
            </div>
          } @else {
            <button type="button" class="link link--danger" [disabled]="busy()" (click)="confirming.set(true)">
              <app-icon name="trash" [size]="11" />
              {{ 'reports.history.clear' | t }}
            </button>
          }
        }
      </div>
    </section>
  `,
  styles: `
    @use '../report-controls';

    .history {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 10px 14px 0;
      padding: 10px 12px 12px;
      border: 1px solid var(--dr-border);
      border-radius: var(--dr-radius-sm);
      background: var(--dr-surface-raised);

      &__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      &__title {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
      }

      &__scroll {
        max-height: 220px;
        overflow: auto;
        border: 1px solid var(--dr-border-subtle);
        border-radius: var(--dr-radius-sm);
      }
    }

    .runs {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;

      th,
      td {
        padding: 5px 8px;
        border-bottom: 1px solid var(--dr-border-subtle);
        text-align: left;
        vertical-align: top;
      }

      th {
        position: sticky;
        top: 0;
        background: var(--dr-surface-raised);
        font-size: 11px;
        font-weight: 600;
        color: var(--dr-text-tertiary);
      }

      tr:last-child td {
        border-bottom: 0;
      }

      .is-number {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      &__message {
        display: block;
        margin-top: 2px;
        color: var(--dr-text-tertiary);
        line-height: 1.4;
      }
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--dr-danger-text);
      font-weight: 600;

      &--ok {
        color: var(--dr-text-secondary);
        font-weight: 400;

        app-icon {
          color: var(--dr-success);
        }
      }
    }

    .space {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 14px;
      padding-top: 8px;
      border-top: 1px solid var(--dr-border-subtle);

      &__text {
        display: flex;
        flex-direction: column;
        gap: 3px;
        flex: 1;
        min-width: 220px;
        font-size: 12px;
      }

      &__total {
        font-size: 11.5px;
        color: var(--dr-text-tertiary);
      }

      &__confirm {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }
    }

    .meter {
      display: block;
      width: 100%;
      max-width: 280px;
      height: 4px;
      border-radius: 2px;
      background: var(--dr-border-subtle);
      overflow: hidden;

      &__fill {
        display: block;
        height: 100%;
        min-width: 2px;
        background: var(--dr-accent);
      }
    }
  `,
})
export class ReportHistory {
  readonly runs = input.required<readonly ReportRun[]>();
  readonly storage = input<ReportStorage | null>(null);
  readonly datasetId = input.required<string>();
  /** Hay un resultado guardado que borrar. */
  readonly hasData = input(false);
  readonly busy = input(false);

  readonly cleared = output<void>();
  readonly closed = output<void>();

  private readonly _i18n = inject(I18nService);

  protected readonly confirming = signal(false);

  protected readonly datasetBytes = computed(
    () => this.storage()?.datasets.find((entry) => entry.datasetId === this.datasetId())?.snapshotBytes ?? 0,
  );

  protected readonly share = computed(() => {
    const usage = this.storage();

    return usage && usage.quotaBytes > 0 ? Math.min(100, (usage.snapshotBytes / usage.quotaBytes) * 100) : 0;
  });

  protected when(iso: string): string {
    return formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected reason(run: ReportRun): string | null {
    return serverText(this._i18n, run.localized, run.message);
  }

  protected count(value: number): string {
    return formatNumber(value);
  }

  protected bytes(value: number): string {
    return formatBytes(value);
  }

  protected duration(started: string, completed: string): string {
    return formatDuration(started, completed);
  }

  protected clear(): void {
    this.confirming.set(false);
    this.cleared.emit();
  }
}
