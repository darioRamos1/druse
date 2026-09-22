import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { formatDate, formatNumber } from '../../../core/i18n/locale-format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  FileEntry,
  FolderEntry,
  FolderListing,
  FolderTarget,
} from '../../../core/application-gateway/application-gateway';
import { Icon } from '../icon/icon';

/** Para qué se abre el selector: para guardar algo o para abrir algo que ya está. */
export type FolderPickerMode = 'save' | 'open';

/** Cuánto se espera desde la última tecla antes de preguntar por el nombre. */
const TYPING_PAUSE = 250;

/**
 * Elige una carpeta del equipo y el nombre de lo que se va a escribir en ella.
 *
 * Existe por el navegador: una página no ve el sistema de archivos, así que sin
 * esto la única forma de decir dónde va un respaldo es teclear la ruta entera y
 * acertar a la primera. Las carpetas las enumera el proceso local, que es quien
 * después escribe el archivo, así que **lo que se ve aquí es exactamente lo que
 * él ve**: si una carpeta no aparece, tampoco podría escribir en ella.
 *
 * La carpeta y el nombre van separados a propósito. Son dos decisiones
 * distintas —dónde y cómo se llama— y juntarlas en un único campo de texto es lo
 * que obliga a escribir la ruta a mano.
 */
@Component({
  selector: 'app-folder-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  templateUrl: './folder-picker.html',
  styleUrl: './folder-picker.scss',
})
export class FolderPicker implements OnDestroy {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _i18n = inject(I18nService);

  /**
   * Qué se está haciendo.
   *
   * Al **guardar** se compone una ruta nueva: carpeta más nombre. Al **abrir** se
   * elige algo que ya existe, y entonces no hay nombre que escribir sino
   * archivos que enseñar.
   */
  readonly mode = input<FolderPickerMode>('save');

  /** Extensiones que se enumeran al abrir, sin el punto. */
  readonly extensions = input<readonly string[]>([]);

  /**
   * Archivo que, dentro de una carpeta, la señala como elegible.
   *
   * Un respaldo por carpetas se elige entero, y sin esto habría que entrar en
   * cada carpeta a comprobar si dentro está su manifiesto.
   */
  readonly marker = input('');

  /** Dónde se abre. Sin ella empieza por los sitios conocidos y las unidades. */
  readonly startPath = input<string | null>(null);

  /** Nombre propuesto, que el usuario puede cambiar entero. */
  readonly suggestedName = input('');

  /** Clave del catálogo, no texto: el selector la traduce. */
  readonly title = input('picker.defaultTitle');

  /** Cambia según se guarde un archivo o una carpeta con el respaldo dentro. */
  /** Clave del catálogo, como `title`. */
  readonly nameLabel = input('picker.defaultName');

  /** La ruta completa elegida: carpeta y nombre ya unidos por el proceso local. */
  readonly chosen = output<string>();

  readonly cancelled = output<void>();

  protected readonly listing = signal<FolderListing | null>(null);
  protected readonly loading = signal(false);

  /**
   * El nombre propuesto, hasta que el usuario escriba otro.
   *
   * Va enlazado a la entrada y no copiado en el constructor: allí los inputs
   * todavía no tienen valor, y el campo se quedaba vacío con el nombre sugerido
   * pintado solo como marca de agua.
   */
  protected readonly name = linkedSignal(() => this.suggestedName());

  protected readonly target = signal<FolderTarget | null>(null);

  /** El archivo señalado en la lista, mientras no se acepte. */
  protected readonly selected = signal<FileEntry | null>(null);

  /** Nombre de la carpeta que se está creando, o `null` si no se está creando. */
  protected readonly creating = signal<string | null>(null);

  private _pending: ReturnType<typeof setTimeout> | null = null;

  /** Si ya se abrió la primera carpeta. Después, navegar es cosa del usuario. */
  private _opened = false;

  constructor() {
    // En un efecto y no en el constructor: la carpeta de partida es una entrada,
    // y en el constructor las entradas aún no tienen valor.
    effect(() => {
      const start = this.startPath();

      untracked(() => {
        if (!this._opened) {
          this._opened = true;
          void this.open(start);
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.clearPending();
  }

  /** La carpeta donde se guardaría, o vacío mientras se está en las raíces. */
  protected readonly folder = computed(() => this.listing()?.path ?? '');

  /**
   * Si se puede aceptar lo que hay elegido.
   *
   * Al abrir, hace falta un archivo señalado. Al guardar, una carpeta donde se
   * pueda escribir y un nombre: en las raíces no se puede guardar, hay que
   * entrar en algún sitio.
   */
  protected readonly canAccept = computed(() => {
    if (this.mode() === 'open') {
      return this.selected() !== null;
    }

    const target = this.target();

    return (
      this.folder().length > 0 &&
      this.name().trim().length > 0 &&
      target !== null &&
      !target.problem
    );
  });

  /** Al abrir, la carpeta actual también puede ser la respuesta. */
  protected readonly canUseFolder = computed(
    () => this.mode() === 'open' && this.folder().length > 0,
  );

  protected async open(path: string | null): Promise<void> {
    this.loading.set(true);
    this.creating.set(null);
    this.selected.set(null);

    try {
      const listing = await firstValueFrom(
        this._gateway.browseFolders(path ?? undefined, {
          files: this.extensions(),
          marker: this.marker() || undefined,
        }),
      );

      this.listing.set(listing);
    } catch {
      // Un fallo al listar no puede dejar el diálogo en blanco: se dice y se
      // deja donde estaba, que es desde donde el usuario puede volver a probar.
      this.listing.set({
        path: path ?? '',
        parent: null,
        separator: '/',
        folders: [],
        files: [],
        canWrite: false,
        error: this._i18n.t('picker.readFailed'),
      });
    } finally {
      this.loading.set(false);
    }

    await this.resolve();
  }

  protected enter(folder: FolderEntry): void {
    void this.open(folder.path);
  }

  protected up(): void {
    const listing = this.listing();

    if (!listing) {
      return;
    }

    // Sin padre se sube al nivel de las unidades, que es donde empieza todo.
    void this.open(listing.parent ?? null);
  }

  protected rename(value: string): void {
    this.name.set(value);

    // Se espera a que deje de escribir: preguntar por cada tecla llenaría el
    // registro de peticiones para responder siempre lo mismo.
    this.clearPending();
    this._pending = setTimeout(() => void this.resolve(), TYPING_PAUSE);
  }

  protected select(file: FileEntry): void {
    // Al guardar, pinchar un archivo que ya está **copia su nombre**: es como se
    // sobrescribe el respaldo de la semana pasada sin volver a teclearlo. Que
    // exista ya lo dice el aviso de debajo, así que no hace falta impedirlo.
    if (this.mode() === 'save') {
      this.name.set(file.name);
      void this.resolve();

      return;
    }

    this.selected.set(file);
  }

  /** Un tamaño en bytes, dicho como lo diría una persona. */
  protected sizeLabel(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes / 1024;
    let unit = 0;

    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }

    return this._i18n.t('picker.size', {
      // Un decimal fijo por debajo de 10, como antes con `toFixed`; pero con
      // la coma o el punto del idioma, que `toFixed` ponía siempre en inglés.
      size: formatNumber(size, {
        minimumFractionDigits: size >= 10 ? 0 : 1,
        maximumFractionDigits: size >= 10 ? 0 : 1,
      }),
      unit: units[unit],
    });
  }

  /**
   * La fecha del archivo en el idioma elegido.
   *
   * Con el `date` de Angular salía siempre en `en-US`, que es su idioma por
   * omisión, fuera cual fuera el de la interfaz.
   */
  protected fileDate(value: string): string {
    return formatDate(value, { dateStyle: 'short', timeStyle: 'short' });
  }

  /** Qué saldría de unir la carpeta actual con el nombre escrito. */
  protected async resolve(): Promise<void> {
    // Al abrir no hay nada que componer: lo que se elige ya existe.
    if (this.mode() === 'open') {
      return;
    }

    const folder = this.folder();
    const name = this.name().trim();

    if (!folder || !name) {
      this.target.set(null);
      return;
    }

    try {
      this.target.set(await firstValueFrom(this._gateway.resolveFolderTarget(folder, name)));
    } catch {
      this.target.set({
        path: name,
        canWrite: false,
        exists: false,
        problem: this._i18n.t('picker.checkFailed'),
      });
    }
  }

  protected startCreating(): void {
    this.creating.set('');
  }

  protected async create(name: string): Promise<void> {
    const parent = this.folder();
    const trimmed = name.trim();

    if (!parent || !trimmed) {
      this.creating.set(null);
      return;
    }

    try {
      await firstValueFrom(this._gateway.createFolder(parent, trimmed));

      // Se entra en la carpeta recién creada: es lo que se quería al crearla.
      await this.open(`${parent}${this.separator()}${trimmed}`);
    } catch {
      this.creating.set(null);
      this.target.set({
        path: parent,
        canWrite: false,
        exists: false,
        problem: this._i18n.t('picker.createFailed', { name: trimmed }),
      });
    }
  }

  protected separator(): string {
    return this.listing()?.separator ?? '/';
  }

  protected accept(): void {
    if (!this.canAccept()) {
      return;
    }

    if (this.mode() === 'open') {
      const file = this.selected();

      if (file) {
        this.chosen.emit(file.path);
      }

      return;
    }

    const target = this.target();

    if (target) {
      this.chosen.emit(target.path);
    }
  }

  /** Elige la carpeta en la que se está, que es como se abre un respaldo por carpetas. */
  protected useFolder(): void {
    if (this.canUseFolder()) {
      this.chosen.emit(this.folder());
    }
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  private clearPending(): void {
    if (this._pending !== null) {
      clearTimeout(this._pending);
      this._pending = null;
    }
  }
}
