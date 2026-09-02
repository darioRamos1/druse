import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { ConnectionSummary, QueryTab } from '../../../shared/models/workspace';
import { EngineBadge } from '../../../shared/ui/engine-badge/engine-badge';
import { Icon } from '../../../shared/ui/icon/icon';

/** Barra de pestañas de consultas abiertas. */
@Component({
  selector: 'app-editor-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EngineBadge, Icon],
  templateUrl: './editor-tabs.html',
  styleUrl: './editor-tabs.scss',
})
export class EditorTabs {
  readonly tabs = input.required<readonly QueryTab[]>();
  readonly connections = input.required<readonly ConnectionSummary[]>();
  readonly encoding = input('UTF-8 · LF');

  readonly select = output<string>();
  readonly close = output<string>();
  readonly create = output<void>();

  /** A partir de cuántas pestañas la lista trae su propio buscador. */
  protected readonly searchFrom = 8;

  protected readonly listing = signal(false);
  protected readonly filter = signal('');

  private readonly _host = inject(ElementRef<HTMLElement>);
  private readonly _injector = inject(Injector);
  private readonly _strip = viewChild<ElementRef<HTMLElement>>('strip');
  private readonly _search = viewChild<ElementRef<HTMLInputElement>>('search');

  constructor() {
    /*
     * La pestaña activa siempre a la vista.
     *
     * Se puede llegar a ella sin tocarla —Alt+flechas, la paleta, abrir una
     * tabla del explorador—, y sin esto el editor cambiaba de contenido
     * mientras la tira seguía enseñando otras pestañas.
     */
    effect(() => {
      const index = this.tabs().findIndex((tab) => tab.active);

      if (index < 0) {
        return;
      }

      queueMicrotask(() => {
        this._strip()
          ?.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]')
          [index]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      });
    });
  }

  protected readonly listed = computed<readonly QueryTab[]>(() => {
    const term = this.filter().trim().toLowerCase();

    if (!term) {
      return this.tabs();
    }

    return this.tabs().filter((tab) => {
      const connection = this.connectionFor(tab);
      const context = connection ? `${connection.name} ${tab.database ?? connection.database}` : '';

      return `${tab.title} ${context}`.toLowerCase().includes(term);
    });
  });

  /**
   * La rueda desplaza la tira.
   *
   * El ratón normal solo produce `deltaY`, y sobre una barra horizontal lo que
   * se espera es que mueva las pestañas y no la página de detrás.
   */
  protected onWheel(event: WheelEvent): void {
    const strip = this._strip()?.nativeElement;

    if (!strip || strip.scrollWidth <= strip.clientWidth) {
      return;
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

    if (delta === 0) {
      return;
    }

    event.preventDefault();
    strip.scrollLeft += delta;
  }

  protected toggleListing(): void {
    const open = !this.listing();
    this.listing.set(open);
    this.filter.set('');

    if (open) {
      // Cuando la lista ya está pintada, no antes: se busca dentro de ella.
      afterNextRender(
        () => {
          this._search()?.nativeElement.focus();

          // Con muchas abiertas, la lista se abría por el principio y la que se
          // está usando quedaba fuera: se pierde de vista dónde está uno.
          const actual: HTMLElement | null = this._host.nativeElement.querySelector(
            '.listing__option.is-selected',
          );

          actual?.scrollIntoView?.({ block: 'nearest' });
        },
        { injector: this._injector },
      );
    }
  }

  protected closeListing(): void {
    this.listing.set(false);
    this.filter.set('');
  }

  protected onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  protected choose(id: string): void {
    this.closeListing();
    this.select.emit(id);
  }

  /** Enter en el buscador va a la única que suele quedar. */
  protected chooseFirst(): void {
    const first = this.listed()[0];

    if (first) {
      this.choose(first.id);
    }
  }

  /** Un clic fuera cierra la lista, como los menús de la barra de acciones. */
  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerdown(event: PointerEvent): void {
    if (!this.listing()) {
      return;
    }

    const target = event.target;

    if (target instanceof Node && this._host.nativeElement.contains(target)) {
      return;
    }

    this.closeListing();
  }

  /** Evita que cerrar una pestaña la seleccione antes. */
  protected onClose(event: Event, id: string): void {
    event.stopPropagation();
    this.close.emit(id);
  }

  protected onTabKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    let target = index;

    if (event.key === 'ArrowRight') {
      target = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      target = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      target = 0;
    } else if (event.key === 'End') {
      target = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    this.select.emit(tabs[target].id);
    const tabElements = (
      event.currentTarget as HTMLElement
    ).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
    queueMicrotask(() => tabElements?.[target]?.focus());
  }

  protected stopCloseKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
  }

  protected connectionFor(tab: QueryTab): ConnectionSummary | undefined {
    return this.connections().find((connection) => connection.id === tab.connectionId);
  }
}
