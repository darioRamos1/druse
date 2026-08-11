import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { App } from './app';
import { ApplicationGateway, HealthStatus } from './core/application-gateway/application-gateway';

const healthyResponse: HealthStatus = {
  status: 'ok',
  product: 'Druse',
  version: '0.1.0',
  environment: 'Development',
  timestampUtc: '2026-01-01T00:00:00+00:00',
};

describe('App', () => {
  async function setup(gateway: Partial<ApplicationGateway>): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();
  }

  it('se crea correctamente', async () => {
    await setup({ getHealth: () => of(healthyResponse) });

    const fixture = TestBed.createComponent(App);

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('muestra la marca', async () => {
    await setup({ getHealth: () => of(healthyResponse) });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Druse');
  });

  it('informa cuando la API local responde', async () => {
    await setup({ getHealth: () => of(healthyResponse) });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('API local activa');
  });

  it('informa cuando la API local no responde, sin exponer detalles', async () => {
    await setup({ getHealth: () => throwError(() => new Error('ECONNREFUSED 127.0.0.1:5177')) });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('No se pudo contactar');
    expect(compiled.textContent).not.toContain('ECONNREFUSED');
  });
});
