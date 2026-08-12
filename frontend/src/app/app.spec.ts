import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { App } from './app';
import { ApplicationGateway } from './core/application-gateway/application-gateway';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        // El shell arranca sin API detrás: lo que se comprueba aquí es que monta.
        {
          provide: ApplicationGateway,
          useValue: { getEngines: () => of([]), getDatabases: () => of([]) },
        },
      ],
    }).compileComponents();
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
