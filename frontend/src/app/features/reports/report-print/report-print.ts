import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ExportFilter } from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { ReportChart } from '../report-chart/report-chart';
import { PanelView } from '../report-panel-view';

/** Una página del tablero, tal como se imprime. */
export interface PrintPage {
  readonly name: string;
  readonly views: readonly PanelView[];
}

/** Cuerpo de la página mientras hay una vista de impresión: el CSS de impresión oculta todo lo demás. */
export const PRINTING_CLASS = 'is-printing-report';

/**
 * La vista de impresión de un tablero o un panel: de aquí sale el PDF.
 *
 * Se imprime con el diálogo del sistema («Guardar como PDF» en Windows y en el
 * navegador). Así el PDF lleva los mismos gráficos que la pantalla —el mismo
 * SVG, sin una librería que los vuelva a dibujar— con su distribución, los
 * filtros activos y la fecha de los datos.
 *
 * Mientras está abierta:
 * - Cuelga directamente de `<body>`. Dentro del constructor, que es `fixed`,
 *   el navegador no reparte el contenido en páginas: repetiría o cortaría.
 * - Pone el tema claro. Es papel: el oscuro gastaría tinta y en blanco y negro
 *   no se leería. Al cerrar vuelve el tema que hubiera.
 */
@Component({
  selector: 'app-report-print',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ReportChart, TranslatePipe],
  templateUrl: './report-print.html',
  styleUrl: './report-print.scss',
})
export class ReportPrint implements AfterViewInit, OnDestroy {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly title = input.required<string>();
  readonly filters = input.required<readonly ExportFilter[]>();
  /** Fecha de generación, ya escrita en el idioma de la interfaz. */
  readonly generatedAt = input.required<string>();
  readonly pages = input.required<readonly PrintPage[]>();
  /** Cómo se escribe «Datos del…» de cada panel. */
  readonly capturedAt = input.required<(iso: string) => string>();
  readonly notes = input.required<(view: PanelView) => readonly string[]>();

  readonly closed = output<void>();

  private readonly _printButton = viewChild<ElementRef<HTMLButtonElement>>('printButton');
  private readonly _opener = document.activeElement;
  private readonly _theme = document.documentElement.dataset['theme'];

  /** Escape cierra la vista y no llega al constructor que está debajo. */
  private readonly _keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      this.closed.emit();
    }
  };

  constructor() {
    document.body.classList.add(PRINTING_CLASS);
    document.documentElement.dataset['theme'] = 'light';
    document.addEventListener('keydown', this._keys, true);
  }

  /**
   * Se lleva a `<body>` aquí y no en el constructor: Angular inserta el
   * componente en su sitio después de construirlo, y lo devolvería dentro del
   * constructor de Reportes.
   */
  ngAfterViewInit(): void {
    document.body.append(this._host.nativeElement);
    this._printButton()?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this._keys, true);
    document.body.classList.remove(PRINTING_CLASS);

    if (this._theme === undefined) {
      delete document.documentElement.dataset['theme'];
    } else {
      document.documentElement.dataset['theme'] = this._theme;
    }

    this._host.nativeElement.remove();

    if (this._opener instanceof HTMLElement && this._opener.isConnected) {
      this._opener.focus();
    }
  }

  protected print(): void {
    window.print();
  }
}
