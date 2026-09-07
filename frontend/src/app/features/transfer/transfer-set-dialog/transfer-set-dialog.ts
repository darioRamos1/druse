import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  TransferMode,
  TransferProfile,
  TransferProfileGap,
  TransferRequest,
  TransferSetOrder,
  TransferSetRequest,
  TransferTable,
  TransferTableOptions,
} from '../../../core/application-gateway/application-gateway';
import { TransferStore } from '../../../core/transfer/transfer.store';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject } from '../../../shared/models/workspace';
import { OperationProgress } from '../../../shared/ui/operation-progress/operation-progress';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';

type Step = 'tables' | 'target' | 'plan' | 'running';

/** Una tabla del origen y la del destino que le toca, si la hay. */
interface Pair {
  readonly source: DatabaseObject;
  readonly target: DatabaseObject | null;
}

/**
 * Migrar **varias tablas** de un sitio a otro, en una pasada.
 *
 * Es el hermano del asistente de una tabla, y existe aparte a propósito: aquí el
 * destino no es una tabla sino **el sitio donde viven las tablas**, y cada tabla
 * del origen se empareja con la que se llama igual al otro lado. Meter los dos
 * flujos en la misma pantalla obligaría a preguntar en cada paso cuál de los dos
 * se está haciendo.
 *
 * Lo que aporta sobre copiar seis veces a mano es el **orden**: las padres antes
 * que las hijas, con las claves foráneas del destino. Se enseña antes de escribir
 * nada, junto con los ciclos, que no se resuelven sino que se avisan.
 */
@Component({
  selector: 'app-transfer-set-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogFocus, FormsModule, OperationProgress],
  templateUrl: './transfer-set-dialog.html',
  styleUrl: './transfer-set-dialog.scss',
})
export class TransferSetDialog {
  private readonly _workspace = inject(WorkspaceStore);
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _transfers = inject(TransferStore);

  /** Nodo del que salen las tablas: un esquema o la carpeta que las agrupa. */
  readonly node = input.required<DatabaseObject>();

  readonly connectionId = input.required<string>();

  readonly closed = output<void>();

  protected readonly step = signal<Step>('tables');

  // --- Origen ---------------------------------------------------------------

  protected readonly sourceTables = signal<readonly DatabaseObject[]>([]);

  /** Identificadores de las marcadas. Empiezan todas. */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  protected readonly loadingSource = signal(false);

  // --- Destino --------------------------------------------------------------

  protected readonly targetConnectionId = signal<string>('');

  protected readonly nodes = signal<readonly DatabaseObject[]>([]);

  protected readonly trail = signal<readonly DatabaseObject[]>([]);

  protected readonly browsing = signal(false);

  /** Sitio elegido en el destino, y lo que hay dentro. */
  protected readonly targetFolder = signal<DatabaseObject | null>(null);

  protected readonly targetTables = signal<readonly DatabaseObject[]>([]);

  // --- Cómo se copia --------------------------------------------------------

  protected readonly mode = signal<TransferMode>('Insert');

  protected readonly batchSize = signal(1000);

  protected readonly atomic = signal(false);

  protected readonly keepIdentity = signal(true);

  protected readonly ordered = signal(true);

  /**
   * Lo que cada tabla hace distinto, por su nombre.
   *
   * Migrar seis tablas no significa tratarlas igual: de una se lleva el año en
   * curso y de otra todo, y una se actualiza mientras las demás se añaden. Lo que
   * no esté aquí sigue el modo de la pasada.
   */
  protected readonly tableOptions = signal<Readonly<Record<string, TransferTableOptions>>>({});

  protected readonly order = signal<TransferSetOrder | null>(null);

  protected readonly planning = signal(false);

  protected readonly localError = signal<string | null>(null);

  // --- Migraciones guardadas ------------------------------------------------

  protected readonly profiles = signal<readonly TransferProfile[]>([]);

  /** Perfil abierto o guardado, para poder actualizarlo en vez de duplicarlo. */
  protected readonly profileId = signal<string | null>(null);

  protected readonly profileName = signal('');

  /** Lo que el perfil pedía y hoy no se puede migrar. */
  protected readonly profileGaps = signal<readonly TransferProfileGap[]>([]);

  protected readonly savingProfile = signal(false);

  // --- Lo que viene del proceso local ---------------------------------------

  protected readonly progress = this._transfers.progress;
  protected readonly running = this._transfers.running;
  protected readonly finished = this._transfers.finished;
  protected readonly stepLabel = this._transfers.stepLabel;
  protected readonly overall = this._transfers.overall;
  protected readonly tables = this._transfers.tables;
  protected readonly report = this._transfers.report;

  protected readonly error = computed(() => this.localError() ?? this._transfers.error());

  protected readonly connections = computed(() =>
    this._workspace.connections().filter((connection) => connection.sessionId),
  );

  /**
   * Los modos que se ofrecen aquí.
   *
   * **Vaciar y cargar no está**: el proceso local exige escribir el nombre de
   * cada tabla que se vacía, y con seis marcadas eso son seis confirmaciones que
   * no caben en una casilla. Se hace tabla a tabla, que es donde esa confirmación
   * significa algo.
   */
  protected readonly modes: readonly { readonly id: TransferMode; readonly label: string }[] = [
    { id: 'Insert', label: 'Añadir las filas' },
    { id: 'Upsert', label: 'Actualizar la que ya está' },
    { id: 'SkipExisting', label: 'Omitir las que ya están' },
  ];

  protected readonly sourceName = computed(() => qualify(this.node()));

  protected readonly targetName = computed(() => {
    const folder = this.targetFolder();

    return folder ? qualify(folder) : '';
  });

  /** Las marcadas, con la tabla del destino que les toca. */
  protected readonly pairs = computed<readonly Pair[]>(() => {
    const chosen = this.selected();
    const destino = this.targetTables();

    return this.sourceTables()
      .filter((table) => chosen.has(table.id))
      .map((table) => ({
        source: table,
        target:
          destino.find(
            (candidate) => candidate.name.toLowerCase() === table.name.toLowerCase(),
          ) ?? null,
      }));
  });

  /** Las que sí se van a copiar. */
  protected readonly ready = computed(() => this.pairs().filter((pair) => pair.target !== null));

  /**
   * Las que no están al otro lado.
   *
   * No se crean: crear una tabla es una decisión con tipos y clave primaria, y se
   * toma de una en una en el asistente de una tabla. Aquí se dicen y se quedan
   * fuera, que es mejor que una pasada que parece completa y no lo es.
   */
  protected readonly missing = computed(() => this.pairs().filter((pair) => pair.target === null));

  /** Las que faltan, nombradas: un número suelto no dice cuáles revisar. */
  protected readonly missingNames = computed(() =>
    this.missing()
      .map((pair) => pair.source.name)
      .join(', '),
  );

  protected readonly canRun = computed(() => this.ready().length > 0 && !this.planning());

  constructor() {
    queueMicrotask(() => {
      if (!this.targetConnectionId()) {
        this.targetConnectionId.set(this.connectionId());
      }

      void this.loadSource();
      void this.loadProfiles();
    });
  }

  // --- Qué tablas se llevan -------------------------------------------------

  /** Las tablas que cuelgan del nodo, marcadas todas: es lo que se venía a hacer. */
  private async loadSource(): Promise<void> {
    const sessionId = this._workspace.sessionForConnection(this.connectionId());

    if (!sessionId) {
      return;
    }

    this.loadingSource.set(true);
    this.localError.set(null);

    try {
      const children = await firstValueFrom(this._gateway.getChildren(sessionId, this.node()));
      const tables = children.filter((child) => child.kind === 'table');

      this.sourceTables.set(tables);
      this.selected.set(new Set(tables.map((table) => table.id)));
    } catch (error) {
      this.localError.set(describe(error));
    } finally {
      this.loadingSource.set(false);
    }
  }

  /**
   * Marca o desmarca una tabla **según cómo quedó la casilla**, no alternando.
   *
   * Alternar da por hecho que a cada clic le corresponde un cambio, y no siempre
   * es así: un mismo clic puede llegar dos veces —la casilla y su etiqueta— y
   * entonces la marca se pone y se quita sin que nadie lo vea. Tomando el estado
   * del evento, repetirlo no cambia nada.
   */
  protected setSelected(table: DatabaseObject, selected: boolean): void {
    const chosen = new Set(this.selected());

    if (selected) {
      chosen.add(table.id);
    } else {
      chosen.delete(table.id);
    }

    this.selected.set(chosen);
  }

  protected isSelected(table: DatabaseObject): boolean {
    return this.selected().has(table.id);
  }

  protected all(): void {
    this.selected.set(new Set(this.sourceTables().map((table) => table.id)));
  }

  protected none(): void {
    this.selected.set(new Set());
  }

  protected async toTarget(): Promise<void> {
    this.step.set('target');
    await this.browseRoot();
  }

  // --- A dónde van ----------------------------------------------------------

  protected async onTargetConnection(connectionId: string): Promise<void> {
    this.targetConnectionId.set(connectionId);
    this.targetFolder.set(null);
    await this.browseRoot();
  }

  protected async browseRoot(): Promise<void> {
    const sessionId = this.targetSessionId();

    if (!sessionId) {
      return;
    }

    this.trail.set([]);
    await this.load(() => firstValueFrom(this._gateway.getDatabases(sessionId)));
  }

  /**
   * Baja un nivel.
   *
   * Las tablas no se abren: aquí lo que se elige es **dónde** van, y el nombre de
   * cada una lo pone la del origen.
   */
  protected async open(node: DatabaseObject): Promise<void> {
    if (node.kind === 'table') {
      return;
    }

    const sessionId = this.targetSessionId();

    if (!sessionId) {
      return;
    }

    this.trail.set([...this.trail(), node]);
    await this.load(() => firstValueFrom(this._gateway.getChildren(sessionId, node)));
  }

  protected async back(index?: number): Promise<void> {
    const trail = this.trail();

    if (index === undefined || index < 0) {
      await this.browseRoot();

      return;
    }

    const sessionId = this.targetSessionId();
    const node = trail[index];

    if (!sessionId || !node) {
      return;
    }

    this.trail.set(trail.slice(0, index + 1));
    await this.load(() => firstValueFrom(this._gateway.getChildren(sessionId, node)));
  }

  /** El sitio donde se está mirando, si sirve para recibir tablas. */
  protected readonly here = computed(() => this.trail().at(-1) ?? null);

  /**
   * Elige el sitio donde se está mirando y arma el plan.
   *
   * Lo que hay en pantalla ya son sus hijos, así que emparejar no cuesta otra
   * consulta: las tablas del destino son las que se están viendo.
   */
  protected async chooseHere(): Promise<void> {
    const folder = this.here();

    if (!folder) {
      return;
    }

    this.targetFolder.set(folder);
    this.targetTables.set(this.nodes().filter((node) => node.kind === 'table'));
    this.step.set('plan');

    await this.plan();
  }

  // --- El plan --------------------------------------------------------------

  /**
   * Pregunta en qué orden irían las tablas.
   *
   * Es lo que hace que una pasada de tablas relacionadas funcione, así que se
   * enseña **antes** de escribir nada. Sin ordenar no se pregunta: el orden es el
   * de la lista.
   */
  protected async plan(): Promise<void> {
    const request = this.request(false);

    if (!request || !this.ordered()) {
      this.order.set(null);

      return;
    }

    this.planning.set(true);

    try {
      this.order.set(await this._transfers.orderSet(request));
    } finally {
      this.planning.set(false);
    }
  }

  /** El modo con el que va esta tabla: el suyo, o el de la pasada. */
  protected modeOf(table: string): TransferMode {
    return this.tableOptions()[table]?.mode ?? this.mode();
  }

  protected whereOf(table: string): string {
    return this.tableOptions()[table]?.where ?? '';
  }

  /** Cuántas tablas llevan algo distinto, para poder decirlo sin abrir la lista. */
  protected readonly tweaked = computed(
    () =>
      Object.values(this.tableOptions()).filter(
        (options) =>
          options.mode !== undefined ||
          (options.where ?? '') !== '' ||
          (options.keyColumns ?? []).length > 0,
      ).length,
  );

  protected setTableMode(table: string, mode: string): void {
    // El propio modo de la pasada se guarda como «sin nada distinto»: así, cambiar
    // el general después sigue arrastrando a las tablas que nadie tocó.
    this.setTableOptions(table, {
      mode: mode === this.mode() ? undefined : (mode as TransferMode),
    });
  }

  /** La clave escrita para esta tabla, tal y como se lee en la pantalla. */
  protected keyOf(table: string): string {
    return (this.tableOptions()[table]?.keyColumns ?? []).join(', ');
  }

  /** Los modos que tienen que reconocer la fila que ya está. */
  protected needsKey(table: string): boolean {
    const mode = this.modeOf(table);

    return mode === 'Upsert' || mode === 'SkipExisting';
  }

  protected setTableKey(table: string, columns: string): void {
    const names = columns
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');

    this.setTableOptions(table, { keyColumns: names.length === 0 ? undefined : names });
  }

  protected setTableWhere(table: string, where: string): void {
    this.setTableOptions(table, { where: where.trim() === '' ? undefined : where });
  }

  private setTableOptions(table: string, patch: Partial<TransferTableOptions>): void {
    const current = this.tableOptions();
    const merged: TransferTableOptions = { ...current[table], ...patch };
    const next = { ...current };

    if (
      merged.mode === undefined &&
      (merged.where ?? '') === '' &&
      (merged.keyColumns ?? []).length === 0
    ) {
      delete next[table];
    } else {
      next[table] = merged;
    }

    this.tableOptions.set(next);
  }

  protected async onOrdered(ordered: boolean): Promise<void> {
    this.ordered.set(ordered);
    await this.plan();
  }

  protected onMode(mode: string): void {
    this.mode.set(mode as TransferMode);
  }

  // --- Migraciones guardadas ------------------------------------------------

  private async loadProfiles(): Promise<void> {
    try {
      this.profiles.set(await firstValueFrom(this._gateway.getTransferProfiles()));
    } catch {
      // Sin la lista se sigue trabajando: los perfiles son una comodidad, no un
      // requisito para migrar.
    }
  }

  /**
   * Abre un perfil: lo resuelve contra las conexiones vivas y salta al plan.
   *
   * No hay que volver a elegir nada porque el perfil ya lo dice; lo único que
   * puede haber cambiado son las bases, y de eso habla la lista de huecos.
   */
  protected async openProfile(profile: TransferProfile): Promise<void> {
    const sourceSession = this._workspace.sessionForConnection(this.connectionId());
    const target = profile.targetConnectionId ?? this.targetConnectionId() ?? this.connectionId();
    const targetSession = this._workspace.sessionForConnection(target);

    if (!profile.id || !sourceSession || !targetSession) {
      this.localError.set(
        'Para abrir un perfil hacen falta abiertas las dos conexiones que nombra.',
      );

      return;
    }

    this.localError.set(null);

    try {
      const resolution = await firstValueFrom(
        this._gateway.resolveTransferProfile(profile.id, sourceSession, targetSession),
      );

      this.targetConnectionId.set(target);
      this.sourceTables.set(resolution.tables.map((pair) => asObject(pair.source)));
      this.targetTables.set(resolution.tables.map((pair) => asObject(pair.target)));
      this.selected.set(new Set(resolution.tables.map((pair) => pair.source.id)));
      this.targetFolder.set(place(profile.targetSchema, profile.targetDatabase));
      this.profileGaps.set(resolution.gaps);

      this.mode.set(profile.mode);
      this.tableOptions.set(profile.tableOptions ?? {});
      this.ordered.set(profile.ordered);
      this.atomic.set(profile.atomic);
      this.keepIdentity.set(profile.keepIdentity);
      this.batchSize.set(profile.batchSize);

      this.profileId.set(profile.id);
      this.profileName.set(profile.name);
      this.step.set('plan');

      await this.plan();
    } catch (error) {
      this.localError.set(describe(error));
    }
  }

  /**
   * Guarda lo que hay en pantalla como perfil.
   *
   * Con un perfil abierto lo actualiza; si no, crea uno. Se guardan **nombres**
   * —conexión, base, esquema y tablas—, nunca las sesiones: esto se reabre meses
   * después, cuando aquellas ya no existen.
   */
  protected async saveProfile(): Promise<void> {
    const name = this.profileName().trim();
    const folder = this.targetFolder();

    if (!name || this.ready().length === 0) {
      return;
    }

    this.savingProfile.set(true);
    this.localError.set(null);

    try {
      const saved = await firstValueFrom(
        this._gateway.saveTransferProfile({
          id: this.profileId() ?? undefined,
          name,
          sourceConnectionId: this.connectionId(),
          sourceDatabase: this.node().database,
          sourceSchema: this.node().schema,
          targetConnectionId: this.targetConnectionId(),
          targetDatabase: folder?.database,
          targetSchema: folder?.schema ?? folder?.name,
          tables: this.ready().map((pair) => pair.source.name),
          mode: this.mode(),
          tableOptions: this.tableOptions(),
          ordered: this.ordered(),
          atomic: this.atomic(),
          keepIdentity: this.keepIdentity(),
          batchSize: this.batchSize(),
        }),
      );

      this.profileId.set(saved.id ?? null);
      await this.loadProfiles();
    } catch (error) {
      this.localError.set(describe(error));
    } finally {
      this.savingProfile.set(false);
    }
  }

  protected async deleteProfile(profile: TransferProfile): Promise<void> {
    if (!profile.id) {
      return;
    }

    try {
      await firstValueFrom(this._gateway.deleteTransferProfile(profile.id));

      if (this.profileId() === profile.id) {
        this.profileId.set(null);
      }

      await this.loadProfiles();
    } catch (error) {
      this.localError.set(describe(error));
    }
  }

  // --- Ejecutar -------------------------------------------------------------

  protected async run(): Promise<void> {
    const request = this.request(true);

    if (!request) {
      return;
    }

    this.step.set('running');
    await this._transfers.startSet(request);

    const profile = this.profileId();

    if (profile) {
      try {
        // Se anota aparte de guardar, porque lanzarlo no lo modifica.
        await firstValueFrom(this._gateway.markTransferProfileRun(profile));
      } catch {
        // Que no se pueda anotar no estropea la pasada, que ya está corriendo.
      }
    }
  }

  protected async cancel(): Promise<void> {
    await this._transfers.cancel();
  }

  protected close(): void {
    // La pasada en marcha **no se para al cerrar**: sigue en el proceso local, y
    // cerrar la ventana no puede deshacer filas que ya están en la otra base.
    this.closed.emit();
  }

  protected dismiss(): void {
    this._transfers.dismiss();
    this.closed.emit();
  }

  private request(confirmed: boolean): TransferSetRequest | null {
    const sourceSession = this._workspace.sessionForConnection(this.connectionId());
    const targetSession = this.targetSessionId();
    const pairs = this.ready();

    if (!sourceSession || !targetSession || pairs.length === 0) {
      return null;
    }

    const tables: TransferRequest[] = pairs.map((pair) => {
      const where = this.whereOf(pair.source.name);

      return {
        sourceSessionId: sourceSession,
        source: toTable(pair.source),
        targetSessionId: targetSession,
        target: toTable(pair.target!),
        filter: where ? { where } : undefined,
        mode: this.modeOf(pair.source.name),
        keyColumns: this.tableOptions()[pair.source.name]?.keyColumns ?? [],
        atomic: this.atomic(),
        batchSize: this.batchSize(),
        keepIdentity: this.keepIdentity(),
        confirmed,
      };
    });

    return { tables, ordered: this.ordered() };
  }

  private async load(fetch: () => Promise<readonly DatabaseObject[]>): Promise<void> {
    this.browsing.set(true);
    this.localError.set(null);

    try {
      this.nodes.set(await fetch());
    } catch (error) {
      this.nodes.set([]);
      this.localError.set(describe(error));
    } finally {
      this.browsing.set(false);
    }
  }

  private targetSessionId(): string | null {
    return this._workspace.sessionForConnection(this.targetConnectionId());
  }
}

function toTable(object: DatabaseObject): TransferTable {
  return {
    id: object.id,
    name: object.name,
    database: object.database,
    schema: object.schema,
    approximateRowCount: object.approximateRowCount,
  };
}

/** La tabla que devuelve el perfil, en la forma que usa el explorador. */
function asObject(table: TransferTable): DatabaseObject {
  return {
    id: table.id,
    name: table.name,
    kind: 'table',
    database: table.database,
    schema: table.schema,
    hasChildren: false,
    approximateRowCount: table.approximateRowCount,
  };
}

/** El sitio que nombra un perfil, solo para poder enseñarlo en pantalla. */
function place(schema: string | undefined, database: string | undefined): DatabaseObject {
  return {
    id: `Folder:${database ?? ''}.${schema ?? ''}`,
    name: schema ?? database ?? '',
    kind: 'folder',
    database,
    schema,
    hasChildren: true,
  };
}

function qualify(object: DatabaseObject): string {
  return object.schema ? `${object.schema}.${object.name}` : object.name;
}

function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const body = (error as { error?: { message?: string } }).error;

    if (body?.message) {
      return body.message;
    }
  }

  return error instanceof Error ? error.message : 'No se pudo hablar con el proceso local.';
}
