import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  viewChild,
  ElementRef,
  HostListener,
} from '@angular/core';

import { ConnectionSummary, ExplorerNode } from '../../shared/models/workspace';
import { EngineBadge } from '../../shared/ui/engine-badge/engine-badge';
import { Icon } from '../../shared/ui/icon/icon';

type PaletteItem =
  | { readonly id: string; readonly kind: 'command'; readonly label: string; readonly hint: string }
  | {
      readonly id: string;
      readonly kind: 'connection';
      readonly label: string;
      readonly hint: string;
      readonly connection: ConnectionSummary;
    }
  | {
      readonly id: string;
      readonly kind: 'object';
      readonly label: string;
      readonly hint: string;
      readonly node: ExplorerNode;
    };

@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, EngineBadge],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
})
export default class CommandPalette implements AfterViewInit {
  readonly connections = input.required<readonly ConnectionSummary[]>();
  readonly nodes = input.required<readonly ExplorerNode[]>();

  readonly closed = output<void>();
  readonly newConnection = output<void>();
  readonly newQuery = output<void>();
  readonly executeQuery = output<void>();

  /** Ejecutar solo la instrucción del cursor, o la selección si la hay. */
  readonly executeCurrent = output<void>();
  readonly formatQuery = output<void>();
  readonly showHistory = output<void>();
  readonly activateConnection = output<string>();
  readonly openNode = output<ExplorerNode>();

  protected readonly query = signal('');
  protected readonly selected = signal(0);
  private readonly _input = viewChild<ElementRef<HTMLInputElement>>('search');
  private _returnFocus: HTMLElement | null = null;

  protected readonly items = computed<readonly PaletteItem[]>(() => {
    const term = this.query().trim().toLowerCase();
    const commands: PaletteItem[] = [
      { id: 'new-query', kind: 'command', label: 'Nueva consulta', hint: 'Ctrl+T' },
      { id: 'new-connection', kind: 'command', label: 'Nueva conexión', hint: 'Crear perfil' },
      { id: 'execute', kind: 'command', label: 'Ejecutar consulta activa', hint: 'Ctrl+Enter' },
      {
        id: 'execute-current',
        kind: 'command',
        label: 'Ejecutar instrucción actual',
        hint: 'Ctrl+Shift+Enter',
      },
      { id: 'format', kind: 'command', label: 'Formatear SQL', hint: 'Ctrl+Shift+F' },
      { id: 'history', kind: 'command', label: 'Abrir historial', hint: 'Consultas anteriores' },
    ];
    const connections: PaletteItem[] = this.connections().map((connection) => ({
      id: `connection:${connection.id}`,
      kind: 'connection',
      label: connection.name,
      hint: `${connection.database} · ${connection.state === 'connected' ? 'conectada' : 'sin conexión'}`,
      connection,
    }));
    const objects: PaletteItem[] = this.nodes()
      .filter((node) => node.kind === 'table' || node.kind === 'view')
      .map((node) => ({
        id: `object:${node.id}`,
        kind: 'object',
        label: node.label,
        hint: `${this.connections().find((connection) => connection.id === node.connectionId)?.name ?? 'Conexión'} · ${node.source.database ?? ''} · ${node.source.schema ? `${node.source.schema}.` : ''}${node.source.name} · ${node.kind === 'view' ? 'vista' : 'tabla'}`,
        node,
      }));

    const all = [...commands, ...connections, ...objects];

    return term
      ? all.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(term))
      : all;
  });

  ngAfterViewInit(): void {
    this._returnFocus = document.activeElement as HTMLElement | null;
    queueMicrotask(() => this._input()?.nativeElement.focus());
  }

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (
      event.key === 'Escape' ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    }
  }

  protected close(): void {
    this.closed.emit();
    queueMicrotask(() => this._returnFocus?.focus());
  }

  closeWithoutRestoringFocus(): void {
    this.closed.emit();
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.selected.set(0);
  }

  protected move(delta: number): void {
    const length = this.items().length;

    if (length > 0) {
      this.selected.update((current) => (current + delta + length) % length);
      queueMicrotask(() =>
        document
          .getElementById(`palette-option-${this.selected()}`)
          ?.scrollIntoView({ block: 'nearest' }),
      );
    }
  }

  protected run(item = this.items()[this.selected()]): void {
    if (!item) {
      return;
    }

    if (item.kind === 'command') {
      switch (item.id) {
        case 'new-query':
          this.newQuery.emit();
          break;
        case 'new-connection':
          this.closeWithoutRestoringFocus();
          this.newConnection.emit();
          return;
        case 'execute':
          this.executeQuery.emit();
          break;
        case 'execute-current':
          this.executeCurrent.emit();
          break;
        case 'format':
          this.formatQuery.emit();
          break;
        case 'history':
          this.showHistory.emit();
          break;
      }
    } else if (item.kind === 'connection') {
      this.activateConnection.emit(item.connection.id);
    } else {
      this.openNode.emit(item.node);
    }

    this.close();
  }

  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }

    const palette = event.currentTarget as HTMLElement;
    const focusable = [...palette.querySelectorAll<HTMLElement>('input, button')];
    const first = focusable[0];
    const last = focusable.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
