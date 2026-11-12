import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ReportTemplateScope } from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';

export interface TemplateSaveRequest {
  readonly name: string;
  readonly description: string | null;
}

/**
 * Pide nombre y descripción para guardar algo como plantilla.
 *
 * Va en línea, junto a lo que se guarda, y no en otro diálogo: así se ve qué
 * se está convirtiendo en plantilla mientras se le pone nombre.
 */
@Component({
  selector: 'app-report-template-save',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  template: `
    <form class="save" (submit)="submit($event)" [attr.aria-label]="'reports.template.saveAs.' + scope() | t">
      <!-- i18n-keys: reports.template.saveAs.* -->
      <p class="save__title">{{ 'reports.template.saveAs.' + scope() | t }}</p>
      <label class="field">
        <span class="field__label">{{ 'reports.template.name' | t }}</span>
        <input #nameInput type="text" maxlength="120" [value]="name()" (input)="name.set($any($event.target).value)" />
      </label>
      <label class="field">
        <span class="field__label">{{ 'reports.template.description' | t }}</span>
        <textarea rows="2" maxlength="400" [value]="description()" (input)="description.set($any($event.target).value)"></textarea>
      </label>
      <p class="field__hint">{{ 'reports.template.saveHint' | t }}</p>
      <div class="save__actions">
        <button type="button" class="button" (click)="cancelled.emit()">{{ 'common.cancel' | t }}</button>
        <button type="submit" class="button button--primary" [disabled]="!name().trim() || busy()">
          <app-icon name="save" [size]="11" />
          {{ 'reports.template.save' | t }}
        </button>
      </div>
    </form>
  `,
  styles: `
    @use '../report-controls';

    .save {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--dr-accent-line-strong);
      border-radius: var(--dr-radius-sm);
      background: var(--dr-surface-base);

      &__title {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
      }

      &__actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
    }

    textarea {
      resize: vertical;
    }
  `,
})
export class ReportTemplateSave implements OnInit, AfterViewInit {
  readonly scope = input.required<ReportTemplateScope>();
  readonly defaultName = input('');
  readonly busy = input(false);

  readonly saved = output<TemplateSaveRequest>();
  readonly cancelled = output<void>();

  private readonly _nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly name = signal('');
  protected readonly description = signal('');

  ngOnInit(): void {
    this.name.set(this.defaultName());
  }

  /** El nombre propuesto llega seleccionado: se acepta con Intro o se sobrescribe. */
  ngAfterViewInit(): void {
    const element = this._nameInput()?.nativeElement;

    element?.focus();
    element?.select();
  }

  protected submit(event: Event): void {
    event.preventDefault();

    if (this.name().trim() && !this.busy()) {
      this.saved.emit({ name: this.name().trim(), description: this.description().trim() || null });
    }
  }
}
