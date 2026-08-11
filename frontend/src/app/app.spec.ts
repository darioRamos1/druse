import { TestBed } from '@angular/core/testing';

import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('monta el shell de la aplicación', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('app-shell')).toBeTruthy();
    expect(compiled.querySelector('app-top-bar')).toBeTruthy();
    expect(compiled.querySelector('app-status-bar')).toBeTruthy();
  });
});
