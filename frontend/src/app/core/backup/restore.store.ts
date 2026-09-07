import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  RestoreInspection,
  RestoreOutcome,
  RestoreProgress,
  RestoreRequest,
} from '../application-gateway/application-gateway';

/** Cada cuánto se pregunta cómo va. */
const POLL_MS = 500;

/**
 * La restauración en marcha, y la última que terminó.
 *
 * Vive en `core` por lo mismo que el respaldo: el trabajo sigue en el proceso
 * local aunque se cierre el diálogo, así que el estado tiene que sobrevivir al
 * componente que lo lanzó.
 *
 * Lo que aquí se conserva importa incluso más que en el respaldo: cuando una
 * restauración se para a mitad, este estado es lo único que dice **hasta dónde
 * se aplicó**, y sin él nadie sabría desde dónde reanudar.
 */
@Injectable({ providedIn: 'root' })
export class RestoreStore {
  private readonly _gateway = inject(ApplicationGateway);

  private readonly _inspection = signal<RestoreInspection | null>(null);
  private readonly _inspecting = signal(false);
  private readonly _progress = signal<RestoreProgress | null>(null);
  private readonly _error = signal<string | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Lo que el artefacto dice de sí mismo, antes de aplicar nada. */
  readonly inspection = this._inspection.asReadonly();

  readonly inspecting = this._inspecting.asReadonly();

  readonly progress = this._progress.asReadonly();

  /** Fallo del transporte, que no es lo mismo que una restauración fallida. */
  readonly error = this._error.asReadonly();

  readonly running = computed(() => this._progress()?.outcome === 'Running');

  readonly finished = computed(() => {
    const outcome = this._progress()?.outcome;

    return outcome !== undefined && outcome !== 'Running';
  });

  /** Qué parte del trabajo se está haciendo, dicho para leerlo. */
  readonly stepLabel = computed(() => {
    const progress = this._progress();

    if (!progress) {
      return '';
    }

    switch (progress.step) {
      case 'Reading':
        return 'Leyendo el respaldo';
      case 'Checking':
        return 'Comprobando el destino';
      case 'Applying':
        return 'Aplicando';
      default:
        return 'Terminado';
    }
  });

  /**
   * Avance entre 0 y 1.
   *
   * Nulo mientras no se sabe cuántas instrucciones hay —se están contando—, y
   * entonces la barra va indeterminada en lugar de fingir un porcentaje.
   */
  readonly overall = computed(() => {
    const progress = this._progress();

    if (!progress || progress.statementsTotal === 0) {
      return null;
    }

    if (progress.outcome !== 'Running') {
      return 1;
    }

    return Math.min(1, progress.statementsDone / progress.statementsTotal);
  });

  /** Mira un artefacto sin tocar nada. */
  async inspect(sessionId: string, path: string): Promise<void> {
    this._inspecting.set(true);
    this._error.set(null);

    try {
      this._inspection.set(await firstValueFrom(this._gateway.inspectRestore(sessionId, path)));
    } catch (error) {
      this._inspection.set(null);
      this._error.set(message(error));
    } finally {
      this._inspecting.set(false);
    }
  }

  /**
   * Aplica el artefacto y empieza a preguntar cómo va.
   *
   * Devuelve en cuanto el proceso local acepta el trabajo: puede tardar lo que
   * tarde, y quien llama no debe esperarlo.
   */
  async start(request: RestoreRequest): Promise<void> {
    this._error.set(null);

    const inspection = this._inspection();
    const total = inspection?.statements ?? 0;

    try {
      // La huella va siempre, y sale de la inspección que el usuario tiene
      // delante: es lo que le dice al proceso local «aplica **esto**, lo que
      // acabo de mirar». Si el artefacto cambió entre medias, se planta.
      const id = await firstValueFrom(
        this._gateway.runRestore({
          ...request,
          fingerprint: request.fingerprint ?? inspection?.fingerprint,
        }),
      );

      this._progress.set({
        id,
        step: 'Reading',
        outcome: 'Running',
        statementsDone: 0,
        statementsTotal: total,
        rowsWritten: 0,
        elapsedMilliseconds: 0,
        applied: 0,
        warnings: [],
      });

      this.poll(id);
    } catch (error) {
      this._error.set(message(error));
    }
  }

  /**
   * Vuelve a lanzar saltándose lo ya aplicado.
   *
   * Reanudar no es repetir: un `CREATE TABLE` repetido falla y un `INSERT`
   * repetido duplica filas, así que se sigue desde la instrucción que se quedó
   * a medias.
   */
  resume(request: RestoreRequest): Promise<void> {
    const failure = this._progress()?.failure;

    return this.start({ ...request, resumeFrom: failure ? failure.index - 1 : 0 });
  }

  async cancel(): Promise<void> {
    const progress = this._progress();

    if (!progress || progress.outcome !== 'Running') {
      return;
    }

    try {
      await firstValueFrom(this._gateway.cancelRestore(progress.id));
    } catch (error) {
      this._error.set(message(error));
    }
  }

  /** Cierra el resumen. Solo lo hace el usuario, nunca un temporizador. */
  dismiss(): void {
    if (this.running()) {
      return;
    }

    this.stop();
    this._progress.set(null);
    this._error.set(null);
  }

  /** Olvida el artefacto mirado, para elegir otro. */
  clear(): void {
    this._inspection.set(null);
    this._error.set(null);
  }

  /**
   * El registro de lo ocurrido, listo para pegarlo en un correo.
   *
   * Lleva la instrucción que falló entera: un error que solo dice «syntax error»
   * no se diagnostica sin ella.
   */
  readonly report = computed(() => {
    const progress = this._progress();

    if (!progress) {
      return '';
    }

    const lines = [
      `Restauración ${progress.id}`,
      `Estado: ${outcomeLabel(progress.outcome)}`,
      `Instrucciones: ${progress.statementsDone} de ${progress.statementsTotal}`,
      `Filas escritas: ${progress.rowsWritten}`,
      `Duración: ${Math.round(progress.elapsedMilliseconds / 1000)} s`,
    ];

    if (progress.failure) {
      lines.push(
        `Falló en la instrucción ${progress.failure.index}: ${progress.failure.message}`,
        progress.failure.statement,
      );
    }

    lines.push(...progress.warnings.map((warning) => `Aviso: ${warning.message}`));

    return lines.join('\n');
  });

  private poll(id: string): void {
    this.stop();

    this.timer = setTimeout(async () => {
      try {
        const progress = await firstValueFrom(this._gateway.getRestoreStatus(id));

        this._progress.set(progress);

        if (progress.outcome === 'Running') {
          this.poll(id);
        }
      } catch {
        // Un sondeo perdido no es una restauración perdida: el trabajo sigue en
        // el proceso local. Se vuelve a preguntar.
        this.poll(id);
      }
    }, POLL_MS);
  }

  private stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** Cómo acabó, dicho para leerlo. */
export function outcomeLabel(outcome: RestoreOutcome): string {
  switch (outcome) {
    case 'Completed':
      return 'Correcto';
    case 'Failed':
      return 'Fallida';
    case 'Cancelled':
      return 'Cancelada';
    default:
      return 'En marcha';
  }
}

function message(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const body = (error as { error?: { message?: string } }).error;

    if (body?.message) {
      return body.message;
    }
  }

  return error instanceof Error ? error.message : 'No se pudo hablar con el proceso local.';
}
