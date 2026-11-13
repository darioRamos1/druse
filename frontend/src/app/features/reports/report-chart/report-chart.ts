import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { formatNumber } from '../../../core/i18n/locale-format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ReportColumn, ReportValue, ReportVisualKind } from '../../../shared/models/reports';
import { Icon } from '../../../shared/ui/icon/icon';
import {
  DEFAULT_APPEARANCE,
  Indicator,
  PaletteColor,
  ReportAppearance,
  Series,
  formatFigure,
  indicatorStatus,
  isNumericColumn,
} from '../report-chart';
import { ChartColor } from '../report-dashboard-model';

/** Medidas del lienzo en unidades del viewBox; el SVG escala al ancho disponible. */
const WIDTH = 720;
const HEIGHT = 300;
const LEFT = 64;
const RIGHT = 16;
const TOP = 24;
const BOTTOM = 56;
/** Radio del extremo de datos de una barra: el de la base queda recto. */
const RADIUS = 4;

interface Tick {
  readonly y: number;
  readonly label: string;
}

interface Bar {
  readonly x: number;
  readonly center: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly path: string;
  readonly label: string | null;
  readonly value: number;
  readonly fill: string;
}

interface Tip {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly value: string;
}

/** Un escalón «redondo» (1, 2, 2,5 o 5 por potencia de diez) para el eje. */
function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;

  return nice * power;
}

/**
 * Una barra con el extremo de datos redondeado y la base recta, anclada al eje.
 * Las negativas se redondean abajo, que es donde está su dato.
 */
function barPath(x: number, top: number, width: number, height: number, negative: boolean): string {
  const r = Math.min(RADIUS, width / 2, height);
  const bottom = top + height;
  const right = x + width;

  return negative
    ? `M${x} ${top}H${right}V${bottom - r}Q${right} ${bottom} ${right - r} ${bottom}H${x + r}Q${x} ${bottom} ${x} ${bottom - r}Z`
    : `M${x} ${bottom}V${top + r}Q${x} ${top} ${x + r} ${top}H${right - r}Q${right} ${top} ${right} ${top + r}V${bottom}Z`;
}

/**
 * Pinta un reporte: tabla, barras, línea o indicador.
 *
 * Solo dibuja lo que recibe ya calculado (`report-chart.ts`): así las cifras se
 * prueban sin navegador y esto se ocupa de que se lean bien en claro y en
 * oscuro. El color nunca es la única señal: las barras llevan su categoría en
 * el eje, los valores se pueden escribir, hay una tabla equivalente y el
 * estado del indicador va con icono y texto.
 */
@Component({
  selector: 'app-report-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet, TranslatePipe],
  templateUrl: './report-chart.html',
  styleUrl: './report-chart.scss',
})
export class ReportChart {
  private readonly _i18n = inject(I18nService);

  readonly kind = input.required<ReportVisualKind>();
  readonly series = input<Series | null>(null);
  readonly indicator = input<Indicator | null>(null);
  readonly table = input<{
    readonly columns: readonly ReportColumn[];
    readonly rows: readonly (readonly ReportValue[])[];
  } | null>(null);
  /** Nombre de la cifra, para el texto alternativo y la cabecera de la tabla. */
  readonly valueLabel = input('');
  readonly categoryLabel = input('');
  /** Barras y línea como tabla, la alternativa accesible. */
  readonly asTable = input(false);
  /** Cómo enseñar el nombre de una columna (el alias de su fuente en vez de izquierda/derecha). */
  readonly columnLabel = input<(name: string) => string>((name) => name);
  /** Llenar el alto del contenedor (paneles del tablero) en vez de crecer con el ancho. */
  readonly fit = input(false);
  readonly appearance = input<ReportAppearance>(DEFAULT_APPEARANCE);
  /** El color ya resuelto (panel, reporte o tablero); `null` es el acento del tema. */
  readonly color = input<ChartColor | null>(null);
  /** Un color por categoría, estable aunque se filtre. */
  readonly categoryColors = input<ReadonlyMap<string | null, PaletteColor> | null>(null);
  /** Las barras se pueden pulsar para filtrar el tablero por su categoría. */
  readonly selectable = input(false);
  readonly selected = input<string | null | undefined>(undefined);

  /** Se pulsó una barra (o se activó con el teclado): su categoría. */
  readonly pick = output<string | null>();

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly left = LEFT;
  protected readonly bottom = HEIGHT - BOTTOM;
  protected readonly tip = signal<Tip | null>(null);

  protected readonly points = computed(() => this.series()?.points ?? []);

  private readonly _scale = computed(() => {
    const values = this.points().map((point) => point.value);
    const max = Math.max(0, ...values);
    const min = Math.min(0, ...values);
    const step = niceStep(Math.max(max - min, 1), 4);
    const top = Math.ceil(max / step) * step || step;
    const floor = Math.floor(min / step) * step;

    return { top, floor, step };
  });

  protected readonly ticks = computed<readonly Tick[]>(() => {
    const { top, floor, step } = this._scale();
    const ticks: Tick[] = [];

    for (let value = floor; value <= top + step / 2; value += step) {
      ticks.push({
        y: this.y(value),
        label: formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 }),
      });
    }

    return ticks;
  });

  /** Ancho de cada hueco del eje de categorías. */
  protected readonly slot = computed(
    () => (WIDTH - LEFT - RIGHT) / Math.max(this.points().length, 1),
  );

  /** El relleno de la serie: el color elegido o, si no hay, el acento del tema. */
  protected readonly seriesFill = computed(() => {
    const color = this.color();

    return color ? `var(--rc-${color})` : 'var(--dr-accent)';
  });

  protected readonly bars = computed<readonly Bar[]>(() => {
    const slot = this.slot();
    // Hueco de al menos 2 px entre barras vecinas, más en proporción si hay sitio.
    const width = Math.max(Math.min(slot * 0.62, 56, slot - 2), 2);
    const zero = this.y(0);
    const colors =
      this.kind() === 'Bar' && this.appearance().byCategory ? this.categoryColors() : null;

    return this.points().map((point, index) => {
      const y = this.y(point.value);
      const top = Math.min(y, zero);
      const height = Math.max(Math.abs(zero - y), 1);
      const x = LEFT + slot * index + (slot - width) / 2;
      const color = colors?.get(point.label);

      return {
        x,
        center: LEFT + slot * index + slot / 2,
        y: top,
        width,
        height,
        path: barPath(x, top, width, height, point.value < 0),
        label: point.label,
        value: point.value,
        fill: color ? `var(--rc-${color})` : this.seriesFill(),
      };
    });
  });

  protected readonly linePath = computed(() =>
    this.bars()
      .map(
        (bar, index) =>
          `${index === 0 ? 'M' : 'L'}${bar.center.toFixed(1)} ${this.y(bar.value).toFixed(1)}`,
      )
      .join(' '),
  );

  /** Con muchas categorías las etiquetas se inclinan y se dejan de escribir los valores. */
  protected readonly crowded = computed(() => this.points().length > 12);
  protected readonly showValues = computed(() => this.appearance().showValues && !this.crowded());
  protected readonly zeroY = computed(() => this.y(0));

  protected readonly status = computed(() => {
    const indicator = this.indicator();

    return indicator ? indicatorStatus(indicator, this.appearance()) : null;
  });

  protected y(value: number): number {
    const { top, floor } = this._scale();

    return TOP + ((top - value) / (top - floor || 1)) * (HEIGHT - TOP - BOTTOM);
  }

  /** Una cifra con el formato del reporte. */
  protected figure(value: number | null): string {
    return formatFigure(value, this.appearance(), formatNumber);
  }

  protected percent(value: number | null): string {
    return value === null
      ? '—'
      : formatNumber(value, { style: 'percent', maximumFractionDigits: 1 });
  }

  /** La barra de progreso del indicador se queda en el 100 % aunque se pase. */
  protected progress(ratio: number | null): number {
    return ratio === null ? 0 : Math.max(0, Math.min(ratio, 1)) * 100;
  }

  protected short(label: string | null, empty: string): string {
    const text = label ?? empty;

    return text.length > 14 ? `${text.slice(0, 13)}…` : text;
  }

  protected cell(value: ReportValue): string {
    if (value === null) {
      return 'NULL';
    }

    return typeof value === 'number'
      ? formatNumber(value, { maximumFractionDigits: 10 })
      : String(value);
  }

  protected isNumeric(column: ReportColumn): boolean {
    return isNumericColumn(column);
  }

  /** Una barra elegida resalta y las demás se apagan, sin cambiar de color. */
  protected dimmed(bar: Bar): boolean {
    const selected = this.selected();

    return selected !== undefined && bar.label !== selected;
  }

  protected isPicked(bar: Bar): boolean {
    return this.selected() !== undefined && bar.label === this.selected();
  }

  // --- Tooltip -------------------------------------------------------------------

  /**
   * El tooltip se coloca en porcentaje del lienzo: así sigue a la marca aunque
   * el SVG se escale al ancho del panel.
   */
  protected showTip(bar: Bar, y: number): void {
    this.tip.set({
      x: (bar.center / WIDTH) * 100,
      y: (y / HEIGHT) * 100,
      label: bar.label ?? this._i18n.t('reports.chart.empty'),
      value: this.figure(bar.value),
    });
  }

  protected hideTip(): void {
    this.tip.set(null);
  }

  protected choose(bar: Bar, event?: Event): void {
    if (!this.selectable()) {
      return;
    }

    event?.preventDefault();
    this.pick.emit(bar.label);
  }
}
