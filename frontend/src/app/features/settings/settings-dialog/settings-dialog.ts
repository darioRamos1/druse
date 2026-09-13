import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { FileSaveService } from '../../../core/files/file-save.service';
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
import { UpdateService } from '../../../core/update/update.service';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';
import { DialogBackdrop } from '../../../shared/a11y/dialog-backdrop';

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

/**
 * El SQL de mentira de la miniatura.
 *
 * Anchos y clases inventados a mano en vez de texto de verdad: lo que hay que
 * juzgar es si el color se distingue del fondo, y para eso una barra dice lo
 * mismo que una palabra sin obligar a traducir nada ni a elegir una consulta de
 * ejemplo que después no se parezca a la del usuario.
 */
interface PreviewToken {
  readonly kind: string;
  /** Ancho en porcentaje de la línea, para que parezca código y no un pentagrama. */
  readonly width: number;
}

const PREVIEW_LINES: readonly (readonly PreviewToken[])[] = [
  [
    { kind: 'keyword', width: 16 },
    { kind: 'name', width: 12 },
    { kind: 'name', width: 18 },
    { kind: 'call', width: 14 },
  ],
  [
    { kind: 'keyword', width: 11 },
    { kind: 'name', width: 26 },
  ],
  [
    { kind: 'keyword', width: 14 },
    { kind: 'name', width: 15 },
    { kind: 'string', width: 10 },
    { kind: 'keyword', width: 8 },
    { kind: 'number', width: 9 },
  ],
  [{ kind: 'comment', width: 34 }],
];

/** Traduce un encuadre a la esquina —o el centro— donde queda. */
function corner(x: number, y: number): string {
  const horizontal = x < 34 ? 'la izquierda' : x > 66 ? 'la derecha' : 'el centro';
  const vertical = y < 34 ? 'arriba' : y > 66 ? 'abajo' : 'el medio';

  if (horizontal === 'el centro' && vertical === 'el medio') {
    return 'centrada';
  }

  if (horizontal === 'el centro') {
    return `${vertical === 'arriba' ? 'arriba' : 'abajo'} del todo`;
  }

  if (vertical === 'el medio') {
    return `pegada a ${horizontal}`;
  }

  return `${vertical} a ${horizontal}`;
}

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

type SettingsSection = 'appearance' | 'editor' | 'about';

/** Preferencias agrupadas por lo que se quiere ajustar. */
@Component({
  selector: 'app-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogBackdrop, DialogFocus, Icon],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss',
})
export class SettingsDialog {
  protected readonly section = signal<SettingsSection>('appearance');
  protected readonly sections: readonly { id: SettingsSection; label: string }[] = [
    { id: 'appearance', label: 'Apariencia' },
    { id: 'editor', label: 'Editor' },
    { id: 'about', label: 'Acerca de' },
  ];
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  protected selectSection(section: SettingsSection): void {
    this.section.set(section);
    const body = this.body()?.nativeElement;
    if (body) body.scrollTop = 0;
  }

  protected onSectionKeydown(event: KeyboardEvent, index: number): void {
    const count = this.sections.length;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % count
            : event.key === 'ArrowLeft'
              ? (index - 1 + count) % count
              : null;
    if (next === null) return;
    event.preventDefault();
    this.selectSection(this.sections[next].id);
    (event.currentTarget as HTMLElement).parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }

  private readonly _themes = inject(ThemeService);
  protected readonly updates = inject(UpdateService);

  private readonly _gateway = inject(ApplicationGateway);
  private readonly _files = inject(FileSaveService);

  protected readonly savingDiagnostics = signal(false);
  protected readonly diagnosticsMessage = signal<string | null>(null);

  /**
   * Pide el paquete de diagnóstico y lo guarda donde diga el usuario.
   *
   * Se dice **dónde quedó**, por lo mismo que al exportar un resultado: sin la
   * ruta, «guardado» no ayuda a encontrarlo, que es justo lo que hace falta para
   * poder adjuntarlo.
   */
  protected async saveDiagnostics(): Promise<void> {
    this.savingDiagnostics.set(true);
    this.diagnosticsMessage.set(null);

    try {
      const paquete = await firstValueFrom(this._gateway.getDiagnostics());
      const nombre = `druse-diagnostico-${new Date().toISOString().slice(0, 10)}.zip`;
      const resultado = await this._files.save(nombre, paquete);

      this.diagnosticsMessage.set(
        resultado.saved
          ? resultado.path
            ? `Guardado en ${resultado.path}`
            : 'Guardado en tus descargas.'
          : null,
      );
    } catch {
      this.diagnosticsMessage.set('No se pudo preparar el diagnóstico.');
    } finally {
      this.savingDiagnostics.set(false);
    }
  }

  constructor() {
    void this.updates.initialize();
  }

  /**
   * Activa o desactiva la búsqueda automática.
   *
   * Es el único ajuste de esta ventana que cambia si Druse abre una conexión por
   * su cuenta, y por eso se aplica en cuanto se marca: dejarlo pendiente de un
   * botón «Aplicar» dejaría la duda de si llegó a valer.
   *
   * Sale por un evento, como el resto de ajustes del área de trabajo: quien lo
   * recuerda es el store, no la ventana que lo enseña.
   */
  protected toggleAutoCheck(event: Event): void {
    this.autoUpdateCheckChange.emit((event.target as HTMLInputElement).checked);
  }

  /**
   * Proporción del editor de verdad.
   *
   * La miniatura la copia porque el recorte de una imagen depende de la forma
   * del hueco: una previsualización cuadrada de un editor apaisado enseñaría un
   * encuadre que después no se ve.
   */
  readonly editorRatio = input('16 / 9');

  /** Si Druse debe buscar actualizaciones al abrirse. */
  readonly autoUpdateCheckChange = output<boolean>();

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

  /** Líneas de código de mentira para la miniatura, con la pinta de una consulta. */
  protected readonly previewLines = PREVIEW_LINES;

  /**
   * Dónde queda la imagen, dicho con palabras.
   *
   * Dos porcentajes no se leen de un vistazo, y el encuadre es justo el ajuste
   * que uno hace mirando y no calculando.
   */
  protected readonly framing = computed(() => {
    const background = this.background();

    if (!background) {
      return '';
    }

    if (background.fit === 'tile') {
      return `Repetida al ${background.scale} %, desde ${corner(background.x, background.y)}`;
    }

    const size =
      background.fit === 'scale'
        ? `Al ${background.scale} %`
        : background.fit === 'contain'
          ? 'Entera'
          : 'Llenando el editor';

    return `${size}, ${corner(background.x, background.y)}`;
  });

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
