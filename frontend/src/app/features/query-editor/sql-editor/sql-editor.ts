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

import {
  DatabaseEngine,
  KnownColumn,
  QueryError,
  SchemaIndex,
} from '../../../shared/models/workspace';
import { registerSqlCompletion } from '../sql-language/sql-completion';
import { findProblems } from '../sql-language/sql-diagnostics';
import { registerSqlHover } from '../sql-language/sql-hover';
import { formatSql } from '../sql-language/sql-formatting';
import { statementAt } from '../sql-language/sql-statements';
import { DEFAULT_FORMAT_SETTINGS, FormatSettings } from '../../../core/workspace/format-settings';
import { SnippetStore } from '../../../core/snippets/snippet.store';
import { ThemeName } from '../../../core/theme/theme.service';
import { DRUSE_THEME_NAMES, druseTheme } from './druse-theme';
import { executionErrorPlace } from './execution-error';
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
  /** Desplazamiento UTF-16 donde empieza la selección dentro del documento. */
  readonly startOffset: number;
}

export interface ExecutionErrorContext {
  readonly error: QueryError;
  readonly sql: string;
  readonly startOffset: number;
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
          <span class="placeholder__error">{{ failure() }}</span>
          <button type="button" class="placeholder__retry" (click)="retry()">Reintentar</button>
        } @else {
          <span>Cargando editor…</span>
        }
      </div>
    }
  `,
  styles: `
    /*
     * Monaco saca el autocompletado, el hover y la ayuda de parámetros fuera de
     * su marco, así que caen sobre el panel de resultados. Ahí compiten con la
     * cabecera de la rejilla, que está fija con z-index 2, y con el tirador que
     * reparte el alto: sin este nivel propio, el nombre de las columnas se
     * dibujaba encima de la lista de sugerencias. Queda por debajo de los menús
     * de la barra (20) y de todo lo modal.
     */
    :host {
      position: relative;
      z-index: 6;
      display: block;
      min-width: 0;
      min-height: 0;
      background: var(--dr-surface-base);
    }

    /*
     * La imagen de fondo va en una capa propia, debajo del editor.
     *
     * No se le puede poner opacidad al contenedor: la heredaría el código, que
     * es lo único que no puede perder contraste. Así la imagen se atenúa sola y
     * el texto se queda entero. Sin imagen, la capa es transparente y no pinta
     * nada.
     */
    :host::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: 0;
      background-image: var(--dr-editor-background, none);
      background-size: var(--dr-editor-background-size, cover);
      background-repeat: var(--dr-editor-background-repeat, no-repeat);
      background-position: var(--dr-editor-background-position, center);
      opacity: var(--dr-editor-background-opacity, 0);
      pointer-events: none;
    }

    .host {
      position: relative;
      z-index: 1;
      width: 100%;
      height: 100%;
    }

    .placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: var(--dr-surface-base);
      color: var(--dr-text-faint);
      font-size: var(--dr-font-size-sm);
      text-align: center;

      &__error {
        max-width: 460px;
        color: var(--dr-danger);
      }

      &__retry {
        padding: 6px 12px;
        border: 1px solid var(--dr-border);
        border-radius: 8px;
        background: transparent;
        color: var(--dr-text);
        font-size: var(--dr-font-size-xs);
        cursor: pointer;
      }
    }
  `,
})
export default class SqlEditor implements OnInit {
  private readonly _loader = inject(MonacoLoader);
  private readonly _zone = inject(NgZone);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _snippets = inject(SnippetStore);

  private readonly _container = viewChild.required<ElementRef<HTMLElement>>('container');

  readonly value = input('');
  readonly readOnly = input(false);
  readonly engine = input<DatabaseEngine>('postgresql');

  /**
   * Paleta que debe pintar el editor.
   *
   * Entra como el resto: el editor no conoce el servicio de tema, igual que no
   * conoce el store ni el gateway.
   */
  readonly theme = input<ThemeName>('dark');

  /** Acento elegido por el usuario; `null` deja el de la paleta. */
  readonly accent = input<string | null>(null);

  /** Cuerpo de la letra, en píxeles. Se elige en preferencias. */
  readonly fontSize = input(13);

  /** Cómo formatear. Lo elige el usuario en la barra y se recuerda entre arranques. */
  readonly formatSettings = input<FormatSettings>(DEFAULT_FORMAT_SETTINGS);

  readonly schema = input<SchemaIndex>({ schemas: [], relations: [] });
  readonly executionError = input<ExecutionErrorContext | null>(null);

  /**
   * Cómo pedir las columnas de una tabla que el explorador no ha abierto.
   *
   * Se recibe como entrada en lugar de inyectar el estado: el editor sigue sin
   * conocer el gateway ni el store, igual que no conoce el motor ni el esquema.
   */
  readonly loadColumns = input<
    ((schema: string | null, name: string) => Promise<readonly KnownColumn[]>) | undefined
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
  readonly saveAs = output<void>();
  readonly openFile = output<void>();
  readonly newTab = output<void>();

  /**
   * Abrir la búsqueda global desde dentro del editor.
   *
   * Hace falta porque Monaco se queda con `Ctrl+K`: lo usa como principio de sus
   * propios acordes, así que la pulsación nunca llegaba a la aplicación y el
   * atajo solo funcionaba con el foco fuera del editor —justo donde menos
   * tiempo se pasa—.
   */
  readonly openPalette = output<void>();
  /** El formateo falló; lo comunica quien lo pidió. */
  readonly formatFailed = output<string>();

  protected readonly ready = signal(false);
  protected readonly failed = signal(false);

  /** Por qué no cargó, para no dejar al usuario con un «no se pudo» a secas. */
  protected readonly failure = signal('No se pudo cargar el editor.');

  private _editor: MonacoApi.editor.IStandaloneCodeEditor | null = null;
  private _monaco: typeof MonacoApi | null = null;
  private _syncingExternalValue = false;

  constructor() {
    // El valor puede cambiar desde fuera al cambiar de pestaña. Se compara antes
    // de escribir para no reponer el mismo texto en cada pulsación, lo que
    // devolvería el cursor al principio.
    effect(() => {
      const value = this.value();
      const editor = this._editor;

      if (editor && editor.getValue() !== value) {
        this._syncingExternalValue = true;

        try {
          editor.setValue(value);
        } finally {
          this._syncingExternalValue = false;
        }
      }
    });

    // El tema se cambia con el editor ya creado. `setTheme` es global de Monaco,
    // que es justo lo que hace falta: la aplicación no tiene medio editor claro
    // y medio oscuro.
    //
    // Se vuelve a registrar en lugar de solo aplicarlo porque el acento forma
    // parte de la definición: el cursor y la selección salen de ahí, y Monaco no
    // los lee de ningún sitio después.
    // El cuerpo de la letra se cambia en caliente: Monaco recoloca las líneas él
    // solo y no hace falta rehacer el editor.
    effect(() => {
      const fontSize = this.fontSize();

      if (this.ready()) {
        this._editor?.updateOptions({ fontSize, lineHeight: Math.round(fontSize * 1.7) });
      }
    });

    effect(() => {
      const theme = this.theme();
      const accent = this.accent();

      if (this.ready()) {
        this.registerThemes(accent);
        this._monaco?.editor.setTheme(DRUSE_THEME_NAMES[theme]);
      }
    });

    effect(() => {
      const context = this.executionError();

      if (!this.ready()) {
        return;
      }

      if (context) {
        this.showExecutionError(context.error, context.sql, context.startOffset);
      } else {
        this.clearExecutionError();
      }
    });
  }

  /**
   * Lo que ejecuta «Ejecutar actual»: la selección, o la instrucción del cursor.
   *
   * Se calcula aquí y no en el shell porque hace falta el cursor, y el cursor es
   * de Monaco. Y se calcula al pedirlo y no en cada tecla: recorrer el texto en
   * cada pulsación sería pagar por algo que se usa al ejecutar.
   *
   * Devuelve una selección vacía cuando no hay nada que ejecutar; quien llama ya
   * sabe qué decir en ese caso.
   */
  activeFragment(): EditorSelection {
    const editor = this._editor;
    const model = editor?.getModel();

    if (!editor || !model) {
      return { hasSelection: false, text: '', startOffset: 0 };
    }

    const selection = editor.getSelection();

    if (selection && !selection.isEmpty()) {
      return {
        hasSelection: true,
        text: model.getValueInRange(selection),
        startOffset: model.getOffsetAt(selection.getStartPosition()),
      };
    }

    const position = editor.getPosition();
    const statement = position ? statementAt(model.getValue(), model.getOffsetAt(position)) : null;

    return statement
      ? { hasSelection: false, text: statement.text, startOffset: statement.startOffset }
      : { hasSelection: false, text: '', startOffset: 0 };
  }

  /**
   * Abre el buscador del editor, con o sin reemplazo.
   *
   * Monaco lo trae desde siempre y funciona con `Ctrl+F` y `Ctrl+H`, pero nada
   * en la interfaz lo decía: quien no venga de VS Code no tiene forma de saber
   * que está. Por eso lo ofrece también la paleta.
   */
  openFind(replace = false): void {
    const editor = this._editor;

    if (!editor) {
      return;
    }

    editor.focus();
    editor.getAction(replace ? 'editor.action.startFindReplaceAction' : 'actions.find')?.run();
  }

  /**
   * Escribe texto donde esté el cursor, reemplazando lo que hubiera seleccionado.
   *
   * Es por donde entran los fragmentos guardados. Va por `executeEdits` y no
   * cambiando el valor del modelo para que la inserción **entre en la pila de
   * deshacer**: un fragmento largo pegado por error se quita con Ctrl+Z, como
   * cualquier otra edición.
   */
  insertText(text: string): void {
    const editor = this._editor;
    const monaco = this._monaco;
    const model = editor?.getModel();

    if (!editor || !monaco || !model) {
      return;
    }

    const selection = editor.getSelection();
    const position = editor.getPosition();
    const range =
      selection ??
      (position
        ? new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          )
        : model.getFullModelRange().collapseToStart());

    editor.pushUndoStop();
    editor.executeEdits('druse-snippet', [{ range, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    editor.focus();
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
    const result = await formatSql(source, this.engine(), this.formatSettings());

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

  /** Quita el error de la ejecución anterior sin tocar los avisos del catálogo. */
  clearExecutionError(): void {
    const model = this._editor?.getModel();

    if (model && this._monaco) {
      this._monaco.editor.setModelMarkers(model, 'druse-execution', []);
    }
  }

  /**
   * Marca dónde falló, dentro del SQL enviado.
   *
   * Se subraya lo más pequeño que el motor permita saber: con PostgreSQL, que da
   * la posición exacta, **la palabra culpable**; con SQL Server y MySQL, que solo
   * dan la línea, la línea entera. Señalar un párrafo cuando se sabe la palabra
   * es tirar información, y señalar una palabra cuando solo se sabe la línea es
   * inventársela.
   */
  showExecutionError(error: QueryError, executedSql: string, startOffset = 0): void {
    const editor = this._editor;
    const monaco = this._monaco;
    const model = editor?.getModel();

    if (!editor || !monaco || !model) {
      return;
    }

    const place = executionErrorPlace(error, executedSql);

    if (!place) {
      this.clearExecutionError();
      return;
    }

    // El fragmento ejecutado puede empezar en mitad del documento —«Ejecutar
    // actual» manda una sola instrucción— así que lo que dice el motor es
    // relativo a él y hay que devolverlo a coordenadas de la pestaña.
    const start = model.getPositionAt(startOffset);
    const lineNumber = start.lineNumber + place.line - 1;

    if (lineNumber > model.getLineCount()) {
      this.clearExecutionError();
      return;
    }

    // La columna solo se desplaza en la primera línea del fragmento: es la única
    // que puede empezar a media línea. Las siguientes empiezan donde la pestaña.
    const column =
      place.column === null
        ? null
        : place.line === 1
          ? start.column + place.column - 1
          : place.column;

    monaco.editor.setModelMarkers(model, 'druse-execution', [
      {
        severity: monaco.MarkerSeverity.Error,
        message: error.message,
        ...this.range(model, lineNumber, column),
      },
    ]);
    editor.revealLineInCenterIfOutsideViewport(lineNumber);
  }

  /**
   * Qué se subraya: la palabra que empieza en esa columna, o la línea entera.
   *
   * Cuando la columna cae sobre un símbolo y no sobre una palabra —una coma de
   * más, un paréntesis sin cerrar— no hay palabra que marcar y se subraya ese
   * carácter: es exactamente lo que el motor está señalando.
   */
  private range(
    model: MonacoApi.editor.ITextModel,
    lineNumber: number,
    column: number | null,
  ): {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } {
    const last = model.getLineMaxColumn(lineNumber);

    if (column === null || column >= last) {
      return {
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: last,
      };
    }

    const word = model.getWordAtPosition({ lineNumber, column });

    return {
      startLineNumber: lineNumber,
      startColumn: word?.startColumn ?? column,
      endLineNumber: lineNumber,
      endColumn: word?.endColumn ?? Math.min(column + 1, last),
    };
  }

  async ngOnInit(): Promise<void> {
    await this.start();
  }

  /**
   * Vuelve a intentar cargar el editor.
   *
   * Existe porque el fallo más común es pasajero —un recurso que aún no estaba
   * servido al abrir— y sin esto habría que recargar la aplicación entera,
   * perdiendo de paso lo que hubiera escrito en las demás pestañas.
   */
  protected async retry(): Promise<void> {
    this.failed.set(false);
    await this.start();
  }

  private async start(): Promise<void> {
    let monaco: typeof MonacoApi;

    try {
      monaco = await this._loader.load();
    } catch (error) {
      this.failure.set(error instanceof Error ? error.message : 'No se pudo cargar el editor.');
      this.failed.set(true);
      return;
    }

    if (this._destroyRef.destroyed) {
      return;
    }

    this._monaco = monaco;
    this.registerThemes(this.accent());

    // El autocompletado se registra una vez por editor y se retira al destruirlo:
    // de lo contrario cada editor añadiría otro proveedor y las sugerencias
    // saldrían repetidas.
    const disposeCompletion = registerSqlCompletion(monaco, () => ({
      engine: this.engine(),
      schema: this.schema(),
      loadColumns: this.loadColumns(),
      loadRelations: this.loadRelations(),
      // Lo guardado por el usuario pesa más que las plantillas de fábrica: se
      // guardó a propósito y se escribe por su nombre.
      snippets: this._snippets.snippets(),
    }));

    // El tooltip lee del mismo catálogo, así que nunca dispara una consulta:
    // aparecería tarde y con el ratón ya en otro sitio.
    const disposeHover = registerSqlHover(monaco, () => ({ schema: this.schema() }));

    // Monaco instala muchísimos escuchadores de eventos. Crearlo fuera de la
    // zona evita ciclos de detección de cambios en cada pulsación.
    this._zone.runOutsideAngular(() => {
      this._editor = monaco.editor.create(this._container().nativeElement, {
        value: this.value(),
        language: 'sql',
        theme: DRUSE_THEME_NAMES[this.theme()],
        readOnly: this.readOnly(),
        automaticLayout: true,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
        fontSize: this.fontSize(),
        lineHeight: Math.round(this.fontSize() * 1.7),
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
        this.clearExecutionError();

        if (!this._syncingExternalValue) {
          this._zone.run(() => this.valueChange.emit(editor.getValue()));
        }

        this.scheduleDiagnostics(monaco);
      });

      this.scheduleDiagnostics(monaco);

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

        // Se emite el texto y no solo si hay selección: quien la ejecute
        // necesita exactamente lo que el usuario marcó. Lo que hace falta al
        // pulsar «Ejecutar actual» sale de `activeFragment()`, que además sabe
        // dónde está el cursor cuando no hay nada marcado.
        const model = editor.getModel();
        const text = empty ? '' : (model?.getValueInRange(event.selection) ?? '');
        const startOffset = model?.getOffsetAt(event.selection.getStartPosition()) ?? 0;

        this._zone.run(() =>
          this.selectionChange.emit({ hasSelection: !empty, text, startOffset }),
        );
      });

      this.registerShortcuts(monaco, editor);
    });

    this.ready.set(true);

    this._destroyRef.onDestroy(() => {
      disposeCompletion();
      disposeHover();
      clearTimeout(this._diagnosticsTimer);
      this._editor?.dispose();
      this._editor = null;
      this._monaco = null;
    });
  }

  /**
   * Registra los dos temas con el acento vigente.
   *
   * Los dos, aunque solo se vaya a usar uno: cambiar de tema con el editor
   * abierto solo puede ser instantáneo si el otro ya está definido.
   */
  private registerThemes(accent: string | null): void {
    const monaco = this._monaco;

    if (!monaco) {
      return;
    }

    for (const name of Object.keys(DRUSE_THEME_NAMES) as ThemeName[]) {
      monaco.editor.defineTheme(DRUSE_THEME_NAMES[name], druseTheme(name, accent));
    }
  }

  private _diagnosticsTimer?: ReturnType<typeof setTimeout>;

  /**
   * Revisa el SQL contra el catálogo, poco después de dejar de escribir.
   *
   * Con retardo a propósito: subrayar mientras se teclea marcaría como
   * inexistente cada tabla a medio escribir, y el editor se pasaría el rato
   * contradiciendo a quien escribe.
   */
  private scheduleDiagnostics(monaco: typeof MonacoApi): void {
    clearTimeout(this._diagnosticsTimer);

    this._diagnosticsTimer = setTimeout(() => {
      const model = this._editor?.getModel();

      if (!model) {
        return;
      }

      const markers = findProblems(model.getValue(), this.schema()).map((problem) => {
        const start = model.getPositionAt(problem.start);
        const end = model.getPositionAt(problem.end);

        return {
          // Aviso y no error: el catálogo puede estar incompleto, y quien tiene
          // la última palabra sobre el SQL es el servidor.
          severity: monaco.MarkerSeverity.Warning,
          message: problem.message,
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
      });

      monaco.editor.setModelMarkers(model, 'druse', markers);
    }, 600);
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
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      run(() => this.execute.emit()),
    );

    // Ejecutar solo la selección: Ctrl/Cmd + Shift + Enter.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      run(() => this.executeSelection.emit()),
    );

    // Cancelar: Escape. Solo tiene efecto si hay algo ejecutándose; quien lo
    // decide es el shell.
    editor.addCommand(
      monaco.KeyCode.Escape,
      run(() => this.cancel.emit()),
    );

    // Guardar: Ctrl/Cmd + S.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      run(() => this.save.emit()),
    );

    // Guardar como: Ctrl/Cmd + Shift + S.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
      run(() => this.saveAs.emit()),
    );

    // Abrir archivo SQL: Ctrl/Cmd + O.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO,
      run(() => this.openFile.emit()),
    );

    // Nueva consulta: Ctrl/Cmd + T.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT,
      run(() => this.newTab.emit()),
    );

    // Búsqueda global: Ctrl/Cmd + K, el mismo que anuncia la barra de arriba.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
      run(() => this.openPalette.emit()),
    );

    // Formatear: Ctrl/Cmd + Shift + F, el mismo que usa el resto de editores.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
      run(() => void this.formatDocument()),
    );
  }
}
