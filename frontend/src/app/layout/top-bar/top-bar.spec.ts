import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TopBar } from './top-bar';

describe('TopBar: Archivo', () => {
  let fixture: ComponentFixture<TopBar>;
  let details: HTMLDetailsElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TopBar] }).compileComponents();
    fixture = TestBed.createComponent(TopBar);
    fixture.detectChanges();
    details = fixture.nativeElement.querySelector('details');
  });

  it('abrir el menú no abre ni guarda archivos', () => {
    const open = vi.fn();
    const save = vi.fn();
    fixture.componentInstance.openSql.subscribe(open);
    fixture.componentInstance.saveSql.subscribe(save);
    details.querySelector('summary')!.click();
    expect(details.open).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('cada acción emite una sola intención y cierra el menú', () => {
    const actions: string[] = [];
    fixture.componentInstance.openSql.subscribe(() => actions.push('open'));
    fixture.componentInstance.saveSql.subscribe(() => actions.push('save'));
    fixture.componentInstance.saveSqlAs.subscribe(() => actions.push('save-as'));
    for (const button of details.querySelectorAll('button')) {
      details.open = true;
      button.click();
      expect(details.open).toBe(false);
    }
    expect(actions).toEqual(['open', 'save', 'save-as']);
  });

  it('Escape cierra y devuelve el foco a Archivo', () => {
    details.open = true;
    const button = details.querySelector('button')!;
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector('summary'));
  });

  it('cierra al pulsar fuera o llevar el foco a otra zona', () => {
    details.open = true;
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(details.open).toBe(false);
    details.open = true;
    details.dispatchEvent(
      new FocusEvent('focusout', { relatedTarget: document.body, bubbles: true }),
    );
    expect(details.open).toBe(false);
  });
});
