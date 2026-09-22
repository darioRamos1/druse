import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  output,
  viewChild,
} from '@angular/core';

import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Icon } from '../../shared/ui/icon/icon';
import { DialogFocus } from '../../shared/a11y/dialog-focus';
import { DialogBackdrop } from '../../shared/a11y/dialog-backdrop';
import {
  EditorShortcut,
  editorShortcutLabel,
  shortcutLabel,
} from '../../core/shortcuts/shortcut-label';

/** Un atajo: qué teclas y qué hace. */
interface Atajo {
  readonly keys: readonly string[];
  readonly editorAction?: EditorShortcut;
  readonly what: string;
}

interface Grupo {
  readonly title: string;
  readonly shortcuts: readonly Atajo[];
}

/**
 * Todos los atajos, escritos una sola vez.
 *
 * Estaban repartidos entre `sql-editor`, el shell, el explorador y los tooltips
 * de media aplicación, y no había dónde verlos juntos: quien no descubría uno
 * por casualidad no lo usaba nunca. Esta lista es documentación, no
 * configuración —quien manda sigue siendo cada registro de teclas—, y por eso se
 * comprueba con una prueba que no se quede atrás.
 */
export const SHORTCUT_GROUPS: readonly Grupo[] = [
  {
    title: 'shortcuts.run',
    shortcuts: [
      { keys: ['Ctrl', 'Enter'], what: 'shortcuts.run.all' },
      { keys: ['Ctrl', 'Shift', 'Enter'], what: 'shortcuts.run.current' },
      { keys: ['F5'], what: 'shortcuts.run.again' },
      { keys: ['Esc'], what: 'shortcuts.run.cancel' },
    ],
  },
  {
    title: 'shortcuts.tabs',
    shortcuts: [
      { keys: ['Ctrl', 'T'], what: 'shortcuts.tabs.new' },
      { keys: ['Alt', '1'], what: 'shortcuts.tabs.first' },
      { keys: ['Alt', '9'], what: 'shortcuts.tabs.last' },
      { keys: ['Alt', '←'], what: 'shortcuts.tabs.previous' },
      { keys: ['Alt', '→'], what: 'shortcuts.tabs.next' },
      { keys: ['Ctrl', 'F4'], what: 'shortcuts.tabs.close' },
    ],
  },
  {
    title: 'shortcuts.file',
    shortcuts: [
      { keys: ['Ctrl', 'O'], what: 'shortcuts.file.open' },
      { keys: ['Ctrl', 'S'], what: 'shortcuts.file.save' },
      { keys: ['Ctrl', 'Shift', 'S'], what: 'shortcuts.file.saveAs' },
      { keys: ['Ctrl', 'Shift', 'X'], what: 'shortcuts.file.export' },
    ],
  },
  {
    title: 'shortcuts.write',
    shortcuts: [
      { keys: ['Ctrl', 'shortcuts.key.click'], what: 'shortcuts.write.cursor' },
      {
        keys: ['Ctrl', 'Alt', '↑'],
        editorAction: 'cursor-above',
        what: 'shortcuts.write.cursorAbove',
      },
      { keys: ['Ctrl', 'D'], what: 'shortcuts.write.nextMatch' },
      { keys: ['Alt', '↑'], what: 'shortcuts.write.moveLine' },
      {
        keys: ['Shift', 'Alt', '↓'],
        editorAction: 'copy-line-down',
        what: 'shortcuts.write.duplicateLine',
      },
      { keys: ['Ctrl', '/'], what: 'shortcuts.write.comment' },
      { keys: ['Ctrl', 'Shift', 'F'], what: 'shortcuts.write.format' },
      { keys: ['Ctrl', 'F'], what: 'shortcuts.write.find' },
      { keys: ['Ctrl', 'H'], editorAction: 'replace', what: 'shortcuts.write.replace' },
    ],
  },
  {
    title: 'shortcuts.move',
    shortcuts: [
      { keys: ['Ctrl', 'K'], what: 'shortcuts.move.palette' },
      { keys: ['Ctrl', 'Shift', 'E'], what: 'shortcuts.move.explorer' },
      { keys: ['Ctrl', 'Shift', 'R'], what: 'shortcuts.move.results' },
      { keys: ['Esc'], what: 'shortcuts.move.editor' },
      { keys: ['F1'], what: 'shortcuts.move.sheet' },
    ],
  },
];

/**
 * Los atajos listos para enseñar: traducidos y con las teclas de la plataforma.
 *
 * `translate` recibe las claves del catálogo. Se traduce **antes** de adaptar a
 * la plataforma: en Mac, «hasta Alt+8» tiene que acabar diciendo «⌥8» también
 * en la frase ya traducida.
 */
export function shortcutGroups(
  platform?: string,
  translate: (key: string) => string = (key) => key,
): readonly Grupo[] {
  const key = (text: string) => (text.startsWith('shortcuts.') ? translate(text) : text);

  return SHORTCUT_GROUPS.map((group) => ({
    ...group,
    title: translate(group.title),
    shortcuts: group.shortcuts.map((shortcut) => ({
      ...shortcut,
      keys: (shortcut.editorAction
        ? editorShortcutLabel(shortcut.editorAction, platform)
        : shortcutLabel(shortcut.keys.map(key).join('+'), platform)
      ).split('+'),
      what: shortcutLabel(translate(shortcut.what), platform),
    })),
  }));
}

/**
 * La hoja de atajos.
 *
 * No configura nada: enseña. Es la respuesta a que Druse tenga veinticinco
 * atajos repartidos por la interfaz y ningún sitio donde leerlos.
 */
@Component({
  selector: 'app-shortcuts-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogBackdrop, DialogFocus, Icon, TranslatePipe],
  templateUrl: './shortcuts-sheet.html',
  styleUrl: './shortcuts-sheet.scss',
})
export class ShortcutsSheet {
  readonly closed = output<void>();

  private readonly _dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    /*
     * El diálogo se queda el foco al abrirse.
     *
     * No es solo cortesía con el teclado: **el editor se come el Escape**. Si el
     * foco sigue en Monaco, que lo tiene registrado para cancelar la ejecución,
     * la tecla no llega hasta aquí y esta hoja no se cierra con la que todo el
     * mundo prueba primero.
     */
    afterNextRender(() => this._dialog()?.nativeElement.focus());
  }

  private readonly _i18n = inject(I18nService);

  /** Se rehace al cambiar de idioma: `t` lee la señal del idioma. */
  protected readonly groups = computed(() => shortcutGroups(undefined, (key) => this._i18n.t(key)));

  /** En dos columnas, repartidas por grupos enteros y equilibradas por alto. */
  protected readonly columns = computed<readonly (readonly Grupo[])[]>(() => {
    const groups = this.groups();
    const total = groups.reduce((suma, grupo) => suma + grupo.shortcuts.length, 0);
    const izquierda: Grupo[] = [];
    const derecha: Grupo[] = [];
    let contadas = 0;

    for (const grupo of groups) {
      if (contadas < total / 2) {
        izquierda.push(grupo);
      } else {
        derecha.push(grupo);
      }

      contadas += grupo.shortcuts.length;
    }

    return [izquierda, derecha];
  });

  protected close(): void {
    this.closed.emit();
  }
}
