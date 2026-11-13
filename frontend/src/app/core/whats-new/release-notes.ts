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
    version: '1.28.1',
    date: '2026-11-13',
    items: ['whatsNew.v1_28_1.reportWorkspace'],
  },
  {
    version: '1.28.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_28_0.templates'],
  },
  {
    version: '1.27.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_27_0.pdf', 'whatsNew.v1_27_0.excel'],
  },
  {
    version: '1.26.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_26_0.dashboard', 'whatsNew.v1_26_0.brand'],
  },
  {
    version: '1.25.1',
    date: '2026-11-12',
    items: ['whatsNew.v1_25_1.buttons'],
  },
  {
    version: '1.25.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_25_0.identities', 'whatsNew.v1_25_0.brandColor'],
  },
  {
    version: '1.24.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_24_0.toCanvas', 'whatsNew.v1_24_0.safe'],
  },
  {
    version: '1.23.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_23_0.canvas', 'whatsNew.v1_23_0.fields'],
  },
  {
    version: '1.22.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_22_0.shelves', 'whatsNew.v1_22_0.chart', 'whatsNew.v1_22_0.handSql'],
  },
  {
    version: '1.21.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_21_0.canvas', 'whatsNew.v1_21_0.joinByDrag'],
  },
  {
    version: '1.20.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_20_0.engines', 'whatsNew.v1_20_0.messages'],
  },
  {
    version: '1.19.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_19_0.history', 'whatsNew.v1_19_0.storage'],
  },
  {
    version: '1.18.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_18_0.schedule', 'whatsNew.v1_18_0.recovery'],
  },
  {
    version: '1.17.0',
    date: '2026-11-12',
    items: ['whatsNew.v1_17_0.exportExcel', 'whatsNew.v1_17_0.exportPdfCsv'],
  },
  {
    version: '1.16.0',
    date: '2026-11-11',
    items: ['whatsNew.v1_16_0.templates', 'whatsNew.v1_16_0.templateFiles'],
  },
  {
    version: '1.15.0',
    date: '2026-11-11',
    items: ['whatsNew.v1_15_0.appearance', 'whatsNew.v1_15_0.dashboardStyle'],
  },
  {
    version: '1.14.0',
    date: '2026-11-11',
    items: ['whatsNew.v1_14_0.dashboards', 'whatsNew.v1_14_0.sharedFilters'],
  },
  {
    version: '1.13.0',
    date: '2026-11-11',
    items: ['whatsNew.v1_13_0.reportRefresh', 'whatsNew.v1_13_0.reportVisuals'],
  },
  {
    version: '1.12.0',
    date: '2026-11-11',
    items: ['whatsNew.v1_12_0.reportDatasets', 'whatsNew.v1_12_0.reportJoin'],
  },
  {
    version: '1.11.2',
    date: '2026-11-06',
    items: ['whatsNew.v1_11_2.openSource'],
  },
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
