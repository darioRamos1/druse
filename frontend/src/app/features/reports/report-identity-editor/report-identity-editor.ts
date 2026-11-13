import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatNumber } from '../../../core/i18n/locale-format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { describeError } from '../../../core/workspace/errors';
import { ReportIdentity } from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { logoUrl, prepareLogo } from '../report-identity-logo';
import {
  GRAPHIC_CONTRAST,
  IDENTITY_LIMITS,
  checkBrand,
  cleanDetails,
  identityProblem,
  normalizeHex,
} from '../report-identity-model';

/** El logo tal como queda al guardar: el de siempre, uno nuevo o ninguno. */
type LogoChange =
  | { readonly kind: 'keep' }
  | { readonly kind: 'set'; readonly data: string; readonly contentType: string }
  | { readonly kind: 'remove' };

/**
 * Edita la identidad de una empresa: nombre, datos, color de marca y logo.
 *
 * Enseña cómo quedará el encabezado en claro y en oscuro mientras se edita: un
 * logo negro sin fondo o un color de marca muy claro solo se descubren al
 * verlos sobre el otro tema. Nada se guarda hasta pulsar Guardar; el logo
 * tampoco, para que una identidad nueva no deje uno huérfano si se descarta.
 */
@Component({
  selector: 'app-report-identity-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  templateUrl: './report-identity-editor.html',
  styleUrl: './report-identity-editor.scss',
})
export class ReportIdentityEditor {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _i18n = inject(I18nService);

  readonly identity = input.required<ReportIdentity>();

  readonly saved = output<ReportIdentity>();
  readonly deleted = output<string>();
  readonly dirtyChange = output<boolean>();

  protected readonly limits = IDENTITY_LIMITS;
  protected readonly detailPlaceholders = [
    'reports.identity.detailPlaceholder1',
    'reports.identity.detailPlaceholder2',
    'reports.identity.detailPlaceholder3',
  ];
  protected readonly graphicContrast = GRAPHIC_CONTRAST;

  protected readonly draft = signal<ReportIdentity>(this.blank());
  private readonly _base = signal<ReportIdentity>(this.blank());

  /** Las tres líneas de datos, con sus huecos: se limpian al guardar. */
  protected readonly lines = signal<readonly string[]>(['', '', '']);

  /** El logo guardado, para enseñarlo. */
  private readonly _storedLogo = signal<string | null>(null);
  protected readonly logoChange = signal<LogoChange>({ kind: 'keep' });
  protected readonly logoProblem = signal<string | null>(null);
  protected readonly logoBusy = signal(false);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  /** Lo que el color escrito en el campo dice ser, antes de normalizarlo. */
  protected readonly colorText = signal('');

  /** Lo que se ve: el logo nuevo, el guardado o ninguno. */
  protected readonly logo = computed(() => {
    const change = this.logoChange();
    if (change.kind === 'set') return logoUrl(change);
    if (change.kind === 'remove') return null;
    return this._storedLogo();
  });

  protected readonly brand = computed(() => {
    const color = normalizeHex(this.draft().brandColor);
    return color ? checkBrand(color) : null;
  });

  protected readonly problem = computed(() =>
    identityProblem({ ...this.draft(), details: cleanDetails(this.lines()) }),
  );

  protected readonly isNew = computed(() => !this.identity().createdAtUtc);

  protected readonly dirty = computed(() => {
    const draft = { ...this.draft(), details: cleanDetails(this.lines()) };
    const base = this._base();

    return (
      this.logoChange().kind !== 'keep' ||
      draft.name.trim() !== base.name ||
      (draft.subtitle ?? '').trim() !== (base.subtitle ?? '') ||
      (draft.footer ?? '').trim() !== (base.footer ?? '') ||
      normalizeHex(draft.brandColor) !== base.brandColor ||
      draft.logoOnWhite !== base.logoOnWhite ||
      draft.details.join('\n') !== base.details.join('\n')
    );
  });

  private readonly reportDirty = effect(() => this.dirtyChange.emit(this.dirty()));

  /** De qué identidad es lo que hay en el formulario. */
  private _loadedId: string | null = null;

  /**
   * Al cambiar de identidad, el formulario y su logo vuelven a empezar.
   *
   * Solo al cambiar de identidad: al guardar, el constructor devuelve la misma
   * ya guardada, y empezar de nuevo borraría el aviso de que se guardó.
   */
  private readonly loadIdentity = effect(() => {
    const identity = this.identity();
    if (identity.id !== this._loadedId) {
      this._loadedId = identity.id;
      this.reset(identity);
    }
  });

  private reset(identity: ReportIdentity): void {
    this.draft.set(identity);
    this._base.set(identity);
    this.lines.set([0, 1, 2].map((index) => identity.details[index] ?? ''));
    this.colorText.set(identity.brandColor ?? '');
    this.logoChange.set({ kind: 'keep' });
    this.logoProblem.set(null);
    this.error.set(null);
    this.notice.set(null);
    this.confirmingDelete.set(false);
    this._storedLogo.set(null);

    if (identity.logoUpdatedAtUtc) {
      void this.loadLogo(identity.id);
    }
  }

  private async loadLogo(id: string): Promise<void> {
    try {
      const logo = await firstValueFrom(this._gateway.getReportIdentityLogo(id));
      // Puede haberse elegido otra identidad mientras llegaba.
      if (this.identity().id === id) {
        this._storedLogo.set(logoUrl(logo));
      }
    } catch {
      // Sin logo a la vista: se puede volver a subir.
    }
  }

  private blank(): ReportIdentity {
    return {
      id: '',
      name: '',
      subtitle: null,
      details: [],
      footer: null,
      brandColor: null,
      logoOnWhite: false,
    };
  }

  protected patch(patch: Partial<ReportIdentity>): void {
    this.draft.update((draft) => ({ ...draft, ...patch }));
    this.notice.set(null);
  }

  protected setLine(index: number, value: string): void {
    this.lines.update((lines) => lines.map((line, i) => (i === index ? value : line)));
    this.notice.set(null);
  }

  /** El campo de texto acepta `0a6cbf` o `#abc`; el color solo cambia si se entiende. */
  protected typeColor(text: string): void {
    this.colorText.set(text);
    const color = normalizeHex(text);
    if (color || text.trim() === '') {
      this.patch({ brandColor: color });
    }
  }

  protected pickColor(value: string): void {
    const color = normalizeHex(value);
    this.colorText.set(color ?? '');
    this.patch({ brandColor: color });
  }

  protected clearColor(): void {
    this.colorText.set('');
    this.patch({ brandColor: null });
  }

  protected readonly colorInvalid = computed(
    () => this.colorText().trim() !== '' && normalizeHex(this.colorText()) === null,
  );

  protected ratio(value: number): string {
    return formatNumber(Math.round(value * 10) / 10);
  }

  // --- Logo ------------------------------------------------------------------

  protected async chooseLogo(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';

    if (!file) {
      return;
    }

    this.logoBusy.set(true);
    this.logoProblem.set(null);

    try {
      const prepared = await prepareLogo(file);

      if (prepared.ok) {
        this.logoChange.set({
          kind: 'set',
          data: prepared.data,
          contentType: prepared.contentType,
        });
      } else {
        this.logoProblem.set(prepared.problem);
      }
    } finally {
      this.logoBusy.set(false);
    }
  }

  protected removeLogo(): void {
    this.logoChange.set(this._storedLogo() ? { kind: 'remove' } : { kind: 'keep' });
    this.logoProblem.set(null);
  }

  // --- Guardar y borrar ------------------------------------------------------

  protected async save(): Promise<void> {
    if (this.problem() || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const draft = this.draft();
    const change = this.logoChange();

    try {
      let saved = await firstValueFrom(
        this._gateway.saveReportIdentity({
          ...draft,
          name: draft.name.trim(),
          subtitle: draft.subtitle?.trim() || null,
          footer: draft.footer?.trim() || null,
          brandColor: normalizeHex(draft.brandColor),
          details: cleanDetails(this.lines()),
        }),
      );

      if (change.kind === 'set') {
        await firstValueFrom(
          this._gateway.saveReportIdentityLogo(saved.id, {
            contentType: change.contentType,
            data: change.data,
          }),
        );
        saved = { ...saved, logoUpdatedAtUtc: new Date().toISOString() };
      } else if (change.kind === 'remove') {
        await firstValueFrom(this._gateway.deleteReportIdentityLogo(saved.id));
        saved = { ...saved, logoUpdatedAtUtc: null };
      }

      const shown = this.logo();
      this.draft.set(saved);
      this._base.set(saved);
      this.lines.set([0, 1, 2].map((index) => saved.details[index] ?? ''));
      this.colorText.set(saved.brandColor ?? '');
      this.logoChange.set({ kind: 'keep' });
      this._storedLogo.set(shown);
      this.notice.set(this._i18n.t('reports.identity.saved'));
      this.saved.emit(saved);
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const identity = this.identity();
    this.confirmingDelete.set(false);

    if (this.isNew()) {
      this.deleted.emit(identity.id);
      return;
    }

    try {
      await firstValueFrom(this._gateway.deleteReportIdentity(identity.id));
      this.deleted.emit(identity.id);
    } catch (error) {
      this.error.set(describeError(error, this._i18n));
    }
  }

  /** Lo que se enseña en la vista previa mientras se escribe. */
  protected readonly preview = computed(() => ({
    name: this.draft().name.trim() || this._i18n.t('reports.identity.namePlaceholder'),
    subtitle: this.draft().subtitle?.trim() ?? '',
    details: cleanDetails(this.lines()),
  }));
}
