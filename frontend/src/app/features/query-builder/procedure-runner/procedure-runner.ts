import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { Icon } from '../../../shared/ui/icon/icon';
import {
  DatabaseEngine,
  DatabaseObject,
  RoutineParameter,
  RoutineSignature,
} from '../../../shared/models/workspace';
import { RoutineArgument, buildCall } from '../../query-editor/sql-language/sql-writer';

/**
 * Qué se hace con un parámetro.
 *
 * `omit` no es lo mismo que `null`: omitir deja que el motor ponga su valor por
 * omisión, y pasar `NULL` es decirle expresamente que no hay valor. Confundirlos
 * es de los errores más caros al llamar a un procedimiento ajeno.
 */
type InputMode = 'omit' | 'value' | 'null';

interface ParameterDraft {
  readonly mode: InputMode;
  readonly text: string;
}

/**
 * Ejecuta un procedimiento rellenando sus parámetros.
 *
 * Sin esto había que leer el DDL, entender la firma y escribir la llamada a
 * mano; el catálogo ya sabe qué parámetros hay, así que la pantalla los pide y
 * escribe la llamada.
 *
 * **El SQL queda a la vista y se puede editar antes de ejecutar**, como en el
 * resto de Druse: lo que se ejecuta es lo que se lee, y las salidas obligan a un
 * guion de varias líneas que conviene revisar.
 */
@Component({
  selector: 'app-procedure-runner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './procedure-runner.html',
  styleUrl: './procedure-runner.scss',
})
export class ProcedureRunner implements OnInit {
  private readonly _store = inject(WorkspaceStore);

  readonly procedure = input.required<DatabaseObject>();
  readonly engine = input.required<DatabaseEngine>();
  readonly connectionId = input.required<string>();

  readonly closed = output<void>();
  readonly insert = output<string>();
  readonly run = output<string>();

  protected readonly loading = signal(true);
  protected readonly signature = signal<RoutineSignature | null>(null);
  protected readonly drafts = signal<Readonly<Record<string, ParameterDraft>>>({});
  protected readonly sqlOverride = signal<string | null>(null);

  /** Los que hay que rellenar; las salidas no se piden, se recogen. */
  protected readonly inputs = computed(() =>
    (this.signature()?.parameters ?? []).filter(
      (parameter) => parameter.direction === 'input' || parameter.direction === 'inputOutput',
    ),
  );

  protected readonly outputs = computed(() =>
    (this.signature()?.parameters ?? []).filter(
      (parameter) => parameter.direction === 'output' || parameter.direction === 'inputOutput',
    ),
  );

  /**
   * Informix no puede recoger salidas fuera de un procedimiento, así que se
   * avisa antes de ejecutar en lugar de dejar que el usuario las busque en un
   * resultado que nunca llega.
   */
  protected readonly outputsUnavailable = computed(
    () => this.engine() === 'informix' && this.outputs().length > 0,
  );

  /** Falta algún valor obligatorio: se puede ejecutar igual, pero conviene decirlo. */
  protected readonly missing = computed(() =>
    this.inputs().filter((parameter) => {
      const draft = this.draftFor(parameter);

      return draft.mode === 'value' && draft.text.trim().length === 0 && !parameter.hasDefault;
    }),
  );

  protected readonly sql = computed(() => {
    const override = this.sqlOverride();

    if (override !== null) {
      return override;
    }

    const signature = this.signature();

    if (!signature) {
      return '';
    }

    return buildCall(this.engine(), {
      schema: signature.schema,
      routine: signature.name,
      parameters: this.argumentsFor(signature),
    });
  });

  async ngOnInit(): Promise<void> {
    const signature = await this._store.routineSignature(this.connectionId(), this.procedure());

    this.signature.set(signature);
    this.drafts.set(
      Object.fromEntries(
        (signature?.parameters ?? []).map((parameter) => [
          parameter.name,
          { mode: parameter.hasDefault ? 'omit' : 'value', text: '' } as ParameterDraft,
        ]),
      ),
    );
    this.loading.set(false);
  }

  protected draftFor(parameter: RoutineParameter): ParameterDraft {
    return this.drafts()[parameter.name] ?? { mode: 'value', text: '' };
  }

  protected setMode(parameter: RoutineParameter, mode: InputMode): void {
    this.updateDraft(parameter, { ...this.draftFor(parameter), mode });
  }

  protected setText(parameter: RoutineParameter, text: string): void {
    this.updateDraft(parameter, { mode: 'value', text });
  }

  protected onText(parameter: RoutineParameter, event: Event): void {
    this.setText(parameter, (event.target as HTMLInputElement).value);
  }

  protected onSqlEdited(event: Event): void {
    this.sqlOverride.set((event.target as HTMLTextAreaElement).value);
  }

  /** Vuelve a componer desde el formulario, descartando lo escrito a mano. */
  protected resetSql(): void {
    this.sqlOverride.set(null);
  }

  protected emitInsert(): void {
    this.insert.emit(this.sql());
  }

  protected emitRun(): void {
    this.run.emit(this.sql());
  }

  private updateDraft(parameter: RoutineParameter, draft: ParameterDraft): void {
    this.drafts.update((current) => ({ ...current, [parameter.name]: draft }));
    // Lo escrito a mano deja de valer en cuanto se cambia el formulario: mantener
    // las dos versiones a la vez enseñaría un SQL que ya no se corresponde con
    // los valores de arriba.
    this.sqlOverride.set(null);
  }

  private argumentsFor(signature: RoutineSignature): readonly RoutineArgument[] {
    return signature.parameters
      .filter((parameter) => {
        const draft = this.draftFor(parameter);

        // Un parámetro omitido no viaja; los de salida siempre, porque hacen
        // falta para recoger el valor.
        return parameter.direction !== 'input' || draft.mode !== 'omit';
      })
      .map((parameter) => {
        const draft = this.draftFor(parameter);

        return {
          name: parameter.name,
          dataType: parameter.dataType,
          direction:
            parameter.direction === 'return'
              ? ('output' as const)
              : (parameter.direction as 'input' | 'output' | 'inputOutput'),
          value:
            draft.mode === 'null'
              ? ({ kind: 'null' } as const)
              : ({ kind: 'value', text: draft.text.trim().length > 0 ? draft.text : null } as const),
        };
      });
  }
}
