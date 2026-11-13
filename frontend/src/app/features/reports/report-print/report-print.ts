import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ExportFilter, ReportIdentity } from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import { ReportChart } from '../report-chart/report-chart';
import { ReportIdentityHeader } from '../report-identity-header/report-identity-header';
import { PanelView } from '../report-panel-view';

/** Una página del tablero, tal como se imprime. */
export interface PrintPage {
  readonly name: string;
  readonly views: readonly PanelView[];
}

/** Cuerpo de la página mientras hay una vista de impresión: el CSS de impresión oculta todo lo demás. */
export const PRINTING_CLASS = 'is-printing-report';

/** Id del `<style>` con el pie de las hojas: hay uno mientras la vista está abierta. */
export const PAGE_FOOTER_STYLE = 'druse-report-print-page';

/**
 * El pie de cada hoja impresa como regla `@page`: el texto de la empresa a la
 * izquierda y «Página n de m» a la derecha.
 *
 * Solo los márgenes de `@page` saben en qué hoja están (`counter(page)`); el
 * contenido de la vista no, porque el navegador lo reparte después. El texto
 * va como cadena de CSS, así que comillas, barras y saltos se escapan: es
 * texto de quien escribió la identidad, no CSS.
 *
 * `pageOf` es la frase traducida con `{page}` y `{pages}` donde van los números.
 */
export function pageFooterCss(footer: string | null, pageOf: string): string {
  const numbers = pageOf
    .split(/(\{pages?\})/)
    .filter((part) => part !== '')
    .map((part) =>
      part === '{page}' ? 'counter(page)' : part === '{pages}' ? 'counter(pages)' : cssString(part),
    )
    .join(' ');
  const box = 'font: 9px/1.3 system-ui, sans-serif; color: #4a5266;';
  const left = footer?.trim()
    ? `@bottom-left { content: ${cssString(footer.trim())}; ${box} }`
    : '';

  return `@media print { @page { ${left} @bottom-right { content: ${numbers}; ${box} } } }`;
}

function cssString(text: string): string {
  return `"${text.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`;
}

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
 * - Numera las hojas y pone en su pie el texto de la identidad, si la hay.
 *
 * Con identidad, la primera hoja empieza con el mismo encabezado que el
 * tablero, y cada página siguiente del tablero —que empieza en hoja nueva—
 * con una franja reducida de logo y nombre.
 */
@Component({
  selector: 'app-report-print',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ReportChart, ReportIdentityHeader, TranslatePipe],
  templateUrl: './report-print.html',
  styleUrl: './report-print.scss',
  host: {
    // La marca en su tono claro: la vista cuelga de <body>, fuera del tablero que la pone.
    '[style.--rc-brand-light]': 'brandColor()',
  },
})
export class ReportPrint implements AfterViewInit, OnDestroy {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _i18n = inject(I18nService);

  readonly title = input.required<string>();
  readonly filters = input.required<readonly ExportFilter[]>();
  /** Fecha de generación, ya escrita en el idioma de la interfaz. */
  readonly generatedAt = input.required<string>();
  readonly pages = input.required<readonly PrintPage[]>();
  /** Cómo se escribe «Datos del…» de cada panel. */
  readonly capturedAt = input.required<(iso: string) => string>();
  readonly notes = input.required<(view: PanelView) => readonly string[]>();
  /** La empresa del tablero, si tiene identidad. */
  readonly identity = input<ReportIdentity | null>(null);
  /** El color de marca en su tono para el tema claro, que es el del papel. */
  readonly brandColor = input<string | null>(null);

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

  private readonly _pageStyle = document.createElement('style');

  /** Sin texto de pie, el pie dice el nombre de la empresa, como en el Excel. */
  private readonly writePageStyle = effect(() => {
    const identity = this.identity();
    const footer = identity ? identity.footer?.trim() || identity.name : null;

    this._pageStyle.textContent = pageFooterCss(
      footer,
      this._i18n.t('reports.export.pageOf', { page: '{page}', pages: '{pages}' }),
    );
  });

  constructor() {
    this._pageStyle.id = PAGE_FOOTER_STYLE;
    document.head.append(this._pageStyle);
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
    this._pageStyle.remove();

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
