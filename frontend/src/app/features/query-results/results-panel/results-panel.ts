import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { ExportFormat } from '../../../core/application-gateway/application-gateway';
import {
  CellEdit,
  QueryHistoryEntry,
  QueryResult,
  ResultSet,
} from '../../../shared/models/workspace';
import { Icon } from '../../../shared/ui/icon/icon';
import { OperationProgress } from '../../../shared/ui/operation-progress/operation-progress';
import { QueryHistory } from '../../query-history/query-history/query-history';
import { CopyFormat } from '../results-grid/copy-formats';
import { ResultsGrid } from '../results-grid/results-grid';

type ResultsTab = 'results' | 'messages' | 'history';

/**
 * Panel inferior: resultados, mensajes e historial.
 *
 * Solo se ocupa de las pestañas, las acciones y el pie. La presentación de las
 * filas vive en `ResultsGrid`.
 */
@Component({
  selector: 'app-results-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, OperationProgress, ResultsGrid, QueryHistory],
  templateUrl: './results-panel.html',
  styleUrl: './results-panel.scss',
})
export class ResultsPanel {
  readonly resultSet = input<ResultSet | null>(null);
  readonly result = input<QueryResult | null>(null);
  readonly history = input<readonly QueryHistoryEntry[]>([]);
  readonly pageSize = input(500);
  readonly running = input(false);
  readonly canceling = input(false);
  readonly timeoutSeconds = input(30);

  readonly exporting = input(false);

  /** El resultado se puede editar: viene de una tabla con clave primaria. */
  readonly editable = input(false);
  readonly edits = input<readonly CellEdit[]>([]);
  readonly editPreview = input<readonly string[] | null>(null);
  readonly saving = input(false);

  readonly refreshHistory = output<void>();
  readonly searchHistory = output<string>();
  readonly clearHistory = output<void>();
  readonly reuseQuery = output<QueryHistoryEntry>();
  readonly exportAs = output<ExportFormat>();
  readonly copied = output<string>();
  readonly copyFailed = output<void>();
  readonly cellEdited = output<CellEdit>();
  readonly cancelQuery = output<void>();

  /** Filas señaladas para borrar y lo que hace falta para llevarlo a cabo. */
  readonly selectedRows = input<readonly number[]>([]);
  readonly deletePreview = input<readonly string[] | null>(null);
  readonly deleting = input(false);

  readonly rowToggled = output<number>();
  readonly clearSelection = output<void>();
  readonly prepareDelete = output<void>();
  readonly cancelDelete = output<void>();
  readonly deleteRows = output<void>();
  readonly prepareEdits = output<void>();
  readonly saveEdits = output<void>();
  readonly discardEdits = output<void>();
  readonly cancelSave = output<void>();

  protected readonly activeTab = signal<ResultsTab>('results');
  protected readonly exportOpen = signal(false);
  protected readonly exportPosition = signal({ top: 0, left: 0 });

  protected readonly copyOpen = signal(false);
  protected readonly copyPosition = signal({ top: 0, left: 0 });

  /**
   * La cuadrícula que se está viendo.
   *
   * El panel necesita preguntarle qué hay seleccionado: la selección es suya
   * —nace y muere con cada resultado— y sacarla aquí arriba para poder pintar un
   * botón obligaría a los dos a mantener la misma verdad por duplicado.
   */
  private readonly grid = viewChild(ResultsGrid);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly hasSelection = computed(() => this.grid()?.hasSelection() ?? false);

  protected readonly selectionLabel = computed(() => this.grid()?.selectionLabel() ?? '');
  protected readonly showFilters = signal(false);
  protected readonly compact = signal(false);
  protected readonly elapsedMs = signal(0);

  /** Índice del conjunto de resultados visible, si la consulta devolvió varios. */
  protected readonly activeSetIndex = signal(0);
  protected readonly selectedSetIndex = computed(() =>
    Math.min(this.activeSetIndex(), Math.max(0, this.resultSets().length - 1)),
  );

  protected readonly resultSets = computed(() => this.result()?.resultSets ?? []);

  protected readonly progressSubject = computed(() => {
    if (this.canceling()) {
      return 'Esperando que el motor detenga la ejecución';
    }

    return this.elapsedMs() >= 10_000
      ? 'La base de datos sigue procesando la consulta'
      : 'Esperando la respuesta de la base de datos';
  });

  constructor() {
    let previousExecutionId: string | undefined;

    effect(() => {
      const executionId = this.result()?.executionId;

      if (executionId !== previousExecutionId) {
        previousExecutionId = executionId;
        this.activeSetIndex.set(0);
      }
    });

    effect((onCleanup) => {
      if (!this.running()) {
        this.elapsedMs.set(0);
        return;
      }

      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        this.elapsedMs.set(Date.now() - startedAt);
      }, 250);

      onCleanup(() => window.clearInterval(timer));
    });
  }

  protected requestCancel(): void {
    if (!this.canceling()) {
      this.cancelQuery.emit();
    }
  }

  /**
   * Conjunto que se está mostrando.
   *
   * `resultSet` sigue existiendo para quien solo tenga uno; si hay varios manda
   * el que el usuario haya elegido.
   */
  protected readonly currentSet = computed(() => {
    const sets = this.resultSets();

    return sets.length > 0 ? (sets[this.selectedSetIndex()] ?? null) : this.resultSet();
  });

  protected toggleExport(event: Event): void {
    const trigger = event.currentTarget as HTMLElement;
    const rect = trigger.getBoundingClientRect();
    this.exportPosition.set({ top: rect.bottom + 4, left: Math.max(8, rect.right - 190) });
    this.exportOpen.update((open) => !open);
  }

  protected chooseExport(format: ExportFormat): void {
    this.exportOpen.set(false);
    this.exportAs.emit(format);
  }

  protected toggleCopy(event: Event): void {
    const trigger = event.currentTarget as HTMLElement;
    const rect = trigger.getBoundingClientRect();

    this.copyPosition.set({ top: rect.bottom + 4, left: Math.max(8, rect.right - 232) });
    this.copyOpen.update((open) => !open);
  }

  protected chooseCopy(format: CopyFormat): void {
    this.copyOpen.set(false);
    void this.grid()?.copyAs(format);
  }

  protected toggleFilters(): void {
    this.showFilters.update((visible) => !visible);
  }

  protected toggleDensity(): void {
    this.compact.update((value) => !value);
  }

  protected async copyError(): Promise<void> {
    const error = this.result()?.error;

    if (!error) {
      return;
    }

    const text = error.code ? `${error.message} (${error.code})` : error.message;

    try {
      await navigator.clipboard.writeText(text);
      this.copied.emit(text);
    } catch {
      this.copyFailed.emit();
    }
  }

  protected selectSet(index: number): void {
    this.activeSetIndex.set(index);
  }

  /** Abre la pestaña indicada y refresca el historial al entrar en él. */
  protected select(tab: ResultsTab): void {
    this.activeTab.set(tab);

    if (tab === 'history') {
      this.refreshHistory.emit();
    }
  }

  openHistory(): void {
    this.select('history');
  }

  /**
   * Lleva el teclado a los datos.
   *
   * Si lo que se está mirando es el historial o los mensajes, primero se vuelve
   * a los resultados: pedir el foco en la cuadrícula con otra pestaña delante no
   * puede querer decir otra cosa.
   */
  focusGrid(): void {
    if (this.activeTab() !== 'results') {
      this.select('results');
    }

    this.grid()?.focusGrid();
  }

  /**
   * Abre el menú de exportar como si se hubiera pulsado su botón.
   *
   * Se abre el menú y no se exporta a un formato fijo: elegir CSV o Excel es
   * media decisión, y adivinarla desde un atajo escribiría el archivo que no era.
   */
  openExportMenu(): void {
    const boton = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.export .tool-button',
    );

    if (boton) {
      boton.click();
    }
  }

  protected readonly hasFilters = computed(() =>
    (this.currentSet()?.columns ?? []).some((column) => !!column.filter),
  );

  protected readonly rowCount = computed(() => this.currentSet()?.rows.length ?? 0);

  /** Mensajes del servidor más el error, si lo hubo. */
  protected readonly messages = computed(() => {
    const result = this.result();

    if (!result) {
      return [];
    }

    const messages = [...result.messages];

    if (result.error) {
      messages.push({
        text: result.error.code
          ? `${result.error.message} (${result.error.code})`
          : result.error.message,
        severity: 'error' as const,
      });
    }

    return messages;
  });

  protected readonly messageCount = computed(() => this.messages().length);

  protected readonly rangeLabel = computed(() => {
    const set = this.currentSet();

    if (!set || set.rows.length === 0) {
      return 'Sin filas';
    }

    return set.truncated
      ? `1–${set.rows.length} (recortado)`
      : `1–${set.rows.length} de ${set.totalRows.toLocaleString('es')}`;
  });
}
