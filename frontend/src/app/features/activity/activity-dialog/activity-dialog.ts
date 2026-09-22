import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';

import {
  ApplicationGateway,
  JobSummary,
} from '../../../core/application-gateway/application-gateway';
import { RunningJobsService } from '../../../core/jobs/running-jobs.service';
import { DialogBackdrop } from '../../../shared/a11y/dialog-backdrop';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';
import { formatDate } from '../../../core/i18n/locale-format';

/** Consultar el historial nunca descarta avisos ni reinicia trabajos. */
@Component({
  selector: 'app-activity-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogBackdrop, DialogFocus, TranslatePipe],
  templateUrl: './activity-dialog.html',
  styleUrl: './activity-dialog.scss',
})
export class ActivityDialog {
  readonly closed = output<void>();
  protected readonly runningJobs = inject(RunningJobsService);
  private readonly gateway = inject(ApplicationGateway);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _i18n = inject(I18nService);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  // Si la API no responde, todavía se puede consultar el aviso del arranque.
  protected readonly jobs = signal<readonly JobSummary[]>(this.runningJobs.interrupted());
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  constructor() {
    this.refresh();
  }

  protected refresh(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.failed.set(false);
    this.gateway
      .getJobs()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (jobs) => this.jobs.set(jobs),
        error: () => this.failed.set(true),
      });
  }

  protected dismissNotices(): void {
    this.runningJobs.dismissInterrupted();
    // La acción desaparece al ocultar los avisos: el teclado sigue en el diálogo.
    this.closeButton()?.nativeElement.focus();
  }

  protected name(job: JobSummary): string {
    return this._i18n.t('activity.kind', { kind: job.kind });
  }

  protected state(job: JobSummary): string {
    const state =
      job.state === 'Interrupted' || job.state === 'Running' ? job.state : (job.outcome ?? '');

    return this._i18n.t('activity.state', { state });
  }

  protected needsAttention(job: JobSummary): boolean {
    return job.state === 'Interrupted' || job.outcome === 'CompletedWithWarnings';
  }

  protected date(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? this._i18n.t('activity.noDate')
      : formatDate(date, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
