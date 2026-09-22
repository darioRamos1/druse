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
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  BackupDataFormat,
  BackupDataMode,
  BackupLayout,
  BackupProfile,
  BackupProfileGap,
  BackupProfileInput,
  BackupRequest,
  BackupSelector,
  BackupTable,
} from '../../../core/application-gateway/application-gateway';
import { DesktopHost } from '../../../core/application-gateway/desktop-host';
import { BackupStore, outcomeLabel } from '../../../core/backup/backup.store';
import { DatabaseObject, ExplorerNode } from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { FolderPicker } from '../../../shared/ui/folder-picker/folder-picker';
import { OperationProgress } from '../../../shared/ui/operation-progress/operation-progress';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';
import { DialogBackdrop } from '../../../shared/a11y/dialog-backdrop';

/** Hasta dónde se baja buscando tablas. Con margen sobre el árbol más hondo. */
const MAX_DEPTH = 6;

/** Los cuatro pasos del asistente, en orden. */
export type BackupStepId = 'what' | 'data' | 'how' | 'review';

/** Una tabla dentro del árbol de selección. */
interface Candidate {
  readonly key: string;
  readonly source: DatabaseObject;
  readonly schema: string;
  readonly rows?: number;
}

/**
 * Arma un respaldo: qué se lleva, con datos o sin ellos, en qué forma y adónde.
 *
 * Cuatro pasos, y **ninguno oculta lo que hará el siguiente**. El de guardar como
 * perfil va al final y no al principio: solo cuando ya está todo elegido se sabe
 * qué se estaría guardando.
 *
 * El caso que justifica la función es «todo sin datos, salvo estas tres tablas»,
 * así que el interruptor general y las anulaciones por tabla conviven en la misma
 * pantalla, y las que se salen de la regla se ven de un vistazo: sin eso, nadie
 * sabe qué va a obtener.
 */
@Component({
  selector: 'app-backup-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogBackdrop, DialogFocus, DatePipe, FolderPicker, Icon, OperationProgress],
  templateUrl: './backup-dialog.html',
  styleUrl: './backup-dialog.scss',
})
export class BackupDialog {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _desktop = inject(DesktopHost);

  protected readonly store = inject(BackupStore);

  /** Nodo desde el que se abrió: una base, un esquema o una tabla. */
  readonly target = input.required<ExplorerNode>();

  readonly sessionId = input.required<string>();

  readonly closed = output<void>();

  protected readonly step = signal<BackupStepId>('what');
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  /** Tablas que se pueden elegir, ya resueltas contra el catálogo. */
  protected readonly candidates = signal<readonly Candidate[]>([]);

  /** Las marcadas. Empieza con todo lo que colgaba del nodo de origen. */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  protected readonly dataMode = signal<BackupDataMode>('StructureAndData');

  /** Las que se salen del interruptor general. */
  protected readonly overrides = signal<ReadonlyMap<string, BackupDataMode>>(new Map());

  protected readonly layout = signal<BackupLayout>('SingleFile');
  protected readonly dataFormat = signal<BackupDataFormat>('Inserts');
  protected readonly compress = signal(false);

  /**
   * Escribir sobre el respaldo anterior de esa carpeta.
   *
   * Solo aparece cuando el destino es una carpeta. Un archivo o un `.zip` se
   * nombran en el diálogo del sistema, que ya pregunta antes de reemplazar; una
   * carpeta no pregunta nada, y por eso el respaldo se rechaza si ya hay uno
   * dentro salvo que se marque esto.
   */
  protected readonly overwrite = signal(false);
  protected readonly destination = signal('');

  protected readonly outcomeLabel = outcomeLabel;

  // --- Perfiles -------------------------------------------------------------

  /** Los guardados, del usado más recientemente al más antiguo. */
  protected readonly profiles = signal<readonly BackupProfile[]>([]);

  /** El que se abrió, para poder guardar encima en vez de duplicarlo. */
  protected readonly activeProfile = signal<BackupProfile | null>(null);

  protected readonly profileName = signal('');

  protected readonly savingProfile = signal(false);

  protected readonly profileError = signal<string | null>(null);

  /** Lo que el perfil pedía y hoy no está. Se enseña hasta que se toca algo. */
  protected readonly gaps = signal<readonly BackupProfileGap[]>([]);

  /** Lo que ha aparecido dentro de un esquema elegido entero. */
  protected readonly added = signal<readonly string[]>([]);

  /**
   * El modo, dicho como en el desplegable que lo eligió.
   *
   * En el resumen salía el nombre del contrato —`StructureAndData`—, que es lo
   * único de la pantalla escrito para el servidor y no para quien lo lee.
   */
  protected modeLabel(mode: BackupDataMode): string {
    switch (mode) {
      case 'StructureOnly':
        return 'Solo estructura';
      case 'DataOnly':
        return 'Solo datos';
      default:
        return 'Estructura y datos';
    }
  }

  constructor() {
    effect(() => {
      const node = this.target();
      const session = this.sessionId();

      void this.load(session, node);
    });

    // Los perfiles no dependen del nodo: se piden una vez al abrir el asistente.
    void this.loadProfiles();
  }

  // --- Paso 1: qué entra ----------------------------------------------------

  /** Esquemas presentes, para poder marcar de golpe. */
  protected readonly schemas = computed(() => [
    ...new Set(this.candidates().map((candidate) => candidate.schema)),
  ]);

  protected tablesOf(schema: string): readonly Candidate[] {
    return this.candidates().filter((candidate) => candidate.schema === schema);
  }

  /**
   * Estado de la casilla de un esquema: marcado, sin marcar o **parcial**.
   *
   * El tercer estado no es un adorno: sin él, un esquema con la mitad de sus
   * tablas marcadas se vería igual que uno vacío.
   */
  protected schemaState(schema: string): 'all' | 'none' | 'some' {
    const tables = this.tablesOf(schema);
    const marked = tables.filter((table) => this.selected().has(table.key)).length;

    if (marked === 0) {
      return 'none';
    }

    return marked === tables.length ? 'all' : 'some';
  }

  protected toggleSchema(schema: string): void {
    const tables = this.tablesOf(schema);
    const next = new Set(this.selected());
    const all = this.schemaState(schema) === 'all';

    for (const table of tables) {
      if (all) {
        next.delete(table.key);
      } else {
        next.add(table.key);
      }
    }

    this.selected.set(next);
  }

  protected toggle(key: string): void {
    const next = new Set(this.selected());

    if (!next.delete(key)) {
      next.add(key);
    }

    this.selected.set(next);
  }

  protected isSelected(key: string): boolean {
    return this.selected().has(key);
  }

  protected readonly selectedCount = computed(() => this.selected().size);

  // --- Paso 2: con datos o sin ellos ---------------------------------------

  /** Lo que se lleva una tabla: su anulación si la tiene, o la regla general. */
  protected modeOf(key: string): BackupDataMode {
    return this.overrides().get(key) ?? this.dataMode();
  }

  protected setMode(key: string, mode: BackupDataMode): void {
    const next = new Map(this.overrides());

    if (mode === this.dataMode()) {
      next.delete(key);
    } else {
      next.set(key, mode);
    }

    this.overrides.set(next);
  }

  /**
   * Las que rompen la regla general.
   *
   * La interfaz las señala porque son justo lo que el usuario no recuerda al
   * revisar: «todo sin datos» con tres excepciones sigue siendo tres excepciones.
   */
  protected readonly exceptions = computed(() =>
    [...this.overrides().entries()]
      .filter(([key, mode]) => this.selected().has(key) && mode !== this.dataMode())
      .map(([key, mode]) => ({ key, mode })),
  );

  protected readonly withData = computed(
    () => this.chosen().filter((table) => this.modeOf(table.key) !== 'StructureOnly').length,
  );

  // --- Paso 3: cómo sale ----------------------------------------------------

  /** Los datos en CSV necesitan carpetas: un archivo suelto no los admite. */
  protected readonly outputValid = computed(
    () => this.dataFormat() !== 'Csv' || this.layout() === 'FolderByKind',
  );

  protected setDataFormat(format: BackupDataFormat): void {
    this.dataFormat.set(format);

    // Elegir CSV implica carpetas. Se cambia en vez de dejar una combinación que
    // el servidor va a rechazar después.
    if (format === 'Csv') {
      this.layout.set('FolderByKind');
    }
  }

  /** Si está abierto el selector de carpetas propio, el del navegador. */
  protected readonly picking = signal(false);

  /**
   * Elige el destino sin escribirlo.
   *
   * En el envoltorio se usa el diálogo del sistema, que es el que el usuario ya
   * conoce. En el navegador no hay ninguno —una página no ve el sistema de
   * archivos—, así que se abre el selector propio, que pregunta las carpetas al
   * proceso local: el mismo que después escribe el archivo.
   */
  protected async choose(): Promise<void> {
    if (!this._desktop.isDesktop) {
      this.picking.set(true);
      return;
    }

    const suggested = this.suggestedName();
    const chosen = this.writesFolder()
      ? await this._desktop.chooseBackupFolder()
      : await this._desktop.chooseBackupFile(suggested);

    if (chosen) {
      this.destination.set(chosen);
    }
  }

  /** Dónde abrir el selector: la carpeta de lo que ya hubiera escrito. */
  protected readonly pickerStart = computed(() => {
    const separator = Math.max(
      this.destination().lastIndexOf('/'),
      this.destination().lastIndexOf('\\'),
    );

    return separator > 0 ? this.destination().slice(0, separator) : null;
  });

  /** Y con qué nombre: el que ya hubiera, o el propuesto. */
  protected readonly pickerName = computed(() => {
    const separator = Math.max(
      this.destination().lastIndexOf('/'),
      this.destination().lastIndexOf('\\'),
    );

    const tail = separator >= 0 ? this.destination().slice(separator + 1) : this.destination();

    return tail.trim().length > 0 ? tail : this.suggestedName();
  });

  /** Si lo que se va a escribir es una carpeta y no un archivo. */
  protected readonly writesFolder = computed(
    () => this.layout() === 'FolderByKind' && !this.compress(),
  );

  /**
   * Un respaldo por carpetas sin comprimir **crea una carpeta**, no un archivo.
   * El nombre es el mismo campo, pero llamarlo igual en los dos casos haría
   * esperar un `.sql` donde va a aparecer un directorio.
   */
  protected readonly pickerLabel = computed(() =>
    this.writesFolder() ? 'picker.folderName' : 'picker.defaultName',
  );

  protected picked(path: string): void {
    this.destination.set(path);
    this.picking.set(false);
  }

  protected readonly suggestedName = computed(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `respaldo-${this.target().source.database ?? 'base'}-${stamp}`;

    // Una carpeta no lleva extensión. Proponer un `.sql` donde va a aparecer un
    // directorio hace esperar un archivo, y quien acepte la propuesta acaba con
    // una carpeta llamada «respaldo-ventas-2026-09-07.sql» dentro.
    if (this.writesFolder()) {
      return base;
    }

    return this.compress() ? `${base}.zip` : `${base}.sql`;
  });

  // --- Paso 4: revisar y lanzar --------------------------------------------

  protected readonly chosen = computed(() =>
    this.candidates().filter((candidate) => this.selected().has(candidate.key)),
  );

  protected readonly request = computed<BackupRequest>(() => ({
    sessionId: this.sessionId(),
    tables: this.chosen().map<BackupTable>((candidate) => ({
      id: candidate.source.id,
      name: candidate.source.name,
      database: candidate.source.database,
      schema: candidate.source.schema,
      approximateRowCount: candidate.rows,
    })),
    dataMode: this.dataMode(),
    dataOverrides: Object.fromEntries(
      [...this.overrides().entries()].filter(([key]) => this.selected().has(key)),
    ),
    layout: this.layout(),
    dataFormat: this.dataFormat(),
    compress: this.compress(),
    overwrite: this.writesFolder() && this.overwrite(),
    destination: this.destination(),
  }));

  protected readonly canRun = computed(
    () => this.selectedCount() > 0 && this.destination().trim().length > 0 && this.outputValid(),
  );

  protected preview(): Promise<void> {
    return this.store.previewBackup(this.request());
  }

  protected async run(): Promise<void> {
    await this.store.start(this.request());

    const profile = this.activeProfile();

    if (profile) {
      // Que se haya lanzado se anota aparte de guardarlo: el perfil no cambia
      // por ejecutarlo, y de esta fecha vive el orden de la lista.
      try {
        await firstValueFrom(this._gateway.markBackupProfileRun(profile.id));
      } catch {
        // Perder la marca no estropea el respaldo, que es lo que importaba.
      }
    }
  }

  protected cancel(): Promise<void> {
    return this.store.cancel();
  }

  /**
   * Cierra el asistente **sin parar el respaldo**.
   *
   * El trabajo sigue en el proceso local y el indicador de la barra de estado lo
   * cuenta: un respaldo de media hora no puede secuestrar la aplicación.
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
      // Sin portapapeles no se puede hacer nada mejor: el texto sigue a la vista
      // para copiarlo a mano.
    }
  }

  protected go(step: BackupStepId): void {
    this.step.set(step);
  }

  // --- Perfiles: abrir, guardar y borrar ------------------------------------

  /**
   * La selección, escrita como el usuario la eligió.
   *
   * Un esquema con **todas** sus tablas marcadas se guarda como el esquema
   * entero, y entonces lo que se cree dentro después también entrará. Es la
   * decisión que separa un perfil de una lista de nombres congelada, y la que
   * hace que «el esquema de ventas» siga queriendo decir lo mismo medio año
   * más tarde.
   */
  protected readonly selectors = computed<readonly BackupSelector[]>(() => {
    const selectors: BackupSelector[] = [];

    for (const schema of this.schemas()) {
      if (this.schemaState(schema) === 'all') {
        selectors.push({ kind: 'Schema', schema });
        continue;
      }

      for (const table of this.tablesOf(schema)) {
        if (this.isSelected(table.key)) {
          selectors.push({ kind: 'Table', schema, name: table.source.name });
        }
      }
    }

    return selectors;
  });

  protected readonly profileInput = computed<BackupProfileInput>(() => ({
    id: this.activeProfile()?.id,
    name: this.profileName().trim(),
    database: this.target().source.database,
    selection: this.selectors(),
    dataMode: this.dataMode(),
    dataOverrides: Object.fromEntries(
      [...this.overrides().entries()].filter(([key]) => this.selected().has(key)),
    ),
    layout: this.layout(),
    dataFormat: this.dataFormat(),
    compress: this.compress(),
    destination: this.destination(),
    // Lo que resuelve hoy, para poder decir mañana qué ha crecido.
    knownTables: this.chosen().map((candidate) => candidate.key),
  }));

  protected readonly canSaveProfile = computed(
    () => this.profileName().trim().length > 0 && this.selectedCount() > 0,
  );

  protected async saveProfile(): Promise<void> {
    if (!this.canSaveProfile()) {
      return;
    }

    this.savingProfile.set(true);
    this.profileError.set(null);

    try {
      const saved = await firstValueFrom(this._gateway.saveBackupProfile(this.profileInput()));

      this.activeProfile.set(saved);
      await this.loadProfiles();
    } catch (error) {
      this.profileError.set(reason(error, 'No se pudo guardar el perfil.'));
    } finally {
      this.savingProfile.set(false);
    }
  }

  /**
   * Guarda una copia con otro nombre, sin tocar el original.
   *
   * Es duplicar: se manda sin identificador, y el proceso local crea uno nuevo.
   */
  protected async duplicateProfile(): Promise<void> {
    const current = this.activeProfile();

    if (!current) {
      return;
    }

    this.activeProfile.set(null);
    this.profileName.set(`${current.name} (copia)`);

    await this.saveProfile();
  }

  protected async deleteProfile(profile: BackupProfile): Promise<void> {
    this.profileError.set(null);

    try {
      await firstValueFrom(this._gateway.deleteBackupProfile(profile.id));

      if (this.activeProfile()?.id === profile.id) {
        this.activeProfile.set(null);
      }

      await this.loadProfiles();
    } catch (error) {
      this.profileError.set(reason(error, 'No se pudo borrar el perfil.'));
    }
  }

  /**
   * Abre un perfil: lo resuelve contra la base de ahora y lo aplica.
   *
   * Los candidatos se **reemplazan** por lo que el perfil resuelve, y no se
   * cruzan con los del nodo desde el que se abrió el asistente: un perfil puede
   * nombrar tablas de otro esquema, y filtrarlas por dónde se hizo clic daría un
   * respaldo distinto del que se guardó sin decirlo.
   */
  protected async openProfile(profile: BackupProfile): Promise<void> {
    this.loading.set(true);
    this.profileError.set(null);
    this.gaps.set([]);
    this.added.set([]);

    try {
      const resolution = await firstValueFrom(
        this._gateway.resolveBackupProfile(profile.id, this.sessionId()),
      );

      const candidates = resolution.tables.map<Candidate>((table) => {
        const source: DatabaseObject = {
          id: table.id,
          name: table.name,
          kind: 'table',
          database: table.database,
          schema: table.schema,
          hasChildren: false,
          approximateRowCount: table.approximateRowCount,
        };

        return {
          key: keyOf(source),
          source,
          schema: table.schema ?? table.database ?? '',
          rows: table.approximateRowCount,
        };
      });

      this.candidates.set(candidates);
      this.selected.set(new Set(candidates.map((candidate) => candidate.key)));

      const saved = resolution.profile;

      this.dataMode.set(saved.dataMode);
      this.overrides.set(
        new Map(Object.entries(saved.dataOverrides ?? {}) as [string, BackupDataMode][]),
      );
      this.layout.set(saved.layout);
      this.dataFormat.set(saved.dataFormat);
      this.compress.set(saved.compress);
      this.destination.set(saved.destination);

      this.activeProfile.set(saved);
      this.profileName.set(saved.name);
      this.gaps.set(resolution.gaps);
      this.added.set(resolution.added);
      this.step.set('what');
    } catch (error) {
      this.profileError.set(reason(error, 'No se pudo abrir el perfil.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadProfiles(): Promise<void> {
    try {
      this.profiles.set(await firstValueFrom(this._gateway.getBackupProfiles()));
    } catch {
      // Sin perfiles la pantalla sigue sirviendo entera: se puede armar un
      // respaldo igual, que es lo que hacía antes de que existieran.
      this.profiles.set([]);
    }
  }

  // --- Carga de candidatos --------------------------------------------------

  /**
   * Resuelve qué tablas cuelgan del nodo desde el que se abrió.
   *
   * Se recorren las carpetas del esquema en lugar de adivinar cuál es la de
   * tablas: el nombre lo pone cada proveedor, y buscar «Tables» funcionaría hasta
   * el primer motor que lo llame de otra forma.
   */
  private async load(sessionId: string, node: ExplorerNode): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);

    try {
      const tables = await this.tablesUnder(sessionId, node.source);

      const candidates = tables.map<Candidate>((table) => ({
        key: keyOf(table),
        source: table,
        schema: table.schema ?? table.database ?? '',
        rows: table.approximateRowCount,
      }));

      this.candidates.set(candidates);
      this.selected.set(new Set(candidates.map((candidate) => candidate.key)));
    } catch (error) {
      this.loadError.set(
        error instanceof Error ? error.message : 'No se pudieron leer las tablas.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async tablesUnder(
    sessionId: string,
    node: DatabaseObject,
    depth = 0,
  ): Promise<readonly DatabaseObject[]> {
    if (node.kind === 'table') {
      return [node];
    }

    // El árbol más hondo es base → esquema → carpeta → tabla. El tope está para
    // que un catálogo que devuelva un hijo igual a su padre no cuelgue la
    // ventana bajando para siempre.
    if (depth >= MAX_DEPTH) {
      return [];
    }

    const children = await this.children(sessionId, node);
    const found: DatabaseObject[] = [];

    for (const child of children) {
      if (child.kind === 'table') {
        found.push(child);
        continue;
      }

      // Carpetas y esquemas se abren; lo demás —vistas, rutinas— no entra
      // todavía: solo se sabe guionizar una tabla.
      if (child.kind === 'folder' || child.kind === 'schema') {
        found.push(...(await this.tablesUnder(sessionId, child, depth + 1)));
      }
    }

    return found;
  }

  private children(sessionId: string, parent: DatabaseObject): Promise<readonly DatabaseObject[]> {
    return new Promise((resolve, reject) => {
      this._gateway.getChildren(sessionId, parent).subscribe({
        next: (nodes) => resolve(nodes),
        error: (error: unknown) => reject(error),
      });
    });
  }
}

/** El mensaje del servidor cuando lo hay, y si no uno que se pueda leer. */
function reason(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const body = (error as { error?: { message?: string } }).error;

    if (body?.message) {
      return body.message;
    }
  }

  return error instanceof Error ? error.message : fallback;
}

/**
 * Nombre con el que una tabla se identifica dentro de la selección.
 *
 * Es el mismo criterio que usa el servidor: el esquema cuando lo hay y, si no, la
 * base. Sin eso, las anulaciones no encontrarían su tabla.
 */
function keyOf(table: DatabaseObject): string {
  const container = table.schema?.trim() ? table.schema : table.database;

  return container ? `${container}.${table.name}` : table.name;
}
