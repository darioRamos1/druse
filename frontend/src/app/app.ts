import { Component, inject, signal } from '@angular/core';

import { ApplicationGateway, HealthStatus } from './core/application-gateway/application-gateway';

/**
 * Pantalla provisional de la Fase 0: comprueba que la interfaz alcanza la API local.
 * En la Fase 1 se reemplaza por el shell del mockup (docs/mockups/druse-main.html).
 */
@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly _gateway = inject(ApplicationGateway);

  protected readonly health = signal<HealthStatus | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly checking = signal(false);

  constructor() {
    this.check();
  }

  protected check(): void {
    this.checking.set(true);
    this.error.set(null);

    this._gateway.getHealth().subscribe({
      next: (health) => {
        this.health.set(health);
        this.checking.set(false);
      },
      error: () => {
        // Sin detalles del error a propósito: nunca se muestran rutas ni cadenas
        // de conexión en la interfaz (plan §12).
        this.health.set(null);
        this.error.set('No se pudo contactar con la API local.');
        this.checking.set(false);
      },
    });
  }
}
