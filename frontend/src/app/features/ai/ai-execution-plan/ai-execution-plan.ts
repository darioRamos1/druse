import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { AiExecutionPlan, AiPlanAttachment } from '../../../shared/models/ai';

@Component({
  selector: 'app-ai-execution-plan',
  imports: [TranslatePipe],
  templateUrl: './ai-execution-plan.html',
  styleUrl: './ai-execution-plan.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiExecutionPlanEditor {
  readonly attachment = input.required<AiPlanAttachment>();
  readonly allowed = input(true);
  readonly changed = output<AiExecutionPlan>();
  readonly removed = output<void>();

  protected edit(field: 'sql' | 'text', value: string): void {
    this.changed.emit({ ...this.attachment().plan, [field]: value });
  }
}
