import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/** Menú desplegable nativo: cierra al salir y devuelve el foco con Escape. */
@Directive({ selector: 'details[appDisclosure]', exportAs: 'disclosure' })
export class Disclosure {
  private readonly host = inject<ElementRef<HTMLDetailsElement>>(ElementRef);

  close(restoreFocus = false): void {
    this.host.nativeElement.open = false;
    if (restoreFocus) {
      this.host.nativeElement.querySelector('summary')?.focus();
    }
  }

  @HostListener('keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.host.nativeElement.open) {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onOutside(event: Event): void {
    if (event.target instanceof Node && !this.host.nativeElement.contains(event.target)) {
      this.close();
    }
  }

  @HostListener('focusout', ['$event'])
  protected onFocusOut(event: FocusEvent): void {
    if (
      !(event.relatedTarget instanceof Node) ||
      !this.host.nativeElement.contains(event.relatedTarget)
    ) {
      this.close();
    }
  }
}
