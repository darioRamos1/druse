import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';

import { ThemeService } from '../../../core/theme/theme.service';
import {
  BackgroundFit,
  DEFAULT_APPEARANCE,
  DEFAULT_BACKGROUND,
  EDITOR_FONT_SIZES,
  MAX_BACKGROUND_OPACITY,
  MAX_BACKGROUND_SCALE,
  MAX_SCALE,
  MIN_BACKGROUND_SCALE,
  MIN_SCALE,
  ThemeName,
} from '../../../core/theme/appearance';
import { Icon } from '../../../shared/ui/icon/icon';

/**
 * Colores de acento propuestos.
 *
 * Existen porque un selector de color en blanco es una pregunta difícil: casi
 * nadie sabe qué azul quiere hasta que lo ve al lado de otros. El primero es el
 * del mockup, así que la lista siempre incluye el punto de partida.
 */
const ACCENTS: readonly { readonly name: string; readonly value: string }[] = [
  { name: 'Índigo', value: '#6c8bff' },
  { name: 'Violeta', value: '#9a7cff' },
  { name: 'Turquesa', value: '#2fb8b0' },
  { name: 'Verde', value: '#3ddc97' },
  { name: 'Ámbar', value: '#f0b429' },
  { name: 'Coral', value: '#f2686b' },
  { name: 'Rosa', value: '#f472b6' },
];

/**
 * Tintes del decorado.
 *
 * Son los mismos matices que los acentos pero muy poco saturados, porque lo que
 * se tiñe aquí es el fondo de toda la ventana: al 30 % de saturación un azul es
 * un panel azulado, y al 90 % es una pantalla de discoteca.
 */
const TINTS: readonly { readonly name: string; readonly value: string }[] = [
  { name: 'Neutro', value: '#808080' },
  { name: 'Azul', value: '#5b7bb8' },
  { name: 'Violeta', value: '#7f6fb0' },
  { name: 'Verde', value: '#5b9c7f' },
  { name: 'Arena', value: '#a89272' },
  { name: 'Ciruela', value: '#a3708f' },
];

const FITS: readonly {
  readonly value: BackgroundFit;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: 'cover', label: 'Llenar', hint: 'Cubre el editor; recorta lo que sobra' },
  { value: 'contain', label: 'Encajar', hint: 'Enseña la imagen entera' },
  { value: 'tile', label: 'Repetir', hint: 'La usa como patrón' },
  { value: 'scale', label: 'Tamaño', hint: 'El tamaño lo decides tú' },
];

/**
 * Preferencias de la aplicación.
 *
 * Hoy solo tiene apariencia. Se hace como panel con secciones y no como un menú
 * suelto porque el formato del SQL y el tiempo máximo de ejecución viven en la
 * barra del editor, y acabarán aquí: lo que falta es que haya un aquí.
 */
@Component({
  selector: 'app-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss',
})
export class SettingsDialog {
  private readonly _themes = inject(ThemeService);

  readonly closed = output<void>();

  /** Qué salió mal al elegir una imagen, para decirlo donde se pidió. */
  protected readonly problem = signal<string | null>(null);

  protected readonly accents = ACCENTS;
  protected readonly tints = TINTS;
  protected readonly fits = FITS;
  protected readonly maxOpacity = MAX_BACKGROUND_OPACITY;
  protected readonly fontSizes = EDITOR_FONT_SIZES;
  protected readonly minScale = MIN_SCALE;
  protected readonly maxScale = MAX_SCALE;
  protected readonly minBackgroundScale = MIN_BACKGROUND_SCALE;
  protected readonly maxBackgroundScale = MAX_BACKGROUND_SCALE;

  protected readonly appearance = this._themes.appearance;
  protected readonly theme = this._themes.theme;

  /** El color que enseña el selector: el elegido, o el del tema si no hay ninguno. */
  protected readonly accentValue = computed(
    () => this.appearance().accent ?? (this.theme() === 'light' ? '#4a67e8' : '#6c8bff'),
  );

  protected readonly tintValue = computed(() => this.appearance().tint ?? '#5b7bb8');

  protected readonly background = computed(() => this.appearance().background);

  protected setTheme(theme: ThemeName): void {
    void this._themes.set(theme);
  }

  protected setAccent(accent: string): void {
    void this._themes.update({ accent });
  }

  protected setTint(tint: string): void {
    void this._themes.update({ tint });
  }

  /** Vuelve al color del tema, que no es lo mismo que elegir ese color. */
  protected clearAccent(): void {
    void this._themes.update({ accent: null });
  }

  protected clearTint(): void {
    void this._themes.update({ tint: null });
  }

  protected async chooseBackground(): Promise<void> {
    this.problem.set(null);

    try {
      await this._themes.chooseBackground();
    } catch (error) {
      this.problem.set(error instanceof Error ? error.message : 'No se pudo usar la imagen.');
    }
  }

  protected clearBackground(): void {
    this.problem.set(null);
    void this._themes.clearBackground();
  }

  protected setScale(value: string): void {
    const scale = Number.parseInt(value, 10);

    if (Number.isFinite(scale)) {
      void this._themes.update({ scale });
    }
  }

  protected setEditorFontSize(editorFontSize: number): void {
    void this._themes.update({ editorFontSize });
  }

  /**
   * Mueve el encuadre en un solo eje.
   *
   * Los dos controles llaman aquí con el otro eje en `null` para no pisarse: si
   * cada uno escribiera la posición entera, arrastrar el horizontal devolvería
   * el vertical a donde estaba al empezar.
   */
  protected setPosition(x: string | null, y: string | null): void {
    const background = this.background();

    if (!background) {
      return;
    }

    void this._themes.update({
      background: {
        ...background,
        x: x === null ? background.x : Number.parseInt(x, 10),
        y: y === null ? background.y : Number.parseInt(y, 10),
      },
    });
  }

  protected setBackgroundScale(value: string): void {
    const background = this.background();
    const scale = Number.parseInt(value, 10);

    if (background && Number.isFinite(scale)) {
      void this._themes.update({ background: { ...background, scale } });
    }
  }

  /** Deshace el encuadre sin quitar la imagen, para cuando uno se pierde arrastrando. */
  protected centerBackground(): void {
    const background = this.background();

    if (background) {
      void this._themes.update({
        background: {
          ...background,
          scale: DEFAULT_BACKGROUND.scale,
          x: DEFAULT_BACKGROUND.x,
          y: DEFAULT_BACKGROUND.y,
        },
      });
    }
  }

  protected setOpacity(value: string): void {
    const background = this.background();
    const opacity = Number.parseInt(value, 10);

    if (background && Number.isFinite(opacity)) {
      void this._themes.update({ background: { ...background, opacity } });
    }
  }

  protected setFit(fit: BackgroundFit): void {
    const background = this.background();

    if (background) {
      void this._themes.update({ background: { ...background, fit } });
    }
  }

  protected reset(): void {
    this.problem.set(null);
    void this._themes.reset();
  }

  /** Si hay algo que restablecer; sin esto el botón mentiría estando siempre activo. */
  protected readonly customized = computed(() => {
    const appearance = this.appearance();

    return !!(
      appearance.accent ||
      appearance.tint ||
      appearance.background ||
      appearance.scale !== DEFAULT_APPEARANCE.scale ||
      appearance.editorFontSize !== DEFAULT_APPEARANCE.editorFontSize
    );
  });
}
