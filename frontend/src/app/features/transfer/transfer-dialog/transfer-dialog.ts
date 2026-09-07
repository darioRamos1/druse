import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  ColumnMapping,
  TransferMode,
  TransferRequest,
  TransferTable,
  TypeTranslation,
} from '../../../core/application-gateway/application-gateway';
import { TransferStore } from '../../../core/transfer/transfer.store';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseColumn, DatabaseObject } from '../../../shared/models/workspace';
import { OperationProgress } from '../../../shared/ui/operation-progress/operation-progress';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';
import { DialogBackdrop } from '../../../shared/a11y/dialog-backdrop';

/** En qué pantalla del asistente estamos. */
type Step = 'target' | 'types' | 'columns' | 'running';

/**
 * Copiar las filas de una tabla a otra.
 *
 * El asistente va en tres pantallas y **no se puede saltar de la primera a la
 * última**: elegir la tabla de destino, decir qué columna va a cuál, y ver qué
 * va a pasar antes de escribir. Esa última pantalla es la razón de ser de la
 * función: un traslado mal emparejado no falla, funciona, y deja los datos en la
 * columna equivocada de otra base.
 *
 * La tabla de origen no se elige aquí: llega de donde se abrió el asistente, que
 * es el menú de una tabla del explorador.
 */
@Component({
  selector: 'app-transfer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogBackdrop, DialogFocus, FormsModule, OperationProgress],
  templateUrl: './transfer-dialog.html',
  styleUrl: './transfer-dialog.scss',
})
export class TransferDialog {
  private readonly _workspace = inject(WorkspaceStore);
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _transfers = inject(TransferStore);

  /** Tabla de origen, la que el usuario eligió en el explorador. */
  readonly table = input.required<DatabaseObject>();

  /** Conexión desde la que se abrió. */
  readonly connectionId = input.required<string>();

  readonly closed = output<void>();

  protected readonly step = signal<Step>('target');

  // --- Destino --------------------------------------------------------------

  protected readonly targetConnectionId = signal<string>('');

  /** Nodos que se están enseñando ahora en el navegador de destino. */
  protected readonly nodes = signal<readonly DatabaseObject[]>([]);

  /** Por dónde se ha bajado, para poder volver. */
  protected readonly trail = signal<readonly DatabaseObject[]>([]);

  protected readonly browsing = signal(false);

  protected readonly target = signal<DatabaseObject | null>(null);

  // --- Crear la tabla de destino --------------------------------------------

  /** Nombre que se le va a poner a la tabla nueva. */
  protected readonly newTableName = signal('');

  /** Qué tipo tendría cada columna al otro lado. Vacío dentro del mismo motor. */
  protected readonly translations = signal<readonly TypeTranslation[]>([]);

  /** Tipos que el usuario cambió a mano, por columna del origen. */
  protected readonly typeOverrides = signal<Readonly<Record<string, string>>>({});

  protected readonly creating = signal(false);

  // --- Columnas y opciones --------------------------------------------------

  protected readonly sourceColumns = signal<readonly DatabaseColumn[]>([]);
  protected readonly targetColumns = signal<readonly DatabaseColumn[]>([]);

  /** Qué columna del destino recibe cada columna del origen. */
  protected readonly mappings = signal<readonly ColumnMapping[]>([]);

  protected readonly mode = signal<TransferMode>('Insert');

  /**
   * Columnas del destino que identifican una fila.
   *
   * Vacío significa «la clave primaria del destino», que es lo que se quiere casi
   * siempre. Se puede cambiar porque sincronizar dos entornos suele hacerse por
   * una clave de negocio —el código del artículo, el NIT— y no por el
   * identificador que generó cada base por su cuenta.
   */
  protected readonly keyColumns = signal<readonly string[]>([]);
  protected readonly where = signal('');
  protected readonly batchSize = signal(1000);
  protected readonly atomic = signal(false);
  protected readonly keepIdentity = signal(true);
  protected readonly replaceConfirmation = signal('');

  /**
   * Columnas que no tienen dónde ir en el motor de destino **y siguen así**.
   *
   * Una a la que se le escribe un tipo a mano deja de contar: es lo que el aviso
   * pide hacer, y el proceso local ya la acepta —el tipo escrito gana al
   * propuesto—. Sin esto, la pantalla mandaba escribir un tipo y luego no dejaba
   * crear la tabla igualmente.
   */
  protected readonly untranslatable = computed(() =>
    this.translations().filter(
      (translation) =>
        translation.fidelity === 'None' &&
        (this.typeOverrides()[translation.column] ?? '').trim() === '',
    ),
  );

  /** Lo que se pierde al cruzar de motor: es lo que hay que leer antes de crear. */
  protected readonly losses = computed(() =>
    this.translations().filter((translation) => translation.fidelity !== 'Exact'),
  );

  protected readonly loadingColumns = signal(false);
  protected readonly localError = signal<string | null>(null);

  // --- Lo que viene del proceso local ---------------------------------------

  protected readonly preview = this._transfers.preview;
  protected readonly previewing = this._transfers.previewing;
  protected readonly progress = this._transfers.progress;
  protected readonly running = this._transfers.running;
  protected readonly finished = this._transfers.finished;
  protected readonly stepLabel = this._transfers.stepLabel;
  protected readonly overall = this._transfers.overall;
  protected readonly report = this._transfers.report;

  protected readonly error = computed(() => this.localError() ?? this._transfers.error());

  /** Conexiones abiertas: son los destinos posibles. */
  protected readonly connections = computed(() =>
    this._workspace.connections().filter((connection) => connection.sessionId),
  );

  protected readonly sourceName = computed(() => qualify(this.table()));

  protected readonly targetName = computed(() => {
    const target = this.target();

    return target ? qualify(target) : '';
  });

  /** Columnas que no van a ninguna parte: se dicen, no se esconden. */
  protected readonly ignored = computed(() =>
    this.mappings()
      .filter((mapping) => !mapping.target)
      .map((mapping) => mapping.source),
  );

  protected readonly mapped = computed(
    () => this.mappings().filter((mapping) => mapping.target).length,
  );

  /** Vaciar el destino exige escribir su nombre, y aquí se comprueba antes de ir. */
  protected readonly replaceReady = computed(() => {
    if (this.mode() !== 'Replace') {
      return true;
    }

    const target = this.target();

    return (
      target !== null &&
      this.replaceConfirmation().trim().toLowerCase() === target.name.toLowerCase()
    );
  });

  /** Los modos que tienen que reconocer la fila que ya está. */
  protected readonly needsKey = computed(
    () => this.mode() === 'Upsert' || this.mode() === 'SkipExisting',
  );

  /**
   * La clave que se va a usar: la elegida, o la primaria del destino.
   *
   * Se enseña resuelta para que en la pantalla se lea lo que de verdad va a
   * pasar, y no un hueco vacío que en realidad significa algo.
   */
  protected readonly effectiveKey = computed(() => {
    const chosen = this.keyColumns();

    return chosen.length > 0
      ? chosen
      : this.targetColumns()
          .filter((column) => column.isPrimaryKey)
          .map((column) => column.name);
  });

  protected readonly canRun = computed(
    () =>
      this.mapped() > 0 &&
      this.replaceReady() &&
      !this.previewing() &&
      (!this.needsKey() || this.effectiveKey().length > 0),
  );

  constructor() {
    // El destino empieza en la conexión de origen: copiar entre dos esquemas de
    // la misma es tan común como copiar entre dos servidores.
    queueMicrotask(() => {
      if (!this.targetConnectionId()) {
        this.targetConnectionId.set(this.connectionId());
        void this.browseRoot();
      }
    });
  }

  // --- Navegar hasta la tabla de destino ------------------------------------

  protected async onTargetConnection(connectionId: string): Promise<void> {
    this.targetConnectionId.set(connectionId);
    this.target.set(null);
    await this.browseRoot();
  }

  /** Empieza por las bases de la conexión elegida. */
  protected async browseRoot(): Promise<void> {
    const sessionId = this.targetSessionId();

    if (!sessionId) {
      return;
    }

    this.trail.set([]);
    await this.load(() => firstValueFrom(this._gateway.getDatabases(sessionId)));
  }

  /**
   * Baja un nivel, o elige la tabla si lo que se pulsó es una.
   *
   * El recorrido es genérico —bases, carpetas, esquemas, tablas— porque cada
   * motor organiza su catálogo a su manera y el asistente no tiene por qué
   * saberlo: pregunta por los hijos y enseña lo que venga.
   */
  protected async open(node: DatabaseObject): Promise<void> {
    if (node.kind === 'table') {
      this.target.set(node);
      await this.loadColumns(node);

      return;
    }

    const sessionId = this.targetSessionId();

    if (!sessionId) {
      return;
    }

    this.trail.set([...this.trail(), node]);
    await this.load(() => firstValueFrom(this._gateway.getChildren(sessionId, node)));
  }

  /** Vuelve a un punto del camino. Sin índice, a la raíz. */
  protected async back(index?: number): Promise<void> {
    const trail = this.trail();

    if (index === undefined || index < 0) {
      await this.browseRoot();

      return;
    }

    const parent = trail[index];

    this.trail.set(trail.slice(0, index + 1));

    const sessionId = this.targetSessionId();

    if (sessionId) {
      await this.load(() => firstValueFrom(this._gateway.getChildren(sessionId, parent)));
    }
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

  /**
   * Prepara la creación de una tabla nueva en el sitio donde se está mirando.
   *
   * Antes de crear nada se pide la traducción de los tipos: entre motores
   * distintos es lo único que dice qué deja de ser cierto al otro lado, y esa
   * pregunta se hace **antes** de que la tabla exista.
   */
  protected async prepareNewTable(): Promise<void> {
    const name = this.newTableName().trim();
    const sourceSession = this._workspace.sessionForConnection(this.connectionId());
    const targetSession = this.targetSessionId();

    if (!name || !sourceSession || !targetSession) {
      return;
    }

    this.target.set(this.plannedTarget(name));
    this.loadingColumns.set(true);
    this.localError.set(null);

    try {
      const request = this.request(false);

      if (request) {
        this.translations.set(await firstValueFrom(this._gateway.translateTransferTypes(request)));
      }

      this.step.set('types');
    } catch (error) {
      this.target.set(null);
      this.localError.set(describe(error));
    } finally {
      this.loadingColumns.set(false);
    }
  }

  protected setType(column: string, dataType: string): void {
    this.typeOverrides.set({ ...this.typeOverrides(), [column]: dataType });
  }

  protected typeOf(translation: TypeTranslation): string {
    return this.typeOverrides()[translation.column] ?? translation.targetType;
  }

  /** Crea la tabla y sigue por donde seguiría cualquier otro destino. */
  protected async createTarget(): Promise<void> {
    const request = this.request(false);
    const target = this.target();

    if (!request || !target) {
      return;
    }

    this.creating.set(true);
    this.localError.set(null);

    try {
      await firstValueFrom(this._gateway.createTransferTarget(request));
      await this.loadColumns(target);
    } catch (error) {
      this.localError.set(describe(error));
    } finally {
      this.creating.set(false);
    }
  }

  /**
   * La tabla que se va a crear, colocada donde se esté mirando.
   *
   * La base y el esquema salen del camino recorrido y no de la conexión: dentro
   * de una conexión hay varias bases, y crear en la que no era es de los errores
   * que no se ven hasta que alguien busca la tabla donde debería estar.
   */
  private plannedTarget(name: string): DatabaseObject {
    const trail = this.trail();
    const database = trail.find((node) => node.kind === 'database');
    const schema = trail.find((node) => node.kind === 'schema');

    return {
      id: `Table:${schema?.name ?? ''}.${name}`,
      name,
      kind: 'table',
      database: database?.name ?? schema?.database,
      schema: schema?.name,
      hasChildren: false,
    };
  }

  /**
   * Trae las columnas de los dos lados y las empareja por nombre.
   *
   * Se emparejan aquí igual que las emparejaría el proceso local si no se dijera
   * nada, pero **se enseñan** para poder cambiarlas: es la pantalla donde se
   * evita meter teléfonos en la columna del código postal.
   */
  private async loadColumns(target: DatabaseObject): Promise<void> {
    const sourceSession = this._workspace.sessionForConnection(this.connectionId());
    const targetSession = this.targetSessionId();

    if (!sourceSession || !targetSession) {
      return;
    }

    this.loadingColumns.set(true);
    this.localError.set(null);

    try {
      const [source, destination] = await Promise.all([
        firstValueFrom(this._gateway.getColumns(sourceSession, this.table())),
        firstValueFrom(this._gateway.getColumns(targetSession, target)),
      ]);

      this.sourceColumns.set(source);
      this.targetColumns.set(destination);
      this.mappings.set(match(source, destination));
      this.step.set('columns');
    } catch (error) {
      this.localError.set(describe(error));
    } finally {
      this.loadingColumns.set(false);
    }
  }

  // --- Columnas -------------------------------------------------------------

  protected setTarget(source: string, target: string): void {
    this._transfers.clearPreview();

    this.mappings.set(
      this.mappings().map((mapping) =>
        mapping.source === source ? { source, target: target || null } : mapping,
      ),
    );
  }

  protected targetOf(source: string): string {
    return this.mappings().find((mapping) => mapping.source === source)?.target ?? '';
  }

  /** Una columna del destino ya ocupada por otra: el proceso local lo rechazaría. */
  protected taken(source: string, candidate: string): boolean {
    return this.mappings().some(
      (mapping) => mapping.source !== source && mapping.target === candidate,
    );
  }

  protected onModeChange(mode: string): void {
    this.mode.set(mode as TransferMode);
    this.replaceConfirmation.set('');
    this.keyColumns.set([]);
    this._transfers.clearPreview();
  }

  protected toggleKey(column: string): void {
    const chosen = this.keyColumns();

    this.keyColumns.set(
      chosen.includes(column) ? chosen.filter((name) => name !== column) : [...chosen, column],
    );

    this._transfers.clearPreview();
  }

  protected isKey(column: string): boolean {
    return this.effectiveKey().includes(column);
  }

  // --- Ejecutar -------------------------------------------------------------

  protected async analyze(): Promise<void> {
    const request = this.request(false);

    if (request) {
      await this._transfers.previewTransfer(request);
    }
  }

  protected async run(): Promise<void> {
    const request = this.request(true);

    if (!request) {
      return;
    }

    this.step.set('running');
    await this._transfers.start(request);
  }

  protected async cancel(): Promise<void> {
    await this._transfers.cancel();
  }

  protected close(): void {
    // El traslado en marcha **no se para al cerrar**: sigue en el proceso local
    // y el resumen espera a que se vuelva. Cerrar la ventana no puede deshacer
    // filas que ya están en la otra base.
    this._transfers.clearPreview();
    this.closed.emit();
  }

  protected dismiss(): void {
    this._transfers.dismiss();
    this.closed.emit();
  }

  private request(confirmed: boolean): TransferRequest | null {
    const target = this.target();
    const sourceSession = this._workspace.sessionForConnection(this.connectionId());
    const targetSession = this.targetSessionId();

    if (!target || !sourceSession || !targetSession) {
      return null;
    }

    const where = this.where().trim();

    return {
      sourceSessionId: sourceSession,
      source: toTable(this.table()),
      targetSessionId: targetSession,
      target: toTable(target),
      filter: where ? { where } : undefined,
      mappings: this.mappings(),
      mode: this.mode(),
      keyColumns: this.needsKey() ? this.keyColumns() : [],
      typeOverrides: this.typeOverrides(),
      atomic: this.atomic(),
      batchSize: this.batchSize(),
      keepIdentity: this.keepIdentity(),
      confirmed,
      replaceConfirmation:
        this.mode() === 'Replace' ? this.replaceConfirmation().trim() : undefined,
    };
  }

  private targetSessionId(): string | null {
    return this._workspace.sessionForConnection(this.targetConnectionId());
  }
}

/**
 * Empareja columnas por nombre sin distinguir mayúsculas.
 *
 * Lo que no case se queda sin destino en lugar de colocarse por posición: es la
 * misma regla que aplica el proceso local, y por el mismo motivo.
 */
function match(
  source: readonly DatabaseColumn[],
  target: readonly DatabaseColumn[],
): ColumnMapping[] {
  return source.map((column) => ({
    source: column.name,
    target:
      target.find((candidate) => candidate.name.toLowerCase() === column.name.toLowerCase())
        ?.name ?? null,
  }));
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
