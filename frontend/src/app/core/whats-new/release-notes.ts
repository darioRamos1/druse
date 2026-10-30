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
    version: '1.11.1',
    date: '2026-10-30',
    items: [
      'whatsNew.v1_11_1.savedPassword',
      'whatsNew.v1_11_1.jdbcCancellation',
      'whatsNew.v1_11_1.informixBackup',
      'whatsNew.v1_11_1.copyMenu',
    ],
  },
  { version: '1.11.0', date: '2026-10-28', items: ['whatsNew.v1_11_0.downloads'] },
  { version: '1.10.0', date: '2026-10-19', items: ['whatsNew.v1_10_0.chatPlans'] },
  { version: '1.9.0', date: '2026-10-19', items: ['whatsNew.v1_9_0.chatRows'] },
  { version: '1.8.0', date: '2026-10-16', items: ['whatsNew.v1_8_0.explainError'] },
  { version: '1.7.0', date: '2026-10-16', items: ['whatsNew.v1_7_0.chatPreview'] },
  { version: '1.6.0', date: '2026-10-16', items: ['whatsNew.v1_6_0.businessNotes'] },
  { version: '1.5.0', date: '2026-10-16', items: ['whatsNew.v1_5_0.chatTables'] },
  {
    version: '1.4.0',
    date: '2026-10-16',
    items: ['whatsNew.v1_4_0.chatContext'],
  },
  {
    version: '1.3.0',
    date: '2026-10-02',
    items: ['whatsNew.v1_3_0.history', 'whatsNew.v1_3_0.keyboard'],
  },
  {
    version: '1.2.3',
    date: '2026-10-02',
    items: ['whatsNew.v1_2_3.valueFidelity', 'whatsNew.v1_2_3.aiDiagnostics'],
  },
  {
    version: '1.2.2',
    date: '2026-10-02',
    items: ['whatsNew.v1_2_2.pendingCells', 'whatsNew.v1_2_2.importAnalysis'],
  },
  {
    version: '1.2.1',
    date: '2026-09-24',
    items: ['whatsNew.v1_2_1.sqlColors'],
  },
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
