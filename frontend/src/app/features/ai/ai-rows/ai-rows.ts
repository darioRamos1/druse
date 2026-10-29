import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  AiRowsRequest,
  AiRowsSelection,
  AiColumnMode,
  AI_ROW_LIMIT,
  AI_COLUMN_LIMIT,
  selectRows,
} from '../../../core/ai/ai-rows';
import { AiRowsAttachment } from '../../../shared/models/ai';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

@Component({
  selector: 'app-ai-rows',
  imports: [TranslatePipe],
  templateUrl: './ai-rows.html',
  styleUrl: './ai-rows.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiRows {
  readonly request = input.required<AiRowsRequest>();
  readonly allowed = input(false);
  readonly initialSelection = input<AiRowsSelection | null>(null);
  readonly changed = output<AiRowsAttachment | null>();
  readonly selectionChanged = output<AiRowsSelection>();
  readonly removed = output<void>();
  protected readonly indices = signal<readonly number[]>([]);
  protected readonly modes = signal<readonly AiColumnMode[]>([]);
  protected readonly page = signal(0);
  protected readonly accepted = signal(false);
  protected readonly rowLimit = AI_ROW_LIMIT;
  protected readonly columnLimit = AI_COLUMN_LIMIT;
  protected readonly selectedColumns = computed(
    () => this.modes().filter((mode) => mode !== 'exclude').length,
  );
  protected readonly sample = computed(() =>
    selectRows(this.request(), this.indices(), this.modes(), this.accepted()),
  );
  protected readonly hasTruncation = computed(
    () =>
      this.sample()?.rows.some((row) => row.cells.some((cell) => cell.kind === 'truncated')) ??
      false,
  );
  protected readonly sampleBytes = computed(
    () => new TextEncoder().encode(JSON.stringify(this.sample() ?? {})).length,
  );
  protected readonly pages = computed(() =>
    Math.max(1, Math.ceil(this.request().resultSet.rows.length / 10)),
  );
  protected readonly visibleRows = computed(() =>
    this.request().resultSet.rows.slice(this.page() * 10, this.page() * 10 + 10),
  );
  protected readonly previewColumns = computed(() => {
    const all = this.request().resultSet.columns.map((column, index) => ({ ...column, index }));
    return (
      this.selectedColumns()
        ? all.filter((column) => this.modes()[column.index] !== 'exclude')
        : all
    ).slice(0, 3);
  });

  constructor() {
    effect(() => {
      const request = this.request();
      untracked(() => {
        const saved = this.initialSelection();
        this.indices.set(saved ? [...saved.indices] : []);
        this.modes.set(saved ? [...saved.modes] : request.resultSet.columns.map(() => 'exclude'));
        this.page.set(saved?.page ?? 0);
        this.accepted.set(saved?.accepted ?? false);
      });
    });
    effect(() =>
      this.changed.emit(this.hasTruncation() && !this.accepted() ? null : this.sample()),
    );
    effect(() =>
      this.selectionChanged.emit({
        indices: [...this.indices()],
        modes: [...this.modes()],
        accepted: this.accepted(),
        page: this.page(),
      }),
    );
  }

  protected toggleRow(index: number): void {
    this.accepted.set(false);
    this.indices.update((indices) =>
      indices.includes(index)
        ? indices.filter((item) => item !== index)
        : indices.length < AI_ROW_LIMIT
          ? [...indices, index]
          : indices,
    );
  }

  protected columnMode(index: number, mode: AiColumnMode): void {
    this.accepted.set(false);
    this.modes.update((modes) =>
      modes.map((current, ordinal) => (ordinal === index ? mode : current)),
    );
  }

  protected previewValue(index: number, column: number): { key?: string; text?: string } {
    if (this.modes()[column] === 'mask') return { key: 'ai.rows.masked' };
    if (this.request().resultSet.columns[column].kind === 'binary')
      return { key: 'ai.rows.binary' };
    const value = this.request().resultSet.rows[index].values[column];
    if (value == null) return { key: 'ai.rows.null' };
    if (value === '') return { key: 'ai.rows.empty' };
    return { text: value.slice(0, 96) + (value.length > 96 ? '…' : '') };
  }
}
