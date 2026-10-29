import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApplicationGateway } from '../application-gateway/application-gateway';
import { I18nService } from '../i18n/i18n.service';
import { describeError } from '../workspace/errors';
import { AiBusinessNote, AiNoteReference, AiSource } from '../../shared/models/ai';
import { DatabaseObject } from '../../shared/models/workspace';
import { AiSelectedTable } from './ai-catalog';

export function matchesNoteReference(reference: AiNoteReference, table: DatabaseObject): boolean {
  return (
    reference.objectId === table.id &&
    reference.schema === (table.schema ?? '') &&
    reference.table === table.name &&
    reference.kind === table.kind
  );
}

/** Una referencia antigua nunca se reasigna por parecido de nombre. */
export function eligibleNotes(
  notes: readonly AiBusinessNote[],
  source: AiSource,
  selected: readonly AiSelectedTable[],
): readonly AiBusinessNote[] {
  return notes.filter(
    (note) =>
      note.formatVersion === 1 &&
      note.enabled &&
      note.connectionId === source.connectionId &&
      note.database === source.database &&
      (!note.reference ||
        selected.some(
          (item) =>
            !!item.detail &&
            !item.error &&
            matchesNoteReference(note.reference!, item.table) &&
            (!note.reference!.column ||
              item.detail.columns.some((column) => column.name === note.reference!.column)),
        )),
  );
}

@Injectable({ providedIn: 'root' })
export class AiNotesStore {
  private readonly gateway = inject(ApplicationGateway);
  private readonly i18n = inject(I18nService);
  private pending: Promise<boolean> | null = null;
  private loaded = false;
  readonly notes = signal<readonly AiBusinessNote[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');

  load(force = false): Promise<boolean> {
    if (this.pending) return this.pending;
    if (this.loaded && !force) return Promise.resolve(true);
    this.loaded = false;
    this.loading.set(true);
    this.error.set('');
    this.pending = (async () => {
      try {
        this.notes.set(await firstValueFrom(this.gateway.getAiNotes()));
        this.loaded = true;
        return true;
      } catch (error) {
        this.error.set(describeError(error, this.i18n));
        return false;
      } finally {
        this.loading.set(false);
        this.pending = null;
      }
    })();
    return this.pending;
  }

  async save(note: AiBusinessNote): Promise<boolean> {
    if (this.saving() || this.loading()) return false;
    this.saving.set(true);
    this.error.set('');
    try {
      const saved = await firstValueFrom(this.gateway.saveAiNote(note));
      this.notes.update((notes) => [saved, ...notes.filter((item) => item.id !== saved.id)]);
      return true;
    } catch (error) {
      this.error.set(describeError(error, this.i18n));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async remove(id: string): Promise<boolean> {
    if (this.saving() || this.loading()) return false;
    this.saving.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.gateway.deleteAiNote(id));
      this.notes.update((notes) => notes.filter((note) => note.id !== id));
      return true;
    } catch (error) {
      this.error.set(describeError(error, this.i18n));
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
