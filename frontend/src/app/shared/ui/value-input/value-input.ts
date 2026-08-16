import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { InputKind } from '../../models/workspace';
import { Icon } from '../icon/icon';

/** Qué control del navegador corresponde a cada tipo. */
const NATIVE_TYPE: Readonly<Partial<Record<InputKind, string>>> = {
  integer: 'number',
  decimal: 'number',
  date: 'date',
  time: 'time',
  datetime: 'datetime-local',
  datetimeOffset: 'datetime-local',
};

/**
 * Pide un valor con el control que corresponde a su tipo.
 *
 * Una fecha se elige en un calendario y un booleano se marca; escribirlos a
 * mano es donde aparecen los `2026-13-45` y los `si` que el motor rechaza
 * después, cuando ya se ha ejecutado media instrucción.
 *
 * **Siempre se puede volver a texto libre.** Un valor no siempre es un dato: a
 * veces es `CURRENT_TIMESTAMP`, una función del motor o un cálculo, y un
 * calendario no sabe escribir eso. El botón de texto libre es lo que evita que
 * ayudar se convierta en estorbar.
 */
@Component({
  selector: 'app-value-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './value-input.html',
  styleUrl: './value-input.scss',
})
export class ValueInput {
  readonly value = input<string>('');
  readonly kind = input<InputKind>('text');
  readonly dataType = input<string>('');
  readonly disabled = input<boolean>(false);
  readonly label = input<string>('');

  readonly valueChange = output<string>();

  /** El usuario pidió escribir a mano, aunque el tipo tenga control propio. */
  protected readonly freeText = signal(false);

  protected readonly nativeType = computed(() => NATIVE_TYPE[this.kind()] ?? 'text');

  /**
   * Precisión que se le pide al control.
   *
   * Sin `step`, el selector de fecha y hora se queda en minutos y no deja elegir
   * los segundos, que una marca de tiempo sí guarda. Un decimal admite cualquier
   * cifra: sin esto, el navegador solo aceptaría enteros.
   */
  protected readonly step = computed(() => {
    switch (this.kind()) {
      case 'decimal':
        return 'any';
      case 'time':
      case 'datetime':
      case 'datetimeOffset':
        return '1';
      default:
        return null;
    }
  });

  protected readonly isBoolean = computed(() => this.kind() === 'boolean' && !this.freeText());

  /**
   * Si el control del navegador puede con este valor.
   *
   * Un valor que ya viene escrito —de una fila cargada o de una expresión— puede
   * no encajar en el formato que exige un `date`, y ahí el control lo vaciaría
   * en silencio. Cuando no encaja se enseña como texto, sin que el usuario tenga
   * que pedirlo.
   */
  protected readonly usesNative = computed(() => {
    if (this.freeText() || this.nativeType() === 'text') {
      return false;
    }

    const current = this.value().trim();

    return current.length === 0 || this.fits(current);
  });

  /** El tipo admite un control propio, así que ofrecer texto libre tiene sentido. */
  protected readonly canToggle = computed(
    () => this.kind() !== 'text' && this.kind() !== 'binary' && this.kind() !== 'uuid',
  );

  protected readonly checked = computed(() => {
    const current = this.value().trim().toLowerCase();

    return current === 'true' || current === '1' || current === 't' || current === 'yes';
  });

  protected onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).value);
  }

  protected onCheck(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).checked ? 'true' : 'false');
  }

  protected toggleFreeText(): void {
    this.freeText.update((value) => !value);
  }

  /**
   * Formato que espera cada control, para decirlo antes de que falle.
   *
   * Un `datetime-local` no acepta el espacio que separa fecha y hora en SQL, así
   * que el aviso importa aunque el control lo resuelva casi siempre.
   */
  private fits(value: string): boolean {
    switch (this.kind()) {
      case 'date':
        return /^\d{4}-\d{2}-\d{2}$/.test(value);
      case 'time':
        return /^\d{2}:\d{2}(:\d{2})?$/.test(value);
      case 'datetime':
      case 'datetimeOffset':
        return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value);
      case 'integer':
        return /^-?\d+$/.test(value);
      case 'decimal':
        return /^-?\d*[.,]?\d+([eE][-+]?\d+)?$/.test(value);
      default:
        return true;
    }
  }

  /**
   * Lo que el control nativo necesita recibir.
   *
   * `datetime-local` exige la `T` entre fecha y hora, mientras que en SQL se
   * escribe con un espacio: sin esta traducción, un valor que viene de la base
   * llegaría al control y este lo dejaría vacío.
   */
  protected readonly nativeValue = computed(() => {
    const current = this.value().trim();

    return this.kind() === 'datetime' || this.kind() === 'datetimeOffset'
      ? current.replace(' ', 'T')
      : current;
  });
}
