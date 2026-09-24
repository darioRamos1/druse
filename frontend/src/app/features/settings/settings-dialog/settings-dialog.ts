import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { FileSaveService } from '../../../core/files/file-save.service';
import { I18nService, LocaleOption } from '../../../core/i18n/i18n.service';
import { Locale } from '../../../core/i18n/locale';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ThemeService } from '../../../core/theme/theme.service';
import {
  BackgroundFit,
  BackgroundTarget,
  EditorBackground,
  DEFAULT_APPEARANCE,
  DEFAULT_BACKGROUND,
  EDITOR_FONT_SIZES,
  GRID_FONT_SIZES,
  GridAppearance,
  GridColorKey,
  MAX_BACKGROUND_OPACITY,
  MAX_BACKGROUND_SCALE,
  MAX_SCALE,
  MIN_BACKGROUND_SCALE,
  MIN_SCALE,
  ThemeName,
  isDefaultGrid,
} from '../../../core/theme/appearance';
import { Icon } from '../../../shared/ui/icon/icon';
import { GridPreview } from '../grid-preview/grid-preview';
import { UpdateService } from '../../../core/update/update.service';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';
import { DialogBackdrop } from '../../../shared/a11y/dialog-backdrop';
import { PrivacyNotice } from '../../../shared/privacy/privacy-notice';
import { formatDate } from '../../../core/i18n/locale-format';
import { RELEASE_NOTES } from '../../../core/whats-new/release-notes';

/**
 * Colores de acento propuestos.
 *
 * Existen porque un selector de color en blanco es una pregunta difícil: casi
 * nadie sabe qué azul quiere hasta que lo ve al lado de otros. El primero es el
 * del mockup, así que la lista siempre incluye el punto de partida.
 */
const ACCENTS: readonly { readonly name: string; readonly value: string }[] = [
  { name: 'settings.color.indigo', value: '#6c8bff' },
  { name: 'settings.color.violet', value: '#9a7cff' },
  { name: 'settings.color.turquoise', value: '#2fb8b0' },
  { name: 'settings.color.green', value: '#3ddc97' },
  { name: 'settings.color.amber', value: '#f0b429' },
  { name: 'settings.color.coral', value: '#f2686b' },
  { name: 'settings.color.pink', value: '#f472b6' },
];

/**
 * Tintes del decorado.
 *
 * Son los mismos matices que los acentos pero muy poco saturados, porque lo que
 * se tiñe aquí es el fondo de toda la ventana: al 30 % de saturación un azul es
 * un panel azulado, y al 90 % es una pantalla de discoteca.
 */
const TINTS: readonly { readonly name: string; readonly value: string }[] = [
  { name: 'settings.color.neutral', value: '#808080' },
  { name: 'settings.color.blue', value: '#5b7bb8' },
  { name: 'settings.color.violet', value: '#7f6fb0' },
  { name: 'settings.color.green', value: '#5b9c7f' },
  { name: 'settings.color.sand', value: '#a89272' },
  { name: 'settings.color.plum', value: '#a3708f' },
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

/**
 * La zona donde queda un encuadre, para elegir su frase.
 *
 * Solo la zona: la frase entera sale del catálogo. Antes se armaba aquí con
 * trozos —«pegada a» + «la izquierda»—, y eso no se puede traducir.
 */
function corner(x: number, y: number): { h: string; v: string } {
  return {
    h: x < 34 ? 'left' : x > 66 ? 'right' : 'center',
    v: y < 34 ? 'top' : y > 66 ? 'bottom' : 'middle',
  };
}

const FITS: readonly {
  readonly value: BackgroundFit;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: 'cover',
    label: 'settings.background.fit.cover',
    hint: 'settings.background.fit.coverHint',
  },
  {
    value: 'contain',
    label: 'settings.background.fit.contain',
    hint: 'settings.background.fit.containHint',
  },
  {
    value: 'tile',
    label: 'settings.background.fit.tile',
    hint: 'settings.background.fit.tileHint',
  },
  {
    value: 'scale',
    label: 'settings.background.fit.scale',
    hint: 'settings.background.fit.scaleHint',
  },
];

/**
 * Los colores de la cuadrícula, con el token del tema que usan si nadie elige.
 *
 * El token hace falta para enseñar en el selector el color de partida: un
 * selector de color no puede estar vacío, y abrirlo en negro haría creer que
 * ese es el que hay puesto.
 */
const GRID_COLORS: readonly {
  readonly key: GridColorKey;
  readonly label: string;
  readonly token: string;
}[] = [
  {
    key: 'headerBackground',
    label: 'settings.grid.color.headerBackground',
    token: '--dr-surface-grid-header',
  },
  { key: 'headerText', label: 'settings.grid.color.headerText', token: '--dr-text-tertiary' },
  { key: 'lines', label: 'settings.grid.color.lines', token: '--dr-border-input' },
  { key: 'text', label: 'settings.grid.color.text', token: '--dr-text-muted' },
  { key: 'number', label: 'settings.grid.color.number', token: '--dr-info' },
  { key: 'timestamp', label: 'settings.grid.color.timestamp', token: '--dr-text-tertiary' },
  { key: 'boolean', label: 'settings.grid.color.boolean', token: '--dr-success' },
  { key: 'null', label: 'settings.grid.color.null', token: '--dr-text-disabled' },
];

/** Lee el color que da un token del tema, en el hexadecimal que pide el selector. */
function resolveToken(token: string): string {
  try {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    probe.style.display = 'none';
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();

    const [r, g, b] = (value.match(/[\d.]+/g) ?? []).map(Number);

    return [r, g, b].every(Number.isFinite)
      ? '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
      : '#808080';
  } catch {
    return '#808080';
  }
}

export type SettingsSection = 'appearance' | 'editor' | 'results' | 'privacy' | 'whatsNew' | 'about';

/** Preferencias agrupadas por lo que se quiere ajustar. */
@Component({
  selector: 'app-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogBackdrop, DialogFocus, GridPreview, Icon, PrivacyNotice, TranslatePipe],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss',
})
export class SettingsDialog {
  /** La sección con la que se abre; tras una actualización, las novedades. */
  readonly initialSection = input<SettingsSection>('appearance');

  protected readonly section = linkedSignal<SettingsSection>(() => this.initialSection());
  protected readonly sections: readonly { id: SettingsSection; label: string }[] = [
    { id: 'appearance', label: 'settings.section.appearance' },
    { id: 'editor', label: 'settings.section.editor' },
    { id: 'results', label: 'settings.section.results' },
    { id: 'privacy', label: 'settings.section.privacy' },
    { id: 'whatsNew', label: 'settings.section.whatsNew' },
    { id: 'about', label: 'settings.section.about' },
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
  private readonly _i18n = inject(I18nService);

  protected readonly locale = this._i18n.locale;

  /** Los idiomas que se pueden elegir; llegan en cuanto se leen sus catálogos. */
  protected readonly locales = signal<readonly LocaleOption[]>([]);

  /** El elegido, si está a medias: se avisa de qué pasa con lo que falta. */
  protected readonly incompleteLocale = computed(
    () => this.locales().find((option) => option.id === this.locale() && !option.complete) ?? null,
  );

  protected setLocale(locale: Locale): void {
    void this._i18n.setLocale(locale);
  }
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
            ? this._i18n.t('settings.diagnostics.savedAt', { path: resultado.path })
            : this._i18n.t('settings.diagnostics.savedDownloads')
          : null,
      );
    } catch {
      this.diagnosticsMessage.set(this._i18n.t('settings.diagnostics.failed'));
    } finally {
      this.savingDiagnostics.set(false);
    }
  }

  constructor() {
    void this.updates.initialize();
    void this._i18n.options().then((options) => this.locales.set(options));
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
  protected readonly gridProblem = signal<string | null>(null);
  protected readonly choosingBackground = signal(false);

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

  protected async chooseBackground(target: BackgroundTarget = 'editor'): Promise<void> {
    if (this.choosingBackground()) return;
    const problem = target === 'editor' ? this.problem : this.gridProblem;
    problem.set(null);
    this.choosingBackground.set(true);

    try {
      await this._themes.chooseBackground(target);
    } catch (error) {
      problem.set(
        error instanceof Error ? error.message : this._i18n.t('settings.background.unusable'),
      );
    } finally {
      this.choosingBackground.set(false);
    }
  }

  protected clearBackground(target: BackgroundTarget = 'editor'): void {
    (target === 'editor' ? this.problem : this.gridProblem).set(null);
    void this._themes.clearBackground(target);
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

  protected readonly grid = computed(() => this.appearance().grid);
  protected readonly gridFontSizes = GRID_FONT_SIZES;
  protected readonly gridColors = GRID_COLORS;
  protected readonly gridCustomized = computed(() => !isDefaultGrid(this.grid()));

  /**
   * El color que enseña cada selector: el elegido, o el que pone el tema.
   *
   * Depende del tema y del tono porque los dos cambian lo que resuelve el token;
   * leerlo una sola vez dejaría el selector con el color del tema de antes.
   */
  protected readonly gridColorValues = computed(() => {
    this.theme();
    this.appearance().tint;
    const colors = this.grid().colors;

    return Object.fromEntries(
      GRID_COLORS.map(({ key, token }) => [key, colors[key] ?? resolveToken(token)]),
    ) as Record<GridColorKey, string>;
  });

  protected setGrid(changes: Partial<GridAppearance>): void {
    void this._themes.update({ grid: { ...this.grid(), ...changes } });
  }

  /** `null` devuelve ese color al del tema. */
  protected setGridColor(key: GridColorKey, value: string | null): void {
    this.setGrid({ colors: { ...this.grid().colors, [key]: value } });
  }

  protected resetGrid(): void {
    this.gridProblem.set(null);
    void this._themes.resetGrid();
  }

  protected setGridBackground(changes: Partial<EditorBackground>): void {
    const background = this.grid().background;
    if (background) this.setGrid({ background: { ...background, ...changes } });
  }

  protected centerGridBackground(): void {
    const { scale, x, y } = DEFAULT_BACKGROUND;
    this.setGridBackground({ scale, x, y });
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

    const position = this._i18n.t(
      'settings.background.position',
      corner(background.x, background.y),
    );

    return this._i18n.t('settings.background.framing', {
      fit: background.fit,
      scale: background.scale,
      position,
    });
  });

  /**
   * La variante, por su identificador y no por la etiqueta que manda la
   * aplicación de escritorio: esa llega en español.
   *
   * i18n-keys: settings.about.variant.*
   */
  protected readonly variantLabel = computed(() => {
    const info = this.updates.info();
    const key = `settings.about.variant.${info?.variant ?? ''}`;

    return this._i18n.has(key) ? this._i18n.t(key) : (info?.variantLabel ?? '');
  });

  /** En el navegador no hay versión instalada: se dice que es la de desarrollo. */
  protected readonly appVersion = computed(() => {
    const info = this.updates.info();

    return info?.variant === 'web'
      ? this._i18n.t('settings.about.devVersion')
      : (info?.version ?? '');
  });

  /**
   * Por qué no hay actualizaciones. En el navegador lo dice la interfaz; en la
   * aplicación de escritorio lo manda Rust, todavía en español (fase 2).
   */
  protected readonly disabledReason = computed(() => {
    const info = this.updates.info();

    return info?.variant === 'web'
      ? this._i18n.t('settings.about.webUpdates')
      : (info?.updatesDisabledReason ?? '');
  });

  /**
   * Lo que trajo cada versión, con la fecha en el idioma elegido.
   *
   * La fecha se lee a mediodía: a medianoche en UTC, al oeste de Greenwich se
   * pintaría el día anterior.
   */
  protected readonly releaseNotes = computed(() => {
    this.locale();

    return RELEASE_NOTES.map((note) => ({
      ...note,
      dateLabel: formatDate(`${note.date}T12:00:00`, { dateStyle: 'long' }),
    }));
  });

  /** Los dos párrafos de la licencia, con sus nombres de archivo dentro. */
  protected readonly licenseGrant = computed(() =>
    this._i18n.tParts('settings.license.grant', { copyright: 'api/COPYRIGHT-Druse.txt' }),
  );

  protected readonly licenseWarranty = computed(() =>
    this._i18n.tParts('settings.license.warranty', {
      license: 'api/LICENSE-Druse.txt',
      url: 'https://www.gnu.org/licenses/gpl-3.0.html',
      notices: 'api/THIRD_PARTY_NOTICES-Druse.md',
    }),
  );

  /** Si hay algo que restablecer; sin esto el botón mentiría estando siempre activo. */
  protected readonly customized = computed(() => {
    const appearance = this.appearance();

    return !!(
      appearance.accent ||
      appearance.tint ||
      appearance.background ||
      !isDefaultGrid(appearance.grid) ||
      appearance.scale !== DEFAULT_APPEARANCE.scale ||
      appearance.editorFontSize !== DEFAULT_APPEARANCE.editorFontSize
    );
  });
}
