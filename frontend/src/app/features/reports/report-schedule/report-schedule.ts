import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ReportSchedule, ReportScheduleFrequency, ReportWeekDay } from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';

/** De lunes a domingo, como se lee un calendario en español. */
export const WEEK_DAYS: readonly ReportWeekDay[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** La zona del equipo, que es la que casi siempre se quiere. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Las zonas que se pueden elegir: la del equipo y UTC primero, y el resto en
 * orden. Si el navegador no sabe listarlas, al menos esas dos y la guardada.
 */
export function timeZoneChoices(current: string | null): readonly string[] {
  const local = localTimeZone();
  let all: readonly string[] = [];

  try {
    all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    all = [];
  }

  const first = [local, 'UTC', ...(current ? [current] : [])];

  return [...new Set([...first, ...[...all].sort()])];
}

/**
 * Programar la actualización de un conjunto: diaria o semanal, a una hora de
 * una zona, y pausarla o quitarla.
 *
 * Va en línea bajo la barra de datos, como guardar plantilla: se ve de qué
 * conjunto se habla mientras se programa. Quien guarda es el banco de trabajo;
 * aquí solo se arma la regla.
 */
@Component({
  selector: 'app-report-schedule',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  template: `
    <form class="schedule" (submit)="submit($event)" [attr.aria-label]="'reports.schedule.title' | t">
      <p class="schedule__title">{{ 'reports.schedule.title' | t }}</p>

      <div class="schedule__row">
        <div class="field">
          <span class="field__label" id="schedule-frequency">{{ 'reports.schedule.frequencyLabel' | t }}</span>
          <div class="choices" role="radiogroup" aria-labelledby="schedule-frequency">
            @for (option of frequencies; track option) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="frequency() === option"
                (click)="frequency.set(option)"
              >
                <!-- i18n-keys: reports.schedule.frequency.* -->
                {{ 'reports.schedule.frequency.' + option | t }}
              </button>
            }
          </div>
        </div>

        <label class="field field--time">
          <span class="field__label">{{ 'reports.schedule.time' | t }}</span>
          <input #timeInput type="time" required [value]="time()" (input)="time.set($any($event.target).value)" />
        </label>

        <label class="field field--zone">
          <span class="field__label">{{ 'reports.schedule.timeZone' | t }}</span>
          <select (change)="timeZone.set($any($event.target).value)">
            @for (zone of zones(); track zone) {
              <option [value]="zone" [selected]="zone === timeZone()">{{ zone }}</option>
            }
          </select>
        </label>
      </div>

      @if (frequency() === 'Weekly') {
        <fieldset class="field">
          <legend class="field__label">{{ 'reports.schedule.days' | t }}</legend>
          <div class="days">
            @for (day of weekDays; track day) {
              <label class="day">
                <input type="checkbox" [checked]="days().includes(day)" (change)="toggleDay(day, $any($event.target).checked)" />
                <!-- i18n-keys: reports.schedule.day.* -->
                <span>{{ 'reports.schedule.day.' + day | t }}</span>
              </label>
            }
          </div>
        </fieldset>
      }

      <label class="check">
        <input type="checkbox" [checked]="paused()" (change)="paused.set($any($event.target).checked)" />
        {{ 'reports.schedule.paused' | t }}
      </label>

      <p class="field__hint">{{ 'reports.schedule.hint' | t }}</p>
      @if (problem(); as key) {
        <!-- i18n-keys: reports.schedule.problem.* -->
        <p class="field__error" role="alert">{{ key | t }}</p>
      }

      <div class="schedule__actions">
        @if (schedule()) {
          <button type="button" class="link link--danger" [disabled]="busy()" (click)="removed.emit()">
            <app-icon name="trash" [size]="11" />
            {{ 'reports.schedule.remove' | t }}
          </button>
        }
        <span class="schedule__spacer"></span>
        <button type="button" class="button" (click)="cancelled.emit()">{{ 'common.cancel' | t }}</button>
        <button type="submit" class="button button--primary" [disabled]="busy() || problem() !== null">
          <app-icon name="clock" [size]="11" />
          {{ 'reports.schedule.save' | t }}
        </button>
      </div>
    </form>
  `,
  styles: `
    @use '../report-controls';

    .schedule {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 10px 14px 0;
      padding: 12px;
      border: 1px solid var(--dr-accent-line-strong);
      border-radius: var(--dr-radius-sm);
      background: var(--dr-surface-raised);

      &__title {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
      }

      &__row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 12px;
      }

      &__actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      &__spacer {
        flex: 1;
      }
    }

    .field--time {
      width: 120px;
    }

    .field--zone {
      flex: 1;
      min-width: 200px;
    }

    .choices {
      display: inline-flex;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--dr-border-input);
      border-radius: var(--dr-radius-sm);
      background: var(--dr-surface-input);

      button {
        height: 24px;
        padding: 0 12px;
        border: 0;
        border-radius: calc(var(--dr-radius-sm) - 2px);
        background: transparent;
        color: var(--dr-text-secondary);
        font: inherit;
        font-size: 12px;
        cursor: pointer;

        &[aria-checked='true'] {
          background: var(--dr-accent-tint);
          color: var(--dr-text);
          font-weight: 600;
        }
      }
    }

    .days {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .day {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 9px 4px 7px;
      border: 1px solid var(--dr-border-input);
      border-radius: 999px;
      color: var(--dr-text-secondary);
      font-size: 12px;
      cursor: pointer;

      input {
        width: auto;
        min-height: 0;
        margin: 0;
        accent-color: var(--dr-accent);
      }

      &:has(input:checked) {
        border-color: var(--dr-accent-line-strong);
        background: var(--dr-accent-tint);
        color: var(--dr-text);
      }

      &:has(input:focus-visible) {
        outline: 2px solid var(--dr-accent-line-strong);
        outline-offset: 1px;
      }
    }
  `,
})
export class ReportScheduleForm implements OnInit, AfterViewInit {
  /** La programación guardada, o `null` para crear una. */
  readonly schedule = input<ReportSchedule | null>(null);
  readonly busy = input(false);

  readonly saved = output<ReportSchedule>();
  readonly removed = output<void>();
  readonly cancelled = output<void>();

  protected readonly frequencies: readonly ReportScheduleFrequency[] = ['Daily', 'Weekly'];
  protected readonly weekDays = WEEK_DAYS;

  private readonly _timeInput = viewChild<ElementRef<HTMLInputElement>>('timeInput');

  protected readonly frequency = signal<ReportScheduleFrequency>('Daily');
  protected readonly time = signal('07:00');
  protected readonly days = signal<readonly ReportWeekDay[]>(['Monday']);
  protected readonly timeZone = signal(localTimeZone());
  protected readonly paused = signal(false);

  protected readonly zones = computed(() => timeZoneChoices(this.schedule()?.timeZone ?? null));

  /** Lo que impide guardar, como clave del catálogo. */
  protected readonly problem = computed(() => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(this.time())) {
      return 'reports.schedule.problem.time';
    }

    return this.frequency() === 'Weekly' && this.days().length === 0 ? 'reports.schedule.problem.days' : null;
  });

  ngOnInit(): void {
    const current = this.schedule();

    if (current) {
      this.frequency.set(current.frequency);
      this.time.set(current.time);
      this.days.set(current.days.length > 0 ? current.days : ['Monday']);
      this.timeZone.set(current.timeZone);
      this.paused.set(current.paused);
    }
  }

  ngAfterViewInit(): void {
    this._timeInput()?.nativeElement.focus();
  }

  protected toggleDay(day: ReportWeekDay, checked: boolean): void {
    // Se guarda en orden de semana, no en el orden en que se marcaron.
    this.days.update((days) => WEEK_DAYS.filter((item) => (item === day ? checked : days.includes(item))));
  }

  protected submit(event: Event): void {
    event.preventDefault();

    if (this.busy() || this.problem() !== null) {
      return;
    }

    this.saved.emit({
      frequency: this.frequency(),
      time: this.time(),
      days: this.frequency() === 'Weekly' ? this.days() : [],
      timeZone: this.timeZone(),
      paused: this.paused(),
    });
  }
}
