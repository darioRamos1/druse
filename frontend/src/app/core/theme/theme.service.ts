import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../application-gateway/application-gateway';
import { DesktopHost } from '../application-gateway/desktop-host';
import {
  Appearance,
  BackgroundTarget,
  DEFAULT_APPEARANCE,
  DEFAULT_BACKGROUND,
  DEFAULT_GRID,
  GRID_VARIABLES,
  ThemeName,
  appearancePreferences,
  appearanceVariables,
  backgroundStyle,
  parseAppearance,
} from './appearance';
import { EditorBackgroundStore } from './editor-background.store';

export { DEFAULT_THEME, parseTheme, type Appearance, type ThemeName } from './appearance';

/** Cómo se guarda el tema en la base local. Es el contrato con las preferencias. */
export const THEME_PREFERENCE = 'ui.theme';

/**
 * Dónde se copia la apariencia en el navegador.
 *
 * La preferencia de verdad vive en el servidor, pero llega por HTTP y eso es
 * tarde: para entonces ya se ha pintado la primera ventana. Esta copia es lo
 * único que hay disponible antes del primer fotograma.
 */
const APPEARANCE_CACHE_KEY = 'druse.appearance';

/** Todo lo que la personalización puede llegar a escribir, para poder retirarlo. */
const CUSTOMIZABLE = [
  '--dr-accent-rgb',
  '--dr-accent-bright-rgb',
  '--dr-accent-deep-rgb',
  '--dr-accent-alt-rgb',
  '--dr-accent-gradient',
  '--dr-text-on-accent',
  '--dr-hue',
  '--dr-sat-scale',
  ...GRID_VARIABLES,
];

/** Las que pinta la imagen de fondo del editor, que se ponen y se quitan aparte. */
const backgroundVariables = (target: BackgroundTarget) =>
  ['', '-size', '-repeat', '-position', '-opacity'].map(
    (suffix) => `--dr-${target}-background${suffix}`,
  );

/**
 * Escribe la apariencia en el documento.
 *
 * El tema va como atributo en `<html>` y lo personalizado como variables encima,
 * las dos cosas ahí arriba: el fondo de la página y el color de las barras de
 * desplazamiento se resuelven fuera de cualquier componente de Angular.
 *
 * Las variables se limpian antes de escribir las nuevas. Sin eso, quitar un
 * color personalizado no lo devolvería al del tema: se quedaría el último que se
 * escribió, porque un estilo en línea gana a la hoja de estilos.
 */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  const variables = appearanceVariables(appearance);

  root.dataset['theme'] = appearance.theme;

  for (const name of CUSTOMIZABLE) {
    root.style.removeProperty(name);
  }

  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
}

/**
 * La apariencia recordada en esta máquina.
 *
 * Se consulta antes de arrancar Angular. `localStorage` puede fallar —un WebView
 * sin almacenamiento, un navegador con las cookies cerradas—, y quedarse sin
 * apariencia recordada no puede impedir que la aplicación abra.
 */
export function cachedAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_CACHE_KEY);

    if (!raw) {
      return DEFAULT_APPEARANCE;
    }

    const cached = JSON.parse(raw) as Partial<Appearance>;

    // La cuadrícula se fusiona aparte: una copia de antes de que existiera no la
    // trae, y una a medias no puede dejar la letra sin tamaño.
    return {
      ...DEFAULT_APPEARANCE,
      ...cached,
      grid: {
        ...DEFAULT_GRID,
        ...cached.grid,
        colors: { ...DEFAULT_GRID.colors, ...cached.grid?.colors },
      },
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function remember(appearance: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(appearance));
  } catch {
    // Sin copia local solo se pierde el arranque sin parpadeo, no el ajuste.
  }
}

/**
 * Qué aspecto tiene la aplicación, y cómo se recuerda.
 *
 * Es el único dueño de lo que se escribe en `<html>`: tema, colores y fondo del
 * editor salen todos de aquí. Repartirlo en varios servicios acabaría con dos
 * pisándose las mismas variables sin saberlo.
 *
 * Las preferencias se guardan en el servidor como las demás, para que acompañen
 * al usuario y no al navegador. La copia en `localStorage` no es la fuente: solo
 * evita que la aplicación abra con un aspecto y salte a otro medio segundo
 * después, que es lo que pasaría esperando a la respuesta de la API.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _desktop = inject(DesktopHost);
  private readonly _backgrounds = inject(EditorBackgroundStore);
  private readonly backgroundRevision: Record<BackgroundTarget, number> = { editor: 0, grid: 0 };

  private readonly _appearance = signal<Appearance>(cachedAppearance());
  readonly appearance = this._appearance.asReadonly();

  /** Atajo al tema, que es lo que mira media aplicación. */
  readonly theme = computed<ThemeName>(() => this._appearance().theme);

  constructor() {
    // Normalmente ya lo aplicó el arranque. Repetirlo aquí cubre el caso de que
    // el servicio se cree en otro contexto —una prueba, otro punto de entrada—
    // sin que llegue a escribirse nunca. El marco de la ventana, en cambio, no
    // lo ha tocado nadie todavía: lo pone siempre este primer paso.
    applyAppearance(this._appearance());
    void this._desktop.setWindowTheme(this.theme());
    void this.restoreBackground();
    void this.restoreBackground('grid');
  }

  /**
   * Adopta la apariencia que venía en las preferencias del servidor.
   *
   * Recibe el mapa entero en lugar de pedirlo él mismo para no repetir la
   * llamada que el área de trabajo ya hace al arrancar.
   */
  adopt(preferences: Readonly<Record<string, string>>): void {
    // Lo que el servidor no traiga se queda como está: puede que sea la primera
    // vez que se arranca contra esta base, y lo elegido hace un momento no puede
    // perderse por eso.
    this.apply(parseAppearance(preferences, this._appearance()));
    void this.restoreBackground();
    void this.restoreBackground('grid');
  }

  /** Cambia el tema. Se conserva lo demás: los colores elegidos valen para los dos. */
  set(theme: ThemeName): Promise<void> {
    return this.update({ theme });
  }

  /** Alterna entre los dos, para el conmutador de la barra. */
  toggle(): Promise<void> {
    return this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  /**
   * Cambia uno o varios ajustes de aspecto.
   *
   * Se guarda solo lo que cambió: escribir las seis claves en cada arrastre de
   * un control de color llenaría la base local de escrituras para no decir nada
   * nuevo.
   */
  async update(changes: Partial<Appearance>): Promise<void> {
    const previous = this._appearance();
    const next = { ...previous, ...changes };

    if (JSON.stringify(previous) === JSON.stringify(next)) {
      return;
    }

    this.apply(next);

    const before = appearancePreferences(previous);
    const after = appearancePreferences(next);

    try {
      await Promise.all(
        Object.entries(after)
          .filter(([key, value]) => before[key] !== value)
          .map(([key, value]) => firstValueFrom(this._gateway.setPreference(key, value))),
      );
    } catch {
      // El aspecto ya está aplicado y recordado en esta máquina. No poder
      // guardarlo en el servidor no justifica un aviso por un cambio de color.
    }
  }

  /** Devuelve la apariencia a la del tema, sin tocar el tema elegido. */
  async reset(): Promise<void> {
    this.backgroundRevision.editor++;
    this.backgroundRevision.grid++;
    await this._backgrounds.forget();
    await this._backgrounds.forget('grid');
    await this.update({
      accent: null,
      tint: null,
      background: null,
      scale: DEFAULT_APPEARANCE.scale,
      editorFontSize: DEFAULT_APPEARANCE.editorFontSize,
      grid: DEFAULT_GRID,
    });
    this.paintBackground(null);
    this.paintBackground(null, 'grid');
  }

  async resetGrid(): Promise<void> {
    await this.clearBackground('grid');
    await this.update({ grid: DEFAULT_GRID });
  }

  /**
   * Pone una imagen de fondo en el editor.
   *
   * La imagen no viaja a las preferencias: son texto en una base que se lee
   * entera en cada arranque, y meterle un archivo en base64 haría lento algo que
   * hoy es instantáneo. Se queda donde la deje el almacén y aquí solo se guarda
   * cómo se ve.
   */
  async chooseBackground(target: BackgroundTarget = 'editor'): Promise<boolean> {
    const revision = ++this.backgroundRevision[target];
    const chosen = await this._backgrounds.choose(target);

    if (!chosen || revision !== this.backgroundRevision[target]) {
      return false;
    }

    const previous = this.getBackground(target);

    await this.update(
      this.backgroundChange(target, {
        // Si ya había una imagen, la nueva hereda cómo estaba puesta: cambiar la
        // foto no es motivo para volver a encuadrar.
        ...DEFAULT_BACKGROUND,
        ...previous,
        name: chosen.name,
      }),
    );

    if (revision === this.backgroundRevision[target]) this.paintBackground(chosen.source, target);

    return true;
  }

  async clearBackground(target: BackgroundTarget = 'editor'): Promise<void> {
    this.backgroundRevision[target]++;
    await this._backgrounds.forget(target);
    await this.update(this.backgroundChange(target, null));
    this.paintBackground(null, target);
  }

  private getBackground(target: BackgroundTarget) {
    return target === 'editor' ? this._appearance().background : this._appearance().grid.background;
  }

  private backgroundChange(
    target: BackgroundTarget,
    background: Appearance['background'],
  ): Partial<Appearance> {
    return target === 'editor'
      ? { background }
      : { grid: { ...this._appearance().grid, background } };
  }

  /** Vuelve a colgar la imagen guardada, si la hay. */
  private async restoreBackground(target: BackgroundTarget = 'editor'): Promise<void> {
    const revision = ++this.backgroundRevision[target];
    if (!this.getBackground(target)) {
      this.paintBackground(null, target);
      return;
    }

    try {
      const source = await this._backgrounds.load(target);
      if (revision === this.backgroundRevision[target]) this.paintBackground(source, target);
    } catch {
      if (revision === this.backgroundRevision[target]) this.paintBackground(null, target);
    }
  }

  private paintBackground(source: string | null, target: BackgroundTarget = 'editor'): void {
    const root = document.documentElement;
    const background = this.getBackground(target);

    for (const name of backgroundVariables(target)) {
      root.style.removeProperty(name);
    }

    if (!source || !background) {
      return;
    }

    for (const [name, value] of Object.entries(backgroundStyle(background, source, target))) {
      root.style.setProperty(name, value);
    }
  }

  private apply(appearance: Appearance): void {
    const previous = this._appearance();

    this._appearance.set(appearance);
    applyAppearance(appearance);
    remember(appearance);

    if (appearance.theme !== previous.theme) {
      void this._desktop.setWindowTheme(appearance.theme);
    }

    // Cambiar el encaje o la opacidad no vuelve a leer el archivo: la imagen ya
    // está escrita en la variable y lo único distinto es cómo se pinta.
    if (appearance.background && previous.background) {
      this.repaintBackgroundStyle(appearance.background);
    }
    if (appearance.grid.background) {
      this.repaintBackgroundStyle(appearance.grid.background, 'grid');
    } else {
      this.paintBackground(null, 'grid');
    }
  }

  private repaintBackgroundStyle(
    background: NonNullable<Appearance['background']>,
    target: BackgroundTarget = 'editor',
  ): void {
    const root = document.documentElement;

    if (!root.style.getPropertyValue(`--dr-${target}-background`)) {
      return;
    }

    const style = backgroundStyle(background, '', target);

    for (const name of backgroundVariables(target).slice(1)) {
      root.style.setProperty(name, style[name]);
    }
  }
}
