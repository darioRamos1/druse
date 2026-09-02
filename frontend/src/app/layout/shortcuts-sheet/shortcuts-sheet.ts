import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  output,
  viewChild,
} from '@angular/core';

import { Icon } from '../../shared/ui/icon/icon';

/** Un atajo: qué teclas y qué hace. */
interface Atajo {
  readonly keys: readonly string[];
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
    title: 'Ejecutar',
    shortcuts: [
      { keys: ['Ctrl', 'Enter'], what: 'Ejecutar la consulta entera' },
      { keys: ['Ctrl', 'Shift', 'Enter'], what: 'Ejecutar solo la instrucción del cursor' },
      { keys: ['F5'], what: 'Volver a ejecutar' },
      { keys: ['Esc'], what: 'Cancelar lo que se esté ejecutando' },
    ],
  },
  {
    title: 'Pestañas',
    shortcuts: [
      { keys: ['Ctrl', 'T'], what: 'Nueva consulta' },
      { keys: ['Alt', '1'], what: 'Ir a la primera; hasta Alt+8' },
      { keys: ['Alt', '9'], what: 'Ir a la última' },
      { keys: ['Alt', '←'], what: 'Pestaña anterior' },
      { keys: ['Alt', '→'], what: 'Pestaña siguiente' },
      { keys: ['Ctrl', 'F4'], what: 'Cerrar la pestaña' },
    ],
  },
  {
    title: 'Archivo',
    shortcuts: [
      { keys: ['Ctrl', 'O'], what: 'Abrir un archivo SQL' },
      { keys: ['Ctrl', 'S'], what: 'Guardar' },
      { keys: ['Ctrl', 'Shift', 'S'], what: 'Guardar como' },
      { keys: ['Ctrl', 'Shift', 'X'], what: 'Exportar los resultados' },
    ],
  },
  {
    title: 'Escribir',
    shortcuts: [
      { keys: ['Ctrl', 'clic'], what: 'Poner otro cursor donde se pulse' },
      { keys: ['Ctrl', 'Alt', '↑'], what: 'Otro cursor arriba o abajo' },
      { keys: ['Ctrl', 'D'], what: 'Añadir la siguiente ocurrencia a la selección' },
      { keys: ['Alt', '↑'], what: 'Mover la línea arriba o abajo' },
      { keys: ['Shift', 'Alt', '↓'], what: 'Duplicar la línea' },
      { keys: ['Ctrl', '/'], what: 'Comentar o descomentar' },
      { keys: ['Ctrl', 'Shift', 'F'], what: 'Formatear el SQL' },
      { keys: ['Ctrl', 'F'], what: 'Buscar' },
      { keys: ['Ctrl', 'H'], what: 'Buscar y reemplazar' },
    ],
  },
  {
    title: 'Moverse',
    shortcuts: [
      { keys: ['Ctrl', 'K'], what: 'Buscar cualquier cosa y ejecutar comandos' },
      { keys: ['Ctrl', 'Shift', 'E'], what: 'Filtrar en el explorador' },
      { keys: ['Ctrl', 'Shift', 'R'], what: 'Llevar el teclado a los resultados' },
      { keys: ['Esc'], what: 'Volver al editor' },
      { keys: ['F1'], what: 'Esta hoja' },
    ],
  },
];

/**
 * La hoja de atajos.
 *
 * No configura nada: enseña. Es la respuesta a que Druse tenga veinticinco
 * atajos repartidos por la interfaz y ningún sitio donde leerlos.
 */
@Component({
  selector: 'app-shortcuts-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
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

  protected readonly groups = SHORTCUT_GROUPS;

  /** En dos columnas, repartidas por grupos enteros y equilibradas por alto. */
  protected readonly columns = computed<readonly (readonly Grupo[])[]>(() => {
    const total = SHORTCUT_GROUPS.reduce((suma, grupo) => suma + grupo.shortcuts.length, 0);
    const izquierda: Grupo[] = [];
    const derecha: Grupo[] = [];
    let contadas = 0;

    for (const grupo of SHORTCUT_GROUPS) {
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
