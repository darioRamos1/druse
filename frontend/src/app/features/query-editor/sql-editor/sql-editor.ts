import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnInit,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';

import { DRUSE_THEME, DRUSE_THEME_NAME } from './druse-theme';
import { MonacoLoader } from './monaco-loader';

/** Posición del cursor, tal como se muestra en la barra de estado. */
export interface CursorPosition {
  readonly line: number;
  readonly column: number;
}

/**
 * Editor SQL sobre Monaco.
 *
 * Encapsula por completo la API de Monaco: ningún otro componente la importa.
 * Si más adelante se cambiara de editor, el cambio quedaría contenido aquí.
 */
@Component({
  selector: 'app-sql-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="host" #container></div>
    @if (!ready()) {
      <div class="placeholder">
        @if (failed()) {
          <span class="placeholder__error">No se pudo cargar el editor.</span>
        } @else {
          <span>Cargando editor…</span>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-width: 0;
      min-height: 0;
      background: var(--dr-surface-base);
    }

    .host {
      width: 100%;
      height: 100%;
    }

    .placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--dr-surface-base);
      color: var(--dr-text-faint);
      font-size: var(--dr-font-size-sm);

      &__error {
        color: #f2686b;
      }
    }
  `,
})
export class SqlEditor implements OnInit {
  private readonly _loader = inject(MonacoLoader);
  private readonly _zone = inject(NgZone);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _container = viewChild.required<ElementRef<HTMLElement>>('container');

  readonly value = input('');
  readonly readOnly = input(false);

  readonly valueChange = output<string>();
  readonly cursorChange = output<CursorPosition>();
  readonly selectionChange = output<boolean>();
  readonly execute = output<void>();

  protected readonly ready = signal(false);
  protected readonly failed = signal(false);

  private _editor: MonacoApi.editor.IStandaloneCodeEditor | null = null;

  async ngOnInit(): Promise<void> {
    let monaco: typeof MonacoApi;

    try {
      monaco = await this._loader.load();
    } catch {
      this.failed.set(true);
      return;
    }

    monaco.editor.defineTheme(DRUSE_THEME_NAME, DRUSE_THEME);

    // Monaco instala muchísimos escuchadores de eventos. Crearlo fuera de la
    // zona evita ciclos de detección de cambios en cada pulsación.
    this._zone.runOutsideAngular(() => {
      this._editor = monaco.editor.create(this._container().nativeElement, {
        value: this.value(),
        language: 'sql',
        theme: DRUSE_THEME_NAME,
        readOnly: this.readOnly(),
        automaticLayout: true,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
        fontSize: 13,
        lineHeight: 22,
        lineNumbersMinChars: 3,
        padding: { top: 12, bottom: 12 },
        minimap: { enabled: true, maxColumn: 70, renderCharacters: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'all',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        tabSize: 2,
        // El autocompletado de palabras reservadas llega en la Fase 5; de momento
        // se apaga la sugerencia por palabras del documento, que confunde más que ayuda.
        wordBasedSuggestions: 'off',
        suggestOnTriggerCharacters: false,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      });

      const editor = this._editor;

      editor.onDidChangeModelContent(() => {
        this._zone.run(() => this.valueChange.emit(editor.getValue()));
      });

      editor.onDidChangeCursorPosition((event) => {
        this._zone.run(() =>
          this.cursorChange.emit({
            line: event.position.lineNumber,
            column: event.position.column,
          }),
        );
      });

      editor.onDidChangeCursorSelection((event) => {
        const empty = event.selection.isEmpty();
        this._zone.run(() => this.selectionChange.emit(!empty));
      });

      // Ctrl/Cmd + Enter ejecuta, como indica el mockup.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        this._zone.run(() => this.execute.emit());
      });
    });

    this.ready.set(true);

    this._destroyRef.onDestroy(() => {
      this._editor?.dispose();
      this._editor = null;
    });
  }
}
