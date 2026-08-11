import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationGateway, HealthStatus } from './application-gateway';

/**
 * Implementación del gateway sobre HTTP contra la API local.
 *
 * Las rutas son relativas a propósito: en desarrollo las resuelve el proxy de
 * Angular hacia 127.0.0.1 y en producción las resolverá el host que empaquete
 * la aplicación. Ningún componente debe conocer host ni puerto.
 */
@Injectable()
export class HttpApplicationGateway extends ApplicationGateway {
  private readonly _http = inject(HttpClient);

  override getHealth(): Observable<HealthStatus> {
    return this._http.get<HealthStatus>('/api/health');
  }
}
