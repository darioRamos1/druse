/**
 * Lo que trae cada versión, contado para quien usa Druse.
 *
 * Vive en el código y no en GitHub porque tiene que leerse sin conexión y en el
 * idioma de la interfaz: las notas de una release llegan en un solo idioma, y
 * solo a quien deja que Druse las busque.
 *
 * **Al cambiar la versión se añade aquí su entrada, arriba del todo.** Cada
 * línea es una clave del catálogo, escrita entera para que la guarda de
 * `check-i18n` la encuentre.
 */
export interface ReleaseNote {
  readonly version: string;
  /** Fecha en ISO; se formatea en el idioma elegido al pintarla. */
  readonly date: string;
  readonly items: readonly string[];
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '1.2.0',
    date: '2026-09-24',
    items: [
      'whatsNew.v1_2_0.english',
      'whatsNew.v1_2_0.gridLook',
      'whatsNew.v1_2_0.gridBackground',
      'whatsNew.v1_2_0.theme',
      'whatsNew.v1_2_0.motion',
      'whatsNew.v1_2_0.builder',
      'whatsNew.v1_2_0.informix',
      'whatsNew.v1_2_0.explorer',
      'whatsNew.v1_2_0.whatsNew',
    ],
  },
];

/** Las notas de una versión, si las tiene. */
export function releaseNoteFor(version: string): ReleaseNote | null {
  return RELEASE_NOTES.find((note) => note.version === version) ?? null;
}
