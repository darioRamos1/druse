import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { AiNotesStore, eligibleNotes, matchesNoteReference } from '../../../core/ai/ai-notes-store';
import { AiCatalog } from '../../../core/ai/ai-catalog';
import { AiStore } from '../../../core/ai/ai-store';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { formatDate } from '../../../core/i18n/locale-format';
import { describeError } from '../../../core/workspace/errors';
import { AiBusinessNote, AiNoteReference, AiSource } from '../../../shared/models/ai';
import { qualifiedName } from '../../../core/ai/ai-context';

@Component({
  selector: 'app-ai-notes',
  imports: [TranslatePipe],
  templateUrl: './ai-notes.html',
  styleUrl: './ai-notes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiNotes {
  readonly source = input.required<AiSource>();
  readonly saved = input(false);
  readonly includeTables = input(true);
  readonly connectionIds = input<readonly string[]>([]);
  protected readonly store = inject(AiNotesStore);
  protected readonly catalog = inject(AiCatalog);
  protected readonly ai = inject(AiStore);
  private readonly i18n = inject(I18nService);
  protected readonly all = signal(false);
  protected readonly editing = signal<AiBusinessNote | null>(null);
  protected readonly text = signal('');
  protected readonly target = signal('base');
  protected readonly enabled = signal(true);
  protected readonly permissionBusy = signal(false);
  protected readonly permissionError = signal('');
  protected readonly formatTimestamp = (value: string) =>
    formatDate(value, { dateStyle: 'short', timeStyle: 'short' });
  protected readonly visible = computed(() =>
    this.store
      .notes()
      .filter(
        (note) =>
          this.all() ||
          (note.connectionId === this.source().connectionId &&
            note.database === this.source().database),
      ),
  );
  protected readonly targets = computed(() =>
    this.catalog.selected().flatMap((item) => {
      const reference: AiNoteReference = {
        objectId: item.table.id,
        schema: item.table.schema ?? '',
        table: item.table.name,
        kind: item.table.kind as 'table' | 'view',
      };
      const name = qualifiedName(item.table);
      return [
        { value: JSON.stringify(reference), label: name },
        ...(item.detail?.columns ?? []).map((column) => ({
          value: JSON.stringify({ ...reference, column: column.name }),
          label: `${name}.${column.name}`,
        })),
      ];
    }),
  );
  private readonly scope = computed(() =>
    JSON.stringify([this.source().connectionId, this.source().database]),
  );

  constructor() {
    void this.store.load();
    effect(() => {
      this.scope();
      // Cambiar de base descarta el formulario, para no guardar un borrador en otra conexión.
      this.reset();
      untracked(() => void this.catalog.loadCatalog());
    });
  }

  protected reset(): void {
    this.editing.set(null);
    this.text.set('');
    this.enabled.set(true);
    this.target.set('base');
  }

  protected edit(note: AiBusinessNote): void {
    this.editing.set(note);
    this.text.set(note.text);
    this.enabled.set(note.enabled);
    this.target.set('original');
  }

  protected label(note: AiBusinessNote): string {
    const ref = note.reference;
    const connection =
      note.connectionId === this.source().connectionId
        ? this.source().connectionName
        : note.connectionId;
    return `${connection} · ${note.database} · ${ref ? [ref.schema, ref.table, ref.column].filter(Boolean).join('.') : this.i18n.t('ai.notes.base')}`;
  }

  protected status(note: AiBusinessNote): string {
    if (note.formatVersion !== 1) return 'ai.notes.futureFormat';
    if (!this.connectionIds().includes(note.connectionId)) return 'ai.notes.missingConnection';
    if (
      note.connectionId !== this.source().connectionId ||
      note.database !== this.source().database
    )
      return 'ai.notes.unverified';
    if (!note.reference) return 'ai.notes.available';
    const selected = this.catalog
      .selected()
      .find((item) => matchesNoteReference(note.reference!, item.table));
    if (selected?.detail && !selected.error) {
      return !note.reference.column ||
        selected.detail.columns.some((column) => column.name === note.reference!.column)
        ? 'ai.notes.available'
        : 'ai.notes.missingColumn';
    }
    if (
      this.catalog.catalogComplete() &&
      !this.catalog.catalog().some((table) => matchesNoteReference(note.reference!, table))
    )
      return 'ai.notes.missingObject';
    return 'ai.notes.unverified';
  }

  protected included(note: AiBusinessNote): boolean {
    return (
      this.saved() &&
      !!this.ai.active()?.shareBusinessNotes &&
      this.ai.active()?.disclosure !== 'nothing' &&
      eligibleNotes([note], this.source(), this.includeTables() ? this.catalog.selected() : [])
        .length > 0
    );
  }

  protected async save(): Promise<void> {
    const original = this.editing();
    const keep = this.target() === 'original' && original;
    if ((!keep && !this.saved()) || !this.text().trim()) return;
    const note: AiBusinessNote = {
      id: original?.id ?? crypto.randomUUID(),
      connectionId: keep ? original.connectionId : this.source().connectionId,
      database: keep ? original.database : this.source().database,
      text: this.text(),
      enabled: this.enabled(),
      reference: keep
        ? original.reference
        : this.target() === 'base'
          ? null
          : JSON.parse(this.target()),
      updatedAtUtc: original?.updatedAtUtc ?? new Date().toISOString(),
      formatVersion: 1,
    };
    if (await this.store.save(note)) this.reset();
  }

  protected async sharing(enabled: boolean): Promise<void> {
    const provider = this.ai.active();
    if (!provider || this.permissionBusy()) return;
    this.permissionBusy.set(true);
    this.permissionError.set('');
    try {
      await this.ai.setNotesSharing(provider.id, enabled);
    } catch (error) {
      this.permissionError.set(describeError(error, this.i18n));
    } finally {
      this.permissionBusy.set(false);
    }
  }
}
