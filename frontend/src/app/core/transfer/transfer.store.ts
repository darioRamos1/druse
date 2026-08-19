import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  TransferPreview,
  TransferProgress,
  TransferRequest,
} from '../application-gateway/application-gateway';
import { outcomeLabel } from '../backup/backup.store';

/** Cada cuánto se pregunta cómo va. */
const POLL_MS = 500;

/**
 * El traslado de datos en marcha, y el último que terminó.
 *
 * Vive en `core` y no dentro del asistente por lo mismo que el de respaldos: el
 * trabajo sigue en el proceso local aunque se cierre el diálogo. Aquí hace falta
 * todavía más, porque lo que queda a medias no es un archivo que se pueda tirar,
 * sino filas en otra base: **cuántas llegaron** es la pregunta que hay que poder
 * responder al volver.
 */
@Injectable({ providedIn: 'root' })
export class TransferStore {
  private readonly _gateway = inject(ApplicationGateway);

  private readonly _progress = signal<TransferProgress | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly _preview = signal<TransferPreview | null>(null);
  private readonly _previewing = signal(false);

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Lo último que se sabe. Se conserva después de terminar. */
  readonly progress = this._progress.asReadonly();

  /** Fallo del transporte, que no es lo mismo que un traslado fallido. */
  readonly error = this._error.asReadonly();

  readonly preview = this._preview.asReadonly();

  readonly previewing = this._previewing.asReadonly();

  readonly running = computed(() => this._progress()?.outcome === 'Running');

  /**
   * Terminó y todavía no se ha cerrado el resumen.
   *
   * El resumen **no se desvanece solo**: dice cuántas filas entraron, y eso es lo
   * que hay que leer antes de decidir si se repite la copia.
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
      case 'ReadingStructure':
        return 'Leyendo las columnas de las dos tablas';
      case 'ClearingTarget':
        // Se nombra porque es el paso que borra, y porque en una tabla grande
        // tarda: sin decirlo, parece que la copia no ha empezado.
        return 'Vaciando la tabla de destino';
      case 'CopyingRows':
        return 'Copiando filas';
      default:
        return 'Terminado';
    }
  });

  /**
   * Avance, entre 0 y 1.
   *
   * Nulo cuando el catálogo no da una estimación fiable —con condición no la
   * hay—, y entonces se enseña el contador absoluto en lugar de inventar un
   * porcentaje. Una barra que llega al 90 % y se queda ahí es peor que no tener
   * barra.
   */
  readonly overall = computed(() => {
    const progress = this._progress();

    if (!progress) {
      return null;
    }

    if (progress.outcome !== 'Running') {
      return 1;
    }

    if (!progress.rowsEstimated || progress.rowsEstimated <= 0) {
      return null;
    }

    return Math.min(1, progress.rowsCopied / progress.rowsEstimated);
  });

  /** Qué se copiaría y qué habría que mirar antes, sin tocar el destino. */
  async previewTransfer(request: TransferRequest): Promise<void> {
    this._previewing.set(true);
    this._error.set(null);

    try {
      this._preview.set(await firstValueFrom(this._gateway.previewTransfer(request)));
    } catch (error) {
      this._preview.set(null);
      this._error.set(message(error));
    } finally {
      this._previewing.set(false);
    }
  }

  /**
   * Lanza el traslado y empieza a preguntar cómo va.
   *
   * Devuelve en cuanto el proceso local acepta el trabajo: quien llama no debe
   * esperarlo, porque copiar una tabla grande dura lo que dura.
   */
  async start(request: TransferRequest): Promise<void> {
    this._error.set(null);
    this._preview.set(null);

    try {
      const id = await firstValueFrom(this._gateway.runTransfer(request));

      this._progress.set({
        id,
        step: 'ReadingStructure',
        outcome: 'Running',
        currentObject: request.target.name,
        rowsCopied: 0,
        rowsEstimated: request.source.approximateRowCount,
        rowsSkipped: 0,
        batchesDone: 0,
        elapsedMilliseconds: 0,
        warnings: [],
      });

      this.poll(id);
    } catch (error) {
      this._error.set(message(error));
    }
  }

  /**
   * Pide que pare.
   *
   * **Lo ya copiado se queda.** Cancelar no deshace los lotes que el destino dio
   * por buenos, y el resumen dirá cuántos fueron; solo con «todo o nada» no queda
   * nada, porque entonces no se había confirmado ninguno.
   */
  async cancel(): Promise<void> {
    const progress = this._progress();

    if (!progress || progress.outcome !== 'Running') {
      return;
    }

    try {
      await firstValueFrom(this._gateway.cancelTransfer(progress.id));
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

  clearPreview(): void {
    this._preview.set(null);
  }

  /**
   * El registro de lo ocurrido, listo para pegarlo en un correo.
   *
   * Lleva las filas confirmadas incluso cuando falló: es lo primero que hay que
   * saber para decidir si se repite la copia o se reanuda.
   */
  readonly report = computed(() => {
    const progress = this._progress();

    if (!progress) {
      return '';
    }

    const lines = [
      `Traslado ${progress.id}`,
      `Destino: ${progress.currentObject ?? '—'}`,
      `Estado: ${outcomeLabel(progress.outcome)}`,
      `Filas copiadas: ${progress.rowsCopied}`,
      `Lotes: ${progress.batchesDone}`,
      `Duración: ${Math.round(progress.elapsedMilliseconds / 1000)} s`,
    ];

    if (progress.failure) {
      lines.push(`Error: ${progress.failure.message}`);
      lines.push(`Filas que quedaron en el destino: ${progress.failure.rowsCommitted}`);

      if (progress.failure.statement) {
        lines.push(`Instrucción: ${progress.failure.statement}`);
      }
    }

    lines.push(
      ...progress.warnings.map((warning) => `Aviso en ${warning.subject}: ${warning.message}`),
    );

    return lines.join('\n');
  });

  private poll(id: string): void {
    this.stop();

    this.timer = setTimeout(async () => {
      try {
        const progress = await firstValueFrom(this._gateway.getTransferStatus(id));

        this._progress.set(progress);

        if (progress.outcome === 'Running') {
          this.poll(id);
        }
      } catch {
        // Un sondeo perdido no es un traslado perdido: el trabajo sigue en el
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
