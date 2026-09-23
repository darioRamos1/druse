import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Las filas de la miniatura de la cuadrícula.
 *
 * Datos de mentira pero de todos los tipos que tienen color propio, para que
 * cada ajuste se vea en algún sitio de la miniatura.
 */
const GRID_PREVIEW_ROWS: readonly (readonly (string | null)[])[] = [
  ['1', 'Ana Ruiz', '2026-03-14 09:12', 'true', null],
  ['2', 'Luis Pardo', '2026-05-02 17:40', 'false', 'VIP'],
  ['3', 'Marta Gil', null, 'true', 'Madrid'],
];

/** El tipo de cada columna de la miniatura, que es lo que decide su color. */
const GRID_PREVIEW_KINDS = ['number', 'text', 'timestamp', 'boolean', 'text'] as const;

/**
 * Miniatura de la cuadrícula de resultados, para las preferencias.
 *
 * No recibe los colores: lee las mismas variables que la cuadrícula de verdad,
 * así que se actualiza sola en cuanto se escribe una. Va aparte del diálogo
 * porque copia a mano las reglas de la cuadrícula, y dentro de él empujaba su
 * hoja de estilos por encima del presupuesto por componente.
 */
@Component({
  selector: 'app-grid-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './grid-preview.html',
  styleUrl: './grid-preview.scss',
})
export class GridPreview {
  /** Lo que dice de ella un lector de pantalla; llega ya traducido. */
  readonly label = input.required<string>();

  protected readonly rows = GRID_PREVIEW_ROWS;
  protected readonly kinds = GRID_PREVIEW_KINDS;
}
