import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import {
  DEFAULT_FORMAT_SETTINGS,
  FORMAT_WIDTHS,
  FormatSettings,
} from '../../../core/workspace/format-settings';
import { Icon } from '../../../shared/ui/icon/icon';
import { Disclosure } from '../../../shared/a11y/disclosure';
import { shortcutLabel } from '../../../core/shortcuts/shortcut-label';
import { formatNumber } from '../../../core/i18n/locale-format';

/**
 * Una conexión a la que la pestaña puede cambiarse.
 *
 * Lleva el entorno porque es lo que evita el accidente: entre «ventas» y
 * «ventas» lo único que distingue desarrollo de producción es esa etiqueta.
 */
export interface ConnectionChoice {
  readonly id: string;
  readonly name: string;
  readonly environment: string;
  /** Tiene sesión abierta; las demás se abren al elegirlas. */
  readonly open: boolean;
  readonly readOnly: boolean;
}

/** Ajuste de formateo que el menú deja cambiar. */
type FormatGroupKey = keyof FormatSettings;

type FormatOptionValue = FormatSettings[FormatGroupKey];

interface FormatOption {
  readonly value: FormatOptionValue;
  readonly label: string;
  /** Qué hace, para quien no lo deduzca del nombre. */
  readonly hint?: string;
}

interface FormatGroup {
  readonly key: FormatGroupKey;
  readonly label: string;
  readonly options: readonly FormatOption[];
}

/**
 * Barra de acciones del editor.
 *
 * Los botones solo emiten intenciones; quién puede ejecutar y con qué límites lo
 * decide el store, y el servidor lo vuelve a comprobar.
 */
@Component({
  selector: 'app-editor-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Disclosure],
  templateUrl: './editor-toolbar.html',
  styleUrl: './editor-toolbar.scss',
})
export class EditorToolbar {
  protected readonly shortcut = shortcutLabel;
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly compact = signal(false);

  constructor() {
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const host = this._host.nativeElement;
      const measure = () => {
        if (!host.clientWidth) return;
        const compact = host.clientWidth <= 1100;
        if (compact === this.compact()) return;
        const focused = document.activeElement;
        const restoreFocus =
          focused instanceof Element &&
          host.contains(focused) &&
          !!focused.closest('.format, [data-secondary]');
        this.compact.set(compact);
        this.editingFormat.set(false);
        if (restoreFocus) {
          afterNextRender(() => this.formatTrigger()?.focus(), { injector: this.injector });
        }
      };
      const observer = new ResizeObserver(measure);
      observer.observe(host);
      measure();
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  readonly context = input.required<string>();
  readonly timeoutSeconds = input(30);

  /** Filas que se traen de cada consulta. */
  readonly maxRows = input(500);
  readonly running = input(false);
  readonly canceling = input(false);
  readonly hasSelection = input(false);
  readonly maximized = input(false);
  readonly toggleMaximize = output<void>();
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

  /** Cómo formatea hoy el editor, para marcar lo elegido en el menú. */
  readonly formatSettings = input<FormatSettings>(DEFAULT_FORMAT_SETTINGS);

  /** Bases de la conexión de esta pestaña. */
  readonly databases = input<readonly string[]>([]);

  /** Base contra la que se ejecuta ahora. */
  readonly database = input<string | null>(null);

  /**
   * Conexiones entre las que puede moverse esta pestaña.
   *
   * Van las abiertas y también las guardadas que no lo están: pasar de
   * desarrollo a preproducción no debería obligar a ir al panel de conexiones y
   * volver.
   */
  readonly connections = input<readonly ConnectionChoice[]>([]);

  /** La conexión de esta pestaña, para marcarla en el menú. */
  readonly connectionId = input<string | null>(null);

  readonly execute = output<void>();
  readonly executeSelection = output<void>();
  readonly cancel = output<void>();
  readonly format = output<void>();
  readonly toggleLineComment = output<void>();
  readonly timeoutChange = output<number>();

  readonly maxRowsChange = output<number>();

  /** Solo lo que cambió: el store completa el resto. */
  readonly formatSettingsChange = output<Partial<FormatSettings>>();

  readonly databaseChange = output<string>();
  readonly connectionChange = output<string>();
  readonly beginTransaction = output<void>();
  readonly commit = output<void>();
  readonly rollback = output<void>();

  protected readonly beginTransactionReason = computed(() =>
    !this.canExecute()
      ? 'Abre una conexión para usar transacciones.'
      : this.running()
        ? 'Espera a que termine la consulta.'
        : this.transactionBusy()
          ? 'Espera a que termine la operación de transacción.'
          : null,
  );

  protected startTransaction(): void {
    if (!this.beginTransactionReason() && !this.transactionOpen()) this.beginTransaction.emit();
  }

  protected closeSecondary(): void {
    const details =
      this._host.nativeElement.querySelector<HTMLDetailsElement>('.secondary-actions');
    if (details) details.open = false;
  }

  protected onSecondaryToggle(event: Event): void {
    if ((event.target as HTMLDetailsElement).open) {
      this.editingFormat.set(false);
      this.editingLimits.set(false);
      this.choosingDatabase.set(false);
    }
  }

  /** Tab conserva su recorrido nativo; las flechas ofrecen un acceso rápido adicional. */
  protected onSecondaryKeydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const details = event.currentTarget as HTMLDetailsElement;
    const items = Array.from(details.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    details.open = true;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : index < 0
            ? event.key === 'ArrowUp'
              ? items.length - 1
              : 0
            : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  }

  private formatTrigger(): HTMLElement | null {
    return this._host.nativeElement.querySelector(
      this.compact() ? '.secondary-actions > summary' : '.btn--caret',
    );
  }

  protected closeFormat(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.editingFormat.set(false);
    this.formatTrigger()?.focus();
  }

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

  /**
   * Cuántas filas se ofrecen.
   *
   * Cien mil es el tope del proceso local, y se ofrece entero en lugar de dejarlo
   * escrito en el código: quien exporta un resultado lo necesita, y sabe lo que
   * pide porque el panel dice cuándo se recortó.
   */
  protected readonly rowOptions = [100, 500, 1_000, 5_000, 10_000, 100_000];

  protected readonly editingLimits = signal(false);

  protected readonly editingFormat = signal(false);

  /**
   * Lo que se puede elegir del formateo, descrito por lo que hace.
   *
   * Los nombres son los del usuario y no los de `sql-formatter`: «Tabular» dice
   * más que `tabularLeft`, y quien busca sangría no busca `tabWidth`. El menú se
   * dibuja a partir de esta lista, así que añadir una opción es añadir una fila.
   */
  protected readonly formatGroups: readonly FormatGroup[] = [
    {
      key: 'style',
      label: 'Reparto de líneas',
      options: [
        { value: 'standard', label: 'Estándar', hint: 'Cada elemento en su línea, sangrado' },
        {
          value: 'tabular',
          label: 'Tabular',
          hint: 'Palabra clave a la izquierda y valores en columna',
        },
      ],
    },
    {
      // El ancho manda sobre las expresiones —los argumentos de una función,
      // una lista—, no sobre las cláusulas: `FROM` siempre empieza línea. La
      // etiqueta lo dice para no prometer lo que no hace.
      key: 'expressionWidth',
      label: 'Ancho de expresión',
      options: FORMAT_WIDTHS.map((width) => ({
        value: width,
        label: String(width),
        hint: `Parte funciones y listas al pasar de ${width} caracteres`,
      })),
    },
    {
      key: 'keywordCase',
      label: 'Palabras clave',
      options: [
        { value: 'upper', label: 'MAYÚSCULAS' },
        { value: 'lower', label: 'minúsculas' },
        { value: 'preserve', label: 'Como estén', hint: 'No cambia la caja de nada' },
      ],
    },
    {
      key: 'indent',
      label: 'Sangría',
      options: [
        { value: 'spaces2', label: '2 espacios' },
        { value: 'spaces4', label: '4 espacios' },
        { value: 'tabs', label: 'Tabulaciones' },
      ],
    },
  ];

  /**
   * Cierra los desplegables al pulsar en cualquier otro sitio.
   *
   * Es lo que se espera de un menú: sin esto, el de formateo se quedaba abierto
   * tapando el editor hasta volver a su flecha. Se escucha en `pointerdown` y no
   * en `click` para que cierre al empezar la pulsación, antes de que el clic
   * llegue a lo que hay debajo.
   */
  @HostListener('document:pointerdown', ['$event'])
  protected onPointerDownOutside(event: Event): void {
    const target = event.target;

    if (target instanceof Node && this._host.nativeElement.contains(target)) {
      return;
    }

    this.editingLimits.set(false);
    this.editingFormat.set(false);
    this.choosingDatabase.set(false);
  }

  protected toggleLimits(): void {
    this.closeSecondary();
    this.editingFormat.set(false);
    this.choosingDatabase.set(false);
    this.editingLimits.update((open) => !open);
  }

  protected closeLimits(event: Event): void {
    event.stopPropagation();
    this.editingLimits.set(false);
    this._host.nativeElement.querySelector<HTMLButtonElement>('.limits > .chip')?.focus();
  }

  protected toggleFormat(): void {
    this.closeSecondary();
    // Dos menús abiertos a la vez en la misma barra no aportan nada y se tapan
    // entre ellos.
    this.editingLimits.set(false);
    this.choosingDatabase.set(false);
    this.editingFormat.update((open) => !open);
    if (this.editingFormat()) {
      afterNextRender(
        () => this._host.nativeElement.querySelector<HTMLButtonElement>('.format__option')?.focus(),
        { injector: this.injector },
      );
    }
  }

  protected readonly choosingDatabase = signal(false);

  protected toggleDatabases(): void {
    this.closeSecondary();
    this.editingLimits.set(false);
    this.editingFormat.set(false);
    this.choosingDatabase.update((open) => !open);
  }

  /**
   * Aquí sí se cierra al elegir, al revés que el menú de formateo: de base se
   * cambia una y se sigue trabajando, no se ajustan varias cosas seguidas.
   */
  protected chooseDatabase(name: string): void {
    this.choosingDatabase.set(false);
    this.databaseChange.emit(name);
  }

  protected chooseConnection(id: string): void {
    this.choosingDatabase.set(false);

    if (id !== this.connectionId()) {
      this.connectionChange.emit(id);
    }
  }

  /**
   * El contexto sin el esquema: `druse_test.public` se queda en `druse_test`.
   *
   * Es lo que se enseña cuando la barra estrecha. Recortar la cadena entera
   * dejaba «druse_test.p…», que gasta el mismo sitio para decir menos: el
   * esquema casi siempre es el de siempre y la base es la que hay que mirar
   * antes de pulsar Ejecutar.
   */
  protected readonly contextDatabase = computed(() => this.context().split('.')[0]);

  /** La conexión de la pestaña, para escribirla en el chip. */
  protected readonly connection = computed(
    () => this.connections().find((option) => option.id === this.connectionId()) ?? null,
  );

  protected isChosen(key: FormatGroupKey, value: FormatOptionValue): boolean {
    return this.formatSettings()[key] === value;
  }

  /**
   * Aplica una opción sin cerrar el menú.
   *
   * Quien viene a ajustar el formateo suele tocar más de una cosa —el ancho y la
   * sangría van juntos—, y cerrarlo en cada clic obligaría a abrirlo cuatro
   * veces.
   */
  protected choose(key: FormatGroupKey, value: FormatOptionValue): void {
    this.formatSettingsChange.emit({ [key]: value } as Partial<FormatSettings>);
  }

  protected chooseTimeout(seconds: number): void {
    this.timeoutChange.emit(seconds);
  }

  protected chooseRows(rows: number): void {
    this.maxRowsChange.emit(rows);
  }

  /**
   * Miles separados siempre: `100000` se lee mal.
   *
   * Con la agrupación por omisión, el español deja `1000` sin punto y la lista
   * quedaría con unos números agrupados y otros no, que es peor que cualquiera de
   * las dos formas.
   */
  protected rowsLabel(rows: number): string {
    return formatNumber(rows, { useGrouping: true });
  }

  /** Etiqueta compacta: 600 s se lee peor que 10 min. */
  protected label(seconds: number): string {
    return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
  }
}
