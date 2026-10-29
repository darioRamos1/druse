import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { AiErrorAttachment, AiExecutionError } from '../../../shared/models/ai';

@Component({
  selector: 'app-ai-execution-error',
  imports: [TranslatePipe],
  templateUrl: './ai-execution-error.html',
  styleUrl: './ai-execution-error.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiExecutionErrorEditor {
  readonly attachment = input.required<AiErrorAttachment>();
  readonly allowed = input(true);
  readonly changed = output<AiExecutionError>();
  readonly removed = output<void>();

  protected edit(field: 'sql' | 'message', value: string): void {
    this.changed.emit({ ...this.attachment().error, [field]: value });
  }
}
