import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { inject } from '@angular/core';

/**
 * Nombres válidos de icono. Es una unión cerrada a propósito: un icono que no
 * exista se detecta al compilar, no en tiempo de ejecución.
 */
export type IconName =
  | 'panel-left'
  | 'maximize'
  | 'panel-split'
  | 'plus'
  | 'new-query'
  | 'folder-open'
  | 'save'
  | 'search'
  | 'sun'
  | 'moon'
  | 'settings'
  | 'refresh'
  | 'chevron-down'
  | 'database'
  | 'schema'
  | 'table'
  | 'diagram'
  | 'play'
  | 'play-outline'
  | 'stop'
  | 'format'
  | 'comment'
  | 'clock'
  | 'filter'
  | 'export'
  | 'disconnect'
  | 'edit'
  | 'trash'
  | 'console'
  | 'sparkles'
  | 'sort-desc'
  | 'eye'
  | 'eye-off'
  | 'transaction'
  | 'alert'
  | 'check'
  | 'copy'
  | 'close'
  | 'inbox';

interface IconDefinition {
  readonly viewBox: string;
  /** Contenido interno del <svg>. Constante del propio código, nunca entrada externa. */
  readonly body: string;
}

/**
 * Trazos tomados del mockup de referencia.
 * Todos usan `currentColor` para heredar el color del contexto.
 */
const ICONS: Readonly<Record<IconName, IconDefinition>> = {
  alert: {
    viewBox: '0 0 16 16',
    body:
      '<circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M8 4.8v3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      '<circle cx="8" cy="11.1" r=".85" fill="currentColor"/>',
  },
  check: {
    viewBox: '0 0 14 14',
    body: '<path d="M2.8 7.3l2.7 2.7 5.7-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  copy: {
    viewBox: '0 0 14 14',
    body:
      '<rect x="4.6" y="4.6" width="7.2" height="7.2" rx="1.6" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M9.4 2.9A1.5 1.5 0 0 0 8 2.2H3.8a1.6 1.6 0 0 0-1.6 1.6V8a1.5 1.5 0 0 0 .7 1.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  },
  close: {
    viewBox: '0 0 12 12',
    body: '<path d="M2.6 2.6l6.8 6.8M9.4 2.6l-6.8 6.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  },
  /** La bandeja vacía: «aquí llegará algo», para los huecos que aún no tienen nada. */
  inbox: {
    viewBox: '0 0 16 16',
    body:
      '<path d="M2 9.2l1.7-5.1A1.4 1.4 0 0 1 5 3.2h6a1.4 1.4 0 0 1 1.3.9L14 9.2v2.6a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 11.8V9.2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M2 9.2h3.2l.9 1.5h3.8l.9-1.5H14" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  },
  maximize: {
    viewBox: '0 0 16 16',
    body: '<path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'panel-split': {
    viewBox: '0 0 16 16',
    body: '<rect x="1.5" y="2" width="13" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 8h13" stroke="currentColor" stroke-width="1.3"/>',
  },
  'panel-left': {
    viewBox: '0 0 16 16',
    body: '<rect x="1.5" y="2" width="13" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M6 2v12" stroke="currentColor" stroke-width="1.3"/>',
  },
  plus: {
    viewBox: '0 0 12 12',
    body: '<path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  'new-query': {
    viewBox: '0 0 12 12',
    body:
      '<rect x="1.2" y="1.8" width="9.6" height="8.4" rx="2" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M4 6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  },
  'folder-open': {
    viewBox: '0 0 14 14',
    body:
      '<path d="M1.5 4.2V3.1c0-.7.5-1.2 1.2-1.2h3l1.2 1.4h4.4c.7 0 1.2.5 1.2 1.2v.7" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M2.6 5.2h9.2c.7 0 1.1.7.8 1.3l-2.1 4.6c-.2.5-.7.8-1.2.8H2.7c-.7 0-1.2-.5-1.2-1.2V6.3c0-.6.5-1.1 1.1-1.1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  },
  save: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M2 1.7h7.7l2.3 2.4v8.2H2V1.7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M4.2 1.7v3.2h5V1.7M4.2 12.3V8h5.6v4.3" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  },
  search: {
    viewBox: '0 0 14 14',
    body:
      '<circle cx="6.2" cy="6.2" r="4.2" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M9.4 9.4L12 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  },
  sun: {
    viewBox: '0 0 14 14',
    body:
      '<circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M7 .8v1.8M7 11.4v1.8M13.2 7h-1.8M2.6 7H.8M11.4 2.6l-1.3 1.3M3.9 10.1l-1.3 1.3M11.4 11.4l-1.3-1.3M3.9 3.9L2.6 2.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  },
  moon: {
    viewBox: '0 0 14 14',
    body: '<path d="M11.6 8.4A5 5 0 0 1 5.6 2.4a5 5 0 1 0 6 6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  },
  settings: {
    viewBox: '0 0 16 16',
    body:
      '<circle cx="8" cy="8" r="2.4" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M8 1.4v1.6M8 13v1.6M14.6 8H13M3 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4L3.3 3.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  },
  refresh: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M12 7a5 5 0 1 1-1.6-3.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
      '<path d="M12 1.4v3.1H8.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'chevron-down': {
    viewBox: '0 0 10 10',
    body: '<path d="M2 3.5L5 6.5l3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  database: {
    viewBox: '0 0 14 14',
    body:
      '<ellipse cx="7" cy="3.4" rx="4.6" ry="1.9" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M2.4 3.4v7.2c0 1.05 2.06 1.9 4.6 1.9s4.6-.85 4.6-1.9V3.4" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M2.4 7c0 1.05 2.06 1.9 4.6 1.9s4.6-.85 4.6-1.9" stroke="currentColor" stroke-width="1.2"/>',
  },
  schema: {
    viewBox: '0 0 14 14',
    body:
      '<rect x="5.2" y="1.4" width="3.6" height="3" rx=".8" stroke="currentColor" stroke-width="1.2"/>' +
      '<rect x="1.4" y="9.4" width="3.6" height="3" rx=".8" stroke="currentColor" stroke-width="1.2"/>' +
      '<rect x="9" y="9.4" width="3.6" height="3" rx=".8" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M7 4.4v2.3M3.2 9.4V7.2h7.6v2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  /** Dos tablas unidas por una relación: es lo que dibuja el diagrama. */
  diagram: {
    viewBox: '0 0 14 14',
    body:
      '<rect x="1.4" y="1.8" width="4.6" height="3.6" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
      '<rect x="8" y="8.6" width="4.6" height="3.6" rx="1" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M6 3.6h1.4a1.6 1.6 0 0 1 1.6 1.6v3.4" stroke="currentColor" stroke-width="1.2" fill="none"/>',
  },
  table: {
    viewBox: '0 0 14 14',
    body:
      '<rect x="1.6" y="2.4" width="10.8" height="9.2" rx="2" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M1.6 5.6h10.8M5.4 5.6v6" stroke="currentColor" stroke-width="1.2"/>',
  },
  play: {
    viewBox: '0 0 12 12',
    body: '<path d="M3 2.2l6.4 3.8L3 9.8V2.2z" fill="currentColor"/>',
  },
  'play-outline': {
    viewBox: '0 0 12 12',
    body: '<path d="M3.4 2.6l5 3.4-5 3.4V2.6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  },
  stop: {
    viewBox: '0 0 12 12',
    body: '<rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1.6" stroke="currentColor" stroke-width="1.3"/>',
  },
  format: {
    viewBox: '0 0 12 12',
    body: '<path d="M2 3h8M2 6h5M2 9h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  },
  comment: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M2 2.2h10v7H6.1L3 11.8V9.2H2v-7z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M4.2 4.7h5.6M4.2 6.9h3.9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
  },
  eye: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M1 7s2.2-3.6 6-3.6S13 7 13 7s-2.2 3.6-6 3.6S1 7 1 7z" stroke="currentColor" ' +
      'stroke-width="1.2" stroke-linejoin="round"/>' +
      '<circle cx="7" cy="7" r="1.6" stroke="currentColor" stroke-width="1.2"/>',
  },
  // El ojo tachado: la barra cruza el mismo dibujo, que es como se reconoce
  // «ocultar» sin leer nada.
  'eye-off': {
    viewBox: '0 0 14 14',
    body:
      '<path d="M1 7s2.2-3.6 6-3.6c1 0 1.9.2 2.6.6M12.4 5.2c.4.5.6 1 .6 1.8 0 0-2.2 3.6-6 3.6' +
      '-.9 0-1.7-.2-2.4-.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" ' +
      'stroke-linejoin="round"/>' +
      '<path d="M2 2l10 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  },
  clock: {
    viewBox: '0 0 14 14',
    body:
      '<circle cx="7" cy="7" r="5.2" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M7 4.2V7l1.9 1.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  },
  filter: {
    viewBox: '0 0 14 14',
    body: '<path d="M2 3h10l-4 4.4v4.1l-2-1.2V7.4L2 3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  },
  export: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M7 1.8v7.4M4.2 6.6L7 9.4l2.8-2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M2.2 11.6h9.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  },
  disconnect: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M7 1.8v5.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      '<path d="M10.4 3.4a4.6 4.6 0 1 1-6.8 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  },
  edit: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M9.4 2.4l2.2 2.2-6.3 6.3-2.7.5.5-2.7 6.3-6.3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M8.4 3.4l2.2 2.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  },
  trash: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M2.4 3.6h9.2M5.1 3.6V2.2h3.8v1.4M3.7 3.6l.6 8.1h5.4l.6-8.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M5.8 6v3.5M8.2 6v3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
  },
  // Dos destellos, uno grande y otro pequeno: es la marca del asistente en
  // la barra superior y en su panel, y tiene que leerse a 12 px.
  sparkles: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M6 1.6 6.95 4.2 9.6 5.1 6.95 6 6 8.6 5.05 6 2.4 5.1 5.05 4.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M10.6 8.4 11.1 9.8 12.5 10.3 11.1 10.8 10.6 12.2 10.1 10.8 8.7 10.3 10.1 9.8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  },
  console: {
    viewBox: '0 0 14 14',
    body:
      '<path d="M3 4l2.6 3L3 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M7.6 10.2H11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  },
  'sort-desc': {
    viewBox: '0 0 10 10',
    body: '<path d="M5 2v6M2.6 5.6L5 8l2.4-2.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  // Un nodo en una línea: el trabajo que aún no se ha confirmado.
  transaction: {
    viewBox: '0 0 12 12',
    body:
      '<path d="M6 1v2.4M6 8.6V11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
      '<circle cx="6" cy="6" r="2.4" stroke="currentColor" stroke-width="1.3"/>',
  },
};

/**
 * Icono SVG monocromo que hereda el color del contexto.
 *
 * Uso: `<app-icon name="refresh" [size]="13" />`
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="definition().viewBox"
      [innerHTML]="body()"
      fill="none"
      aria-hidden="true"
      focusable="false"
    ></svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }
  `,
})
export class Icon {
  private readonly _sanitizer = inject(DomSanitizer);

  readonly name = input.required<IconName>();
  readonly size = input(13);

  protected readonly definition = computed(() => ICONS[this.name()]);

  /**
   * Los trazos son constantes declaradas arriba y `name` es una unión cerrada,
   * así que aquí nunca entra contenido externo. Angular no puede saberlo, de ahí
   * el bypass explícito.
   */
  protected readonly body = computed<SafeHtml>(() =>
    this._sanitizer.bypassSecurityTrustHtml(this.definition().body),
  );
}
