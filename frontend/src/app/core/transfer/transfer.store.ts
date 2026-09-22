import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ApplicationGateway,
  TransferPreview,
  TransferProgress,
  TransferRequest,
  TransferSetOrder,
  TransferSetRequest,
} from '../application-gateway/application-gateway';
import { outcomeLabel } from '../backup/backup.store';
import { I18nService } from '../i18n/i18n.service';

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
  private readonly _i18n = inject(I18nService);

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
        return this._i18n.t('transfer.step.readingStructure');
      case 'ClearingTarget':
        // Se nombra porque es el paso que borra, y porque en una tabla grande
        // tarda: sin decirlo, parece que la copia no ha empezado.
        return this._i18n.t('transfer.step.clearingTarget');
      case 'CopyingRows':
        return this._i18n.t('transfer.step.copyingRows');
      default:
        return this._i18n.t('transfer.step.done');
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

    // Se compara con las filas **de la tabla en curso**: la estimación es suya, y
    // con varias tablas el total de la pasada la pasaría de largo enseguida. Con
    // una sola tabla los dos números son el mismo.
    return Math.min(1, progress.tableRowsCopied / progress.rowsEstimated);
  });

  /**
   * Tablas terminadas sobre el total, o nulo cuando solo hay una.
   *
   * Es el primer nivel del progreso, el que contesta «¿por dónde va la pasada?».
   * Con una tabla no se enseña: sería una barra de dos posiciones.
   */
  readonly tables = computed(() => {
    const progress = this._progress();

    if (!progress || progress.tablesTotal <= 1) {
      return null;
    }

    return { done: progress.tablesDone, total: progress.tablesTotal };
  });

  /** Qué se copiaría y qué habría que mirar antes, sin tocar el destino. */
  async previewTransfer(request: TransferRequest): Promise<void> {
    this._previewing.set(true);
    this._error.set(null);

    try {
      this._preview.set(await firstValueFrom(this._gateway.previewTransfer(request)));
    } catch (error) {
      this._preview.set(null);
      this._error.set(message(error, this._i18n.t('transfer.noProcess')));
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
        tableRowsCopied: 0,
        tablesDone: 0,
        tablesTotal: 1,
        batchesDone: 0,
        elapsedMilliseconds: 0,
        warnings: [],
      });

      this.poll(id);
    } catch (error) {
      this._error.set(message(error, this._i18n.t('transfer.noProcess')));
    }
  }

  /**
   * En qué orden se copiarían las tablas, y cuáles se apuntan entre sí.
   *
   * Se pregunta antes de confirmar: el orden es lo que hace que una pasada de
   * seis tablas relacionadas funcione, y hay que poder verlo antes de escribir
   * nada.
   */
  async orderSet(request: TransferSetRequest): Promise<TransferSetOrder | null> {
    this._error.set(null);

    try {
      return await firstValueFrom(this._gateway.orderTransferSet(request));
    } catch (error) {
      this._error.set(message(error, this._i18n.t('transfer.noProcess')));

      return null;
    }
  }

  /** Lanza la pasada entera. Como {@link start}, no espera a que termine. */
  async startSet(request: TransferSetRequest): Promise<void> {
    this._error.set(null);
    this._preview.set(null);

    const first = request.tables[0];

    if (!first) {
      return;
    }

    try {
      const id = await firstValueFrom(this._gateway.runTransferSet(request));

      this._progress.set({
        id,
        step: 'ReadingStructure',
        outcome: 'Running',
        currentObject: first.target.name,
        rowsCopied: 0,
        rowsEstimated: first.source.approximateRowCount,
        rowsSkipped: 0,
        tableRowsCopied: 0,
        tablesDone: 0,
        tablesTotal: request.tables.length,
        batchesDone: 0,
        elapsedMilliseconds: 0,
        warnings: [],
      });

      this.poll(id);
    } catch (error) {
      this._error.set(message(error, this._i18n.t('transfer.noProcess')));
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
      this._error.set(message(error, this._i18n.t('transfer.noProcess')));
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
      this._i18n.t('transfer.report.title', { id: progress.id }),
      this._i18n.t('transfer.report.target', { target: progress.currentObject ?? '—' }),
      this._i18n.t('transfer.report.state', {
        outcome: this._i18n.t(outcomeLabel(progress.outcome)),
      }),
      ...(progress.tablesTotal > 1
        ? [
            this._i18n.t('transfer.report.tables', {
              done: progress.tablesDone,
              total: progress.tablesTotal,
            }),
          ]
        : []),
      this._i18n.t('transfer.report.rows', { rows: progress.rowsCopied }),
      this._i18n.t('transfer.report.batches', { batches: progress.batchesDone }),
      this._i18n.t('transfer.report.duration', {
        seconds: Math.round(progress.elapsedMilliseconds / 1000),
      }),
    ];

    if (progress.failure) {
      lines.push(this._i18n.t('transfer.report.failure', { message: progress.failure.message }));
      lines.push(
        this._i18n.t('transfer.report.committed', { rows: progress.failure.rowsCommitted }),
      );

      if (progress.failure.statement) {
        lines.push(
          this._i18n.t('transfer.report.statement', { statement: progress.failure.statement }),
        );
      }
    }

    lines.push(
      ...progress.warnings.map((warning) =>
        this._i18n.t('transfer.report.warning', {
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

function message(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const body = (error as { error?: { message?: string } }).error;

    if (body?.message) {
      return body.message;
    }
  }

  return error instanceof Error ? error.message : fallback;
}
