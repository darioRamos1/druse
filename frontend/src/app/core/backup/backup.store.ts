import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { I18nService } from '../i18n/i18n.service';

import {
  ApplicationGateway,
  BackupOutcome,
  BackupPreview,
  BackupProgress,
  BackupRequest,
} from '../application-gateway/application-gateway';

/** Cada cuánto se pregunta cómo va. */
const POLL_MS = 500;

/**
 * El respaldo en marcha, y el último que terminó.
 *
 * Vive en `core` y no dentro del asistente **a propósito**: el trabajo sigue en
 * el proceso local aunque se cierre el diálogo, así que el estado tiene que
 * sobrevivir al componente que lo lanzó. Es lo que permite que la barra de estado
 * siga contando y que volver a abrir el asistente encuentre el respaldo donde
 * estaba.
 *
 * El progreso se **pregunta**, no se recibe empujado: sondear cada medio segundo
 * sobrevive a que la ventana se cierre y se reabra, no exige mantener un flujo
 * abierto y es resolución de sobra para algo que dura minutos.
 */
@Injectable({ providedIn: 'root' })
export class BackupStore {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _i18n = inject(I18nService);

  private readonly _progress = signal<BackupProgress | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly _preview = signal<BackupPreview | null>(null);
  private readonly _previewing = signal(false);

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Lo último que se sabe. Se conserva después de terminar. */
  readonly progress = this._progress.asReadonly();

  /** Fallo del transporte, que no es lo mismo que un respaldo fallido. */
  readonly error = this._error.asReadonly();

  readonly preview = this._preview.asReadonly();

  readonly previewing = this._previewing.asReadonly();

  readonly running = computed(() => this._progress()?.outcome === 'Running');

  /**
   * Terminó y todavía no se ha cerrado el resumen.
   *
   * El resumen **no se desvanece solo**: un aviso de tres segundos no sirve para
   * algo que tardó veinte minutos y que quizá acabó sin nadie mirando.
   */
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
      case 'Resolving':
        return this._i18n.t('backup.step.resolving');
      case 'ReadingStructure':
        return this._i18n.t('backup.step.readingStructure');
      case 'WritingStructure':
        return this._i18n.t('backup.step.writingStructure');
      case 'WritingData':
        return this._i18n.t('backup.step.writingData');
      case 'WritingConstraints':
        return this._i18n.t('backup.step.writingConstraints');
      case 'Packaging':
        // Se nombra porque comprimir varios gigabytes tarda, y para entonces la
        // barra de datos ya está llena: sin decirlo, parece colgado al final.
        return this._i18n.t('backup.step.packaging');
      default:
        return this._i18n.t('backup.step.done');
    }
  });

  /**
   * Avance global, entre 0 y 1.
   *
   * Nulo cuando no se sabe el total: entonces la barra va indeterminada.
   */
  readonly overall = computed(() => {
    const progress = this._progress();

    if (!progress || progress.objectsTotal === 0) {
      return null;
    }

    if (progress.outcome !== 'Running') {
      return 1;
    }

    return Math.min(1, progress.objectsDone / progress.objectsTotal);
  });

  /**
   * Avance de la tabla en curso.
   *
   * Nulo cuando el catálogo no da una estimación fiable —una tabla con condición,
   * una vista—, y entonces se enseña el contador absoluto en lugar de inventar un
   * porcentaje.
   */
  readonly current = computed(() => {
    const progress = this._progress();

    if (!progress?.rowsEstimated || progress.rowsEstimated <= 0) {
      return null;
    }

    return Math.min(1, progress.rowsDone / progress.rowsEstimated);
  });

  /** El guion que se escribiría, sin tocar nada. */
  async previewBackup(request: BackupRequest): Promise<void> {
    this._previewing.set(true);
    this._error.set(null);

    try {
      this._preview.set(await firstValueFrom(this._gateway.previewBackup(request)));
    } catch (error) {
      this._preview.set(null);
      this._error.set(message(error, this._i18n.t('backup.noProcess')));
    } finally {
      this._previewing.set(false);
    }
  }

  /**
   * Lanza el respaldo y empieza a preguntar cómo va.
   *
   * Devuelve en cuanto el proceso local acepta el trabajo: quien llama no debe
   * esperarlo, porque puede durar media hora.
   */
  async start(request: BackupRequest): Promise<void> {
    this._error.set(null);
    this._preview.set(null);

    try {
      const id = await firstValueFrom(this._gateway.runBackup(request));

      this._progress.set({
        id,
        step: 'Resolving',
        outcome: 'Running',
        objectsDone: 0,
        objectsTotal: request.tables.length,
        rowsDone: 0,
        totalRows: 0,
        elapsedMilliseconds: 0,
        warnings: [],
      });

      this.poll(id);
    } catch (error) {
      this._error.set(message(error, this._i18n.t('backup.noProcess')));
    }
  }

  /** Pide que pare. El archivo a medias lo borra el proceso local. */
  async cancel(): Promise<void> {
    const progress = this._progress();

    if (!progress || progress.outcome !== 'Running') {
      return;
    }

    try {
      await firstValueFrom(this._gateway.cancelBackup(progress.id));
    } catch (error) {
      this._error.set(message(error, this._i18n.t('backup.noProcess')));
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

  clearPreview(): void {
    this._preview.set(null);
  }

  /**
   * El registro de lo ocurrido, listo para pegarlo en un correo.
   *
   * Es lo que un usuario manda cuando pide ayuda, y sin ello la respuesta
   * siempre es «¿y qué decía exactamente?».
   */
  readonly report = computed(() => {
    const progress = this._progress();

    if (!progress) {
      return '';
    }

    const lines = [
      this._i18n.t('backup.report.title', { id: progress.id }),
      this._i18n.t('backup.report.state', {
        outcome: this._i18n.t(outcomeLabel(progress.outcome)),
      }),
      this._i18n.t('backup.report.objects', {
        done: progress.objectsDone,
        total: progress.objectsTotal,
      }),
      this._i18n.t('backup.report.rows', { rows: progress.totalRows }),
      this._i18n.t('backup.report.duration', {
        seconds: Math.round(progress.elapsedMilliseconds / 1000),
      }),
    ];

    if (progress.path) {
      lines.push(this._i18n.t('backup.report.path', { path: progress.path }));
    }

    if (progress.failure) {
      lines.push(
        this._i18n.t('backup.report.failure', {
          subject: progress.failure.subject,
          message: progress.failure.message,
        }),
      );

      if (progress.failure.statement) {
        lines.push(
          this._i18n.t('backup.report.statement', { statement: progress.failure.statement }),
        );
      }
    }

    lines.push(
      ...progress.warnings.map((warning) =>
        this._i18n.t('backup.report.warning', {
          subject: warning.subject,
          message: warning.message,
        }),
      ),
    );

    return lines.join('\n');
  });

  private poll(id: string): void {
    this.stop();

    this.timer = setTimeout(async () => {
      try {
        const progress = await firstValueFrom(this._gateway.getBackupStatus(id));

        this._progress.set(progress);

        if (progress.outcome === 'Running') {
          this.poll(id);
        }
      } catch {
        // Un sondeo perdido no es un respaldo perdido: el trabajo sigue en el
        // proceso local. Se vuelve a preguntar en lugar de dar nada por muerto.
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

  private once<T>(source: { subscribe: (observer: unknown) => unknown }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      source.subscribe({
        next: (value: T) => resolve(value),
        error: (error: unknown) => reject(error),
      });
    });
  }
}

/** Cómo acabó: la clave del catálogo, que traduce quien lo pinta. */
export function outcomeLabel(outcome: BackupOutcome): string {
  switch (outcome) {
    case 'Completed':
      return 'backup.outcome.completed';
    case 'CompletedWithWarnings':
      return 'backup.outcome.warnings';
    case 'Failed':
      return 'backup.outcome.failed';
    case 'Cancelled':
      return 'backup.outcome.cancelled';
    default:
      return 'backup.outcome.running';
  }
}

function message(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const body = (error as { error?: { message?: string } }).error;

    if (body?.message) {
      return body.message;
    }
  }

  return error instanceof Error ? error.message : fallback;
}
