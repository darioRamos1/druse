import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { Icon } from '../../../shared/ui/icon/icon';

/**
 * Barra de acciones del editor.
 *
 * Los botones solo emiten intenciones; quién puede ejecutar y con qué límites lo
 * decide el store, y el servidor lo vuelve a comprobar.
 */
@Component({
  selector: 'app-editor-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './editor-toolbar.html',
  styleUrl: './editor-toolbar.scss',
})
export class EditorToolbar {
  readonly context = input.required<string>();
  readonly timeoutSeconds = input(30);
  readonly running = input(false);
  readonly hasSelection = input(false);
  /** Hay una conexión abierta contra la que ejecutar. */
  readonly canExecute = input(false);

  /** Hay una transacción manual abierta en la conexión de esta pestaña. */
  readonly transactionOpen = input(false);

  /** Conexión a la que afecta la transacción, que no tiene por qué ser la pestaña. */
  readonly transactionScope = input('');

  /** El motor no deshace el DDL aunque se deshaga la transacción. */
  readonly transactionDdlIsReversible = input(true);

  /** Hay una operación de transacción en curso; los botones esperan. */
  readonly transactionBusy = input(false);

  readonly execute = output<void>();
  readonly executeSelection = output<void>();
  readonly cancel = output<void>();
  readonly format = output<void>();
  readonly timeoutChange = output<number>();
  readonly beginTransaction = output<void>();
  readonly commit = output<void>();
  readonly rollback = output<void>();

  /**
   * Qué implica tener esta transacción abierta.
   *
   * En los motores que no deshacen el DDL se dice aquí, donde el usuario tiene
   * el ratón, y no solo en el aviso del momento de abrirla: quien creó una tabla
   * media hora después ya no se acuerda de aquel mensaje.
   */
  protected readonly transactionHint = computed(() =>
    this.transactionDdlIsReversible()
      ? 'Todo lo que ejecutes en esta conexión entra en la transacción hasta que la confirmes o la deshagas.'
      : 'Todo lo que ejecutes en esta conexión entra en la transacción. ' +
        'Crear o modificar tablas es la excepción: en este motor queda hecho aunque pulses Rollback.',
  );

  /** Valores habituales, para no obligar a teclear un número. */
  protected readonly timeoutOptions = [5, 10, 30, 60, 300, 600];

  protected readonly editingTimeout = signal(false);

  protected toggleTimeout(): void {
    this.editingTimeout.update((open) => !open);
  }

  protected chooseTimeout(seconds: number): void {
    this.editingTimeout.set(false);
    this.timeoutChange.emit(seconds);
  }

  /** Etiqueta compacta: 600 s se lee peor que 10 min. */
  protected label(seconds: number): string {
    return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
  }
}
