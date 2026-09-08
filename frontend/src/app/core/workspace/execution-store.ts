import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  ExecuteQueryRequest,
  ExportFormat,
  QueryRejected,
} from '../application-gateway/application-gateway';
import { QueryResult, ResultSet } from '../../shared/models/workspace';

/**
 * De dónde salió lo que hay en la cuadrícula.
 *
 * No es información de adorno: es lo que permite retirar el resultado cuando
 * cambia la pestaña, la base o la conexión. Unas filas de desarrollo bajo una
 * barra que ya dice «preproducción» son la clase de detalle que lleva a tomar
 * una decisión al revés.
 */
export interface DisplayedResultSource {
  readonly tabId: string | null;
  readonly connectionId: string;
  readonly database?: string;
  readonly sql: string;
  readonly title: string;
}

/**
 * La operación exacta que el servidor no ejecutó y espera confirmación.
 *
 * Lleva la pestaña y la conexión de las que salió porque confirmar es repetirla
 * tal cual: si mientras tanto se cambió de sitio, lo que se confirmaría no sería
 * lo que se vio.
 */
export interface PendingRejection {
  readonly value: QueryRejected;
  readonly operation: 'execute' | 'export';
  readonly tabId: string;
  readonly connectionId: string;
  readonly sql: string;
  readonly format?: ExportFormat;
}

/**
 * Lo que se está ejecutando y lo que hay en pantalla.
 *
 * Salió de `WorkspaceStore` con el plan de mejoras (FE-001/FE-002) y cierra la
 * lista: era el último bloque grande. Guarda el resultado, de dónde vino, si hay
 * algo corriendo, si se pidió pararlo y qué operación quedó a la espera de
 * confirmarse.
 *
 * Lo que **no** hace es decidir sobre qué conexión se ejecuta ni si la pestaña
 * sigue siendo la misma cuando la respuesta llega: eso lo sabe el área de
 * trabajo, y es ella quien llama a {@link show} solo si lo que vuelve todavía
 * corresponde a lo que el usuario tiene delante.
 */
@Injectable({ providedIn: 'root' })
export class ExecutionStore {
  private readonly _gateway = inject(ApplicationGateway);

  private readonly _result = signal<QueryResult | null>(null);

  readonly result = this._result.asReadonly();

  /** Primer conjunto de resultados, que es el que muestra la cuadrícula. */
  readonly resultSet = computed<ResultSet | null>(() => this._result()?.resultSets[0] ?? null);

  private readonly _source = signal<DisplayedResultSource | null>(null);

  readonly source = this._source.asReadonly();

  private readonly _running = signal(false);

  readonly running = this._running.asReadonly();

  /** Ya se pidió detener la ejecución y se espera la confirmación del motor. */
  private readonly _canceling = signal(false);

  readonly canceling = this._canceling.asReadonly();

  private readonly _currentExecutionId = signal<string | null>(null);

  /** Rechazo ligado a la operación exacta que el servidor no ejecutó. */
  private readonly _pendingRejection = signal<PendingRejection | null>(null);

  readonly rejection = computed(() => this._pendingRejection()?.value ?? null);

  /**
   * Ejecuta y devuelve lo que responda la API.
   *
   * El identificador se genera aquí y viaja con la petición: cancelar exige
   * conocerlo **mientras** la consulta corre, y si lo pusiera el servidor solo
   * llegaría con la respuesta, cuando ya no hay nada que cancelar.
   *
   * Lanza lo que falle. Quien llama es quien sabe distinguir una sesión perdida
   * de un 409 que pide confirmación, y quién tiene que enterarse de cada cosa.
   */
  async run(request: Omit<ExecuteQueryRequest, 'executionId'>): Promise<QueryResult> {
    this._running.set(true);
    this._canceling.set(false);
    this._pendingRejection.set(null);

    const executionId = crypto.randomUUID();
    this._currentExecutionId.set(executionId);

    try {
      return await firstValueFrom(this._gateway.executeQuery({ ...request, executionId }));
    } finally {
      this._running.set(false);
      this._canceling.set(false);
      this._currentExecutionId.set(null);
    }
  }

  /** Pone en pantalla un resultado y de dónde salió. */
  show(result: QueryResult, source: DisplayedResultSource): void {
    this._result.set(result);
    this._source.set(source);
  }

  /**
   * Retira lo que hay en pantalla.
   *
   * Se llama al cambiar de pestaña, de base o de conexión: el resultado salió de
   * otro sitio y dejarlo sería enseñar filas que ya no responden a lo que dice
   * la barra.
   */
  clear(): void {
    this._result.set(null);
    this._source.set(null);
    this._pendingRejection.set(null);
  }

  /** Anota la operación que el servidor rechazó, a la espera de confirmarse. */
  noteRejection(pending: PendingRejection): void {
    this._pendingRejection.set(pending);
  }

  /** Lo que está esperando confirmación, si hay algo. */
  pendingRejection(): PendingRejection | null {
    return this._pendingRejection();
  }

  dismissRejection(): void {
    this._pendingRejection.set(null);
  }

  /**
   * Pide parar la consulta en curso.
   *
   * Solo hay algo que parar mientras {@link run} está esperando: fuera de ahí no
   * existe identificador, y pedirlo dos veces no acelera nada.
   */
  async cancel(): Promise<void> {
    const executionId = this._currentExecutionId();

    if (!executionId || this._canceling()) {
      return;
    }

    this._canceling.set(true);

    try {
      await firstValueFrom(this._gateway.cancelQuery(executionId));
    } catch {
      // Si ya había terminado, no hay nada que cancelar.
      this._canceling.set(false);
    }
  }

  /** Cancela una ejecución auxiliar, como la vista previa del compositor. */
  async cancelExecution(executionId: string): Promise<void> {
    try {
      await firstValueFrom(this._gateway.cancelQuery(executionId));
    } catch {
      // Puede haber terminado entre la pulsación y esta solicitud.
    }
  }
}
