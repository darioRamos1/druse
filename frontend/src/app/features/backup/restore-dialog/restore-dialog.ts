import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { RestoreRequest } from '../../../core/application-gateway/application-gateway';
import { DesktopHost } from '../../../core/application-gateway/desktop-host';
import { RestoreStore, outcomeLabel } from '../../../core/backup/restore.store';
import { ExplorerNode } from '../../../shared/models/workspace';
import { FolderPicker } from '../../../shared/ui/folder-picker/folder-picker';
import { Icon } from '../../../shared/ui/icon/icon';
import { OperationProgress } from '../../../shared/ui/operation-progress/operation-progress';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';

/**
 * Aplica un respaldo sobre la base abierta.
 *
 * Es el asistente de respaldo al revés y con una diferencia que lo gobierna
 * todo: **aquí se escribe**. Por eso son dos pasos y no cuatro —se elige el
 * artefacto y se revisa lo que va a pasar— y por eso el segundo enseña, antes
 * que nada, qué tablas del destino se verían afectadas.
 *
 * Cuando algo falla, la pantalla no se limita a decir que falló: dice en qué
 * instrucción, la enseña entera, y ofrece reanudar desde ahí. Es la única forma
 * de que «se paró a mitad» sea una situación de la que se pueda salir.
 */
@Component({
  selector: 'app-restore-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogFocus, FolderPicker, Icon, OperationProgress],
  templateUrl: './restore-dialog.html',
  styleUrl: './restore-dialog.scss',
})
export class RestoreDialog {
  private readonly _desktop = inject(DesktopHost);

  protected readonly store = inject(RestoreStore);

  /** Base sobre la que se restaura. */
  readonly target = input.required<ExplorerNode>();

  readonly sessionId = input.required<string>();

  readonly closed = output<void>();

  protected readonly path = signal('');

  protected readonly outcomeLabel = outcomeLabel;

  /** Dentro del envoltorio hay diálogos del sistema; fuera, el selector propio. */
  protected readonly canChoose = computed(() => this._desktop.isDesktop);

  /** Si está abierto el selector propio, el del navegador. */
  protected readonly picking = signal(false);

  /** Lo que el artefacto dice de sí mismo, cuando ya se ha mirado. */
  protected readonly inspection = this.store.inspection;

  protected readonly canRestore = computed(() => this.inspection()?.canRestore === true);

  /**
   * Cuántas filas tienen hoy las tablas que se sobrescribirían.
   *
   * Se suma porque es el número que hace pensar: «tres tablas» no asusta y
   * «tres tablas con 40.000 filas» sí, y esa es exactamente la diferencia entre
   * avisar y avisar de verdad.
   */
  protected readonly rowsAtRisk = computed(() =>
    (this.inspection()?.collisions ?? []).reduce(
      (total, collision) => total + (collision.rows ?? 0),
      0,
    ),
  );

  /** Elige el artefacto con el diálogo del sistema. */
  protected async choose(folder: boolean): Promise<void> {
    if (!this._desktop.isDesktop) {
      return;
    }

    const chosen = await this._desktop.chooseRestoreSource(folder);

    if (chosen) {
      await this.use(chosen);
    }
  }

  /**
   * Dónde abrir el selector: la carpeta de lo último que se escribió.
   *
   * Quien vuelve a restaurar suele hacerlo desde el mismo sitio, y empezar otra
   * vez en «Este equipo» obligaría a rehacer el camino entero.
   */
  protected readonly pickerStart = computed(() => {
    const separator = Math.max(this.path().lastIndexOf('/'), this.path().lastIndexOf('\\'));

    return separator > 0 ? this.path().slice(0, separator) : null;
  });

  /** Toma la ruta elegida y la mira en el acto: es lo que se iba a hacer. */
  protected async use(path: string): Promise<void> {
    this.picking.set(false);
    this.path.set(path);

    await this.inspect();
  }

  protected inspect(): Promise<void> {
    return this.store.inspect(this.sessionId(), this.path().trim());
  }

  // --- Dónde se restaura ----------------------------------------------------

  /** `here` es la base abierta; `new` es traerse el respaldo a una que no está. */
  protected readonly destination = signal<'here' | 'new'>('here');

  /** Nombre de la base nueva, propuesto con el que traiga el respaldo. */
  protected readonly newDatabase = signal('');

  constructor() {
    // Al mirar un artefacto se propone el nombre de la base de la que salió:
    // quien copia una base a otro servidor casi siempre la quiere llamar igual.
    effect(() => {
      const source = this.inspection()?.sourceDatabase;

      untracked(() => {
        if (source && this.newDatabase().trim().length === 0) {
          this.newDatabase.set(source);
        }
      });
    });
  }

  /** Si el nombre escrito ya está cogido en este servidor. */
  protected readonly nameTaken = computed(() => {
    const name = this.newDatabase().trim().toLowerCase();

    return (
      name.length > 0 &&
      (this.inspection()?.databases ?? []).some((database) => database.toLowerCase() === name)
    );
  });

  /**
   * Lo que impide lanzar, cuando se ha pedido una base nueva.
   *
   * No se restaura dentro de una base que ya existe: quien pide «tráemela a una
   * base nueva» está copiando, y encontrarse con que ha escrito encima de otra
   * cosa no es un matiz.
   */
  protected readonly destinationProblem = computed(() => {
    if (this.destination() === 'here') {
      return null;
    }

    if (this.newDatabase().trim().length === 0) {
      return 'Escribe el nombre de la base que se va a crear.';
    }

    return this.nameTaken()
      ? `Ya hay una base llamada «${this.newDatabase().trim()}» en este servidor.`
      : null;
  });

  protected readonly canLaunch = computed(
    () => this.canRestore() && this.destinationProblem() === null,
  );

  /** Lo que se manda al proceso local: la base nueva solo si se pidió una. */
  private request(): RestoreRequest {
    return {
      sessionId: this.sessionId(),
      path: this.path().trim(),
      newDatabase: this.destination() === 'new' ? this.newDatabase().trim() : undefined,
    };
  }

  protected run(): Promise<void> {
    return this.store.start(this.request());
  }

  /** Sigue desde donde se paró, sin repetir lo aplicado. */
  protected resume(): Promise<void> {
    return this.store.resume(this.request());
  }

  protected cancel(): Promise<void> {
    return this.store.cancel();
  }

  /** Vuelve a elegir artefacto sin cerrar el diálogo. */
  protected another(): void {
    this.store.dismiss();
    this.store.clear();
    this.path.set('');
  }

  /**
   * Cierra el asistente **sin parar la restauración**.
   *
   * El trabajo sigue en el proceso local, igual que en el respaldo.
   */
  protected close(): void {
    this.closed.emit();
  }

  protected dismiss(): void {
    this.store.dismiss();
    this.closed.emit();
  }

  protected async copyReport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.store.report());
    } catch {
      // Sin portapapeles el texto sigue a la vista para copiarlo a mano.
    }
  }
}
