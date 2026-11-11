import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { formatNumber } from '../../../core/i18n/locale-format';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ReportColumn, ReportValue, ReportVisualKind } from '../../../shared/models/reports';
import { Indicator, Series, isNumericColumn } from '../report-chart';

/** Medidas del lienzo en unidades del viewBox; el SVG escala al ancho disponible. */
const WIDTH = 720;
const HEIGHT = 300;
const LEFT = 64;
const RIGHT = 16;
const TOP = 20;
const BOTTOM = 56;

interface Tick {
  readonly y: number;
  readonly label: string;
}

/** Un escalón «redondo» (1, 2, 2,5 o 5 por potencia de diez) para el eje. */
function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;

  return nice * power;
}

/**
 * Pinta un reporte: tabla, barras, línea o indicador.
 *
 * Solo dibuja lo que recibe ya calculado (`report-chart.ts`): así las cifras se
 * prueban sin navegador y esto se ocupa solo de que se lean bien en claro y en
 * oscuro. Las barras y la línea llevan sus valores escritos y una tabla
 * equivalente a un clic: el color nunca es la única señal.
 */
@Component({
  selector: 'app-report-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, TranslatePipe],
  templateUrl: './report-chart.html',
  styleUrl: './report-chart.scss',
})
export class ReportChart {
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

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly left = LEFT;
  protected readonly bottom = HEIGHT - BOTTOM;

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
      ticks.push({ y: this.y(value), label: formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 }) });
    }

    return ticks;
  });

  /** Ancho de cada hueco del eje de categorías. */
  protected readonly slot = computed(() => (WIDTH - LEFT - RIGHT) / Math.max(this.points().length, 1));

  protected readonly bars = computed(() => {
    const slot = this.slot();
    const width = Math.max(Math.min(slot * 0.62, 56), 3);
    const zero = this.y(0);

    return this.points().map((point, index) => {
      const y = this.y(point.value);

      return {
        x: LEFT + slot * index + (slot - width) / 2,
        center: LEFT + slot * index + slot / 2,
        y: Math.min(y, zero),
        width,
        height: Math.max(Math.abs(zero - y), 1),
        label: point.label,
        value: point.value,
      };
    });
  });

  protected readonly linePath = computed(() =>
    this.bars()
      .map((bar, index) => `${index === 0 ? 'M' : 'L'}${bar.center.toFixed(1)} ${this.y(bar.value).toFixed(1)}`)
      .join(' '),
  );

  /** Con muchas categorías las etiquetas se inclinan y se dejan de escribir los valores. */
  protected readonly crowded = computed(() => this.points().length > 12);
  protected readonly zeroY = computed(() => this.y(0));

  protected y(value: number): number {
    const { top, floor } = this._scale();

    return TOP + ((top - value) / (top - floor || 1)) * (HEIGHT - TOP - BOTTOM);
  }

  protected number(value: number | null): string {
    return value === null ? '—' : formatNumber(value, { maximumFractionDigits: 2 });
  }

  protected percent(value: number | null): string {
    return value === null ? '—' : formatNumber(value, { style: 'percent', maximumFractionDigits: 1 });
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

    return typeof value === 'number' ? formatNumber(value, { maximumFractionDigits: 10 }) : String(value);
  }

  protected isNumeric(column: ReportColumn): boolean {
    return isNumericColumn(column);
  }
}
