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
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  FolderEntry,
  FolderListing,
  FolderTarget,
} from '../../../core/application-gateway/application-gateway';
import { Icon } from '../icon/icon';

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
  imports: [Icon],
  templateUrl: './folder-picker.html',
  styleUrl: './folder-picker.scss',
})
export class FolderPicker implements OnDestroy {
  private readonly _gateway = inject(ApplicationGateway);

  /** Dónde se abre. Sin ella empieza por los sitios conocidos y las unidades. */
  readonly startPath = input<string | null>(null);

  /** Nombre propuesto, que el usuario puede cambiar entero. */
  readonly suggestedName = input('');

  readonly title = input('Elegir dónde guardar');

  /** Cambia según se guarde un archivo o una carpeta con el respaldo dentro. */
  readonly nameLabel = input('Nombre del archivo');

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

  /** En las raíces no se puede guardar: hay que entrar en algún sitio. */
  protected readonly canAccept = computed(() => {
    const target = this.target();

    return (
      this.folder().length > 0 &&
      this.name().trim().length > 0 &&
      target !== null &&
      !target.problem
    );
  });

  protected async open(path: string | null): Promise<void> {
    this.loading.set(true);
    this.creating.set(null);

    try {
      const listing = await firstValueFrom(this._gateway.browseFolders(path ?? undefined));

      this.listing.set(listing);
    } catch {
      // Un fallo al listar no puede dejar el diálogo en blanco: se dice y se
      // deja donde estaba, que es desde donde el usuario puede volver a probar.
      this.listing.set({
        path: path ?? '',
        parent: null,
        separator: '/',
        folders: [],
        canWrite: false,
        error: 'No se pudo leer esa carpeta.',
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

  /** Qué saldría de unir la carpeta actual con el nombre escrito. */
  protected async resolve(): Promise<void> {
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
        problem: 'No se pudo comprobar ese destino.',
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
        problem: `No se pudo crear «${trimmed}» aquí.`,
      });
    }
  }

  protected separator(): string {
    return this.listing()?.separator ?? '/';
  }

  protected accept(): void {
    const target = this.target();

    if (!this.canAccept() || !target) {
      return;
    }

    this.chosen.emit(target.path);
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
