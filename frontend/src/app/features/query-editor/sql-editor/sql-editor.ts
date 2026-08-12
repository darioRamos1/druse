import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnInit,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type * as MonacoApi from 'monaco-editor';

import { DatabaseEngine, SchemaIndex } from '../../../shared/models/workspace';
import { registerSqlCompletion } from '../sql-language/sql-completion';
import { formatSql } from '../sql-language/sql-formatting';
import { DRUSE_THEME, DRUSE_THEME_NAME } from './druse-theme';
import { MonacoLoader } from './monaco-loader';

/** Posición del cursor, tal como se muestra en la barra de estado. */
export interface CursorPosition {
  readonly line: number;
  readonly column: number;
}

/** Selección activa del editor. */
export interface EditorSelection {
  readonly hasSelection: boolean;
  /** Texto seleccionado, para poder ejecutarlo solo. */
  readonly text: string;
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
  readonly engine = input<DatabaseEngine>('postgresql');
  readonly schema = input<SchemaIndex>({ schemas: [], relations: [] });

  /**
   * Cómo pedir las columnas de una tabla que el explorador no ha abierto.
   *
   * Se recibe como entrada en lugar de inyectar el estado: el editor sigue sin
   * conocer el gateway ni el store, igual que no conoce el motor ni el esquema.
   */
  readonly loadColumns = input<
    ((schema: string | null, name: string) => Promise<readonly string[]>) | undefined
  >(undefined);

  /** Cómo pedir las tablas de un esquema que el precalentado no alcanzó. */
  readonly loadRelations = input<((schema: string) => Promise<void>) | undefined>(undefined);

  readonly valueChange = output<string>();
  readonly cursorChange = output<CursorPosition>();
  readonly selectionChange = output<EditorSelection>();
  readonly execute = output<void>();
  readonly executeSelection = output<void>();
  readonly cancel = output<void>();
  readonly save = output<void>();
  readonly newTab = output<void>();
  /** El formateo falló; lo comunica quien lo pidió. */
  readonly formatFailed = output<string>();

  protected readonly ready = signal(false);
  protected readonly failed = signal(false);

  private _editor: MonacoApi.editor.IStandaloneCodeEditor | null = null;

  constructor() {
    // El valor puede cambiar desde fuera al cambiar de pestaña. Se compara antes
    // de escribir para no reponer el mismo texto en cada pulsación, lo que
    // devolvería el cursor al principio.
    effect(() => {
      const value = this.value();
      const editor = this._editor;

      if (editor && editor.getValue() !== value) {
        editor.setValue(value);
      }
    });
  }

  /**
   * Formatea el contenido, o solo la selección si la hay.
   *
   * Se hace a través del editor y no cambiando el texto desde fuera para que la
   * operación entre en la pila de deshacer: formatear debe poder revertirse con
   * Ctrl+Z como cualquier otra edición.
   */
  async formatDocument(): Promise<void> {
    const editor = this._editor;

    if (!editor) {
      return;
    }

    const model = editor.getModel();

    if (!model) {
      return;
    }

    const selection = editor.getSelection();
    const formatSelectionOnly = selection !== null && !selection.isEmpty();

    const source = formatSelectionOnly ? model.getValueInRange(selection) : model.getValue();
    const result = await formatSql(source, this.engine());

    if (result.error) {
      this.formatFailed.emit(result.error);
      return;
    }

    if (!result.changed) {
      return;
    }

    editor.executeEdits('druse-format', [
      {
        range: formatSelectionOnly ? selection : model.getFullModelRange(),
        text: result.sql,
      },
    ]);

    editor.pushUndoStop();
  }

  /** Abre la búsqueda del editor. */
  openSearch(): void {
    this._editor?.getAction('actions.find')?.run();
  }

  focus(): void {
    this._editor?.focus();
  }

  async ngOnInit(): Promise<void> {
    let monaco: typeof MonacoApi;

    try {
      monaco = await this._loader.load();
    } catch {
      this.failed.set(true);
      return;
    }

    monaco.editor.defineTheme(DRUSE_THEME_NAME, DRUSE_THEME);

    // El autocompletado se registra una vez por editor y se retira al destruirlo:
    // de lo contrario cada editor añadiría otro proveedor y las sugerencias
    // saldrían repetidas.
    const disposeCompletion = registerSqlCompletion(monaco, () => ({
      engine: this.engine(),
      schema: this.schema(),
      loadColumns: this.loadColumns(),
      loadRelations: this.loadRelations(),
    }));

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
        // Ahora que hay sugerencias de esquema reales, las de palabras sueltas
        // del propio documento solo añadirían ruido.
        wordBasedSuggestions: 'off',
        suggestOnTriggerCharacters: true,
        quickSuggestions: { other: true, comments: false, strings: false },
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

        // Se emite el texto y no solo si hay selección: «Ejecutar selección»
        // necesita exactamente lo que el usuario marcó, sin volver a pedírselo
        // al editor desde fuera.
        const text = empty ? '' : (editor.getModel()?.getValueInRange(event.selection) ?? '');

        this._zone.run(() => this.selectionChange.emit({ hasSelection: !empty, text }));
      });

      this.registerShortcuts(monaco, editor);
    });

    this.ready.set(true);

    this._destroyRef.onDestroy(() => {
      disposeCompletion();
      this._editor?.dispose();
      this._editor = null;
    });
  }

  /**
   * Atajos del editor.
   *
   * Se registran en Monaco y no en el documento porque solo deben actuar con el
   * foco dentro del editor: un Ctrl+S global se comería el del navegador aunque
   * el usuario estuviera escribiendo en otro sitio.
   */
  private registerShortcuts(
    monaco: typeof MonacoApi,
    editor: MonacoApi.editor.IStandaloneCodeEditor,
  ): void {
    const run = (action: () => void) => () => this._zone.run(action);

    // Ejecutar: Ctrl/Cmd + Enter.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run(() => this.execute.emit()));

    // Ejecutar solo la selección: Ctrl/Cmd + Shift + Enter.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      run(() => this.executeSelection.emit()),
    );

    // Cancelar: Escape. Solo tiene efecto si hay algo ejecutándose; quien lo
    // decide es el shell.
    editor.addCommand(monaco.KeyCode.Escape, run(() => this.cancel.emit()));

    // Guardar: Ctrl/Cmd + S.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, run(() => this.save.emit()));

    // Nueva consulta: Ctrl/Cmd + T.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT, run(() => this.newTab.emit()));

    // Formatear: Ctrl/Cmd + Shift + F, el mismo que usa el resto de editores.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
      run(() => void this.formatDocument()),
    );
  }
}
