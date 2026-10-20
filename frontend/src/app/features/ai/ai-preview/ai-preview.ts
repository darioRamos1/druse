import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  afterNextRender,
  inject,
  ElementRef,
} from '@angular/core';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { AiChatRequestSnapshot } from '../../../core/ai/ai-store';
import { AiChatPreview } from '../../../shared/models/ai';

@Component({
  selector: 'app-ai-preview',
  imports: [TranslatePipe],
  templateUrl: './ai-preview.html',
  styleUrl: './ai-preview.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiPreview {
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => host.nativeElement.querySelector<HTMLElement>('h3')?.focus());
  }
  readonly request = input.required<AiChatRequestSnapshot>();
  readonly preview = input.required<AiChatPreview>();
  readonly historyLimit = input<number | null>(null);
  readonly omitted = input<readonly { index: number; text: string }[]>([]);
  readonly disabled = input(false);
  readonly confirmed = output<void>();
  readonly back = output<void>();
  readonly restarted = output<void>();
  readonly historyChanged = output<number | null>();
  protected readonly historyChoices = [0, 1, 3, 5, 10, 20];
  protected readonly sections = [
    'sql',
    'schema',
    'notes',
    'error',
    'rows',
    'context',
    'history',
    'input',
    'question',
  ] as const;
  protected readonly sectionKeys: Record<string, string> = {
    sql: 'ai.preview.section.sql',
    schema: 'ai.preview.section.schema',
    notes: 'ai.preview.section.notes',
    error: 'ai.preview.section.error',
    rows: 'ai.preview.section.rows',
    context: 'ai.preview.section.context',
    history: 'ai.preview.section.history',
    input: 'ai.preview.section.input',
    question: 'ai.preview.section.question',
  };
  protected readonly issueKeys: Record<string, string> = {
    sql: 'ai.preview.issue.sql',
    schema: 'ai.preview.issue.schema',
    notes: 'ai.preview.issue.notes',
    error: 'ai.preview.issue.error',
    rows: 'ai.preview.issue.rows',
    context: 'ai.preview.issue.context',
    history: 'ai.preview.issue.history',
    input: 'ai.preview.issue.input',
    question: 'ai.preview.issue.question',
    turns: 'ai.preview.issue.turns',
    budget: 'ai.preview.issue.budget',
    request: 'ai.preview.issue.request',
  };
  protected size(section: (typeof this.sections)[number]): number {
    return this.preview().usage[`${section}Bytes`];
  }
  protected maximum(section: (typeof this.sections)[number]): number {
    const limits = this.preview().limits;
    return {
      sql: limits.maxSqlBytes,
      schema: limits.maxSchemaBytes,
      notes: limits.maxNotesBytes,
      error: limits.maxErrorBytes,
      rows: limits.maxRowsBytes,
      context: limits.maxContextBytes,
      history: limits.maxHistoryBytes,
      input: limits.maxInputBytes,
      question: limits.maxQuestionBytes,
    }[section];
  }
}
