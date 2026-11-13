import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApplicationGateway } from '../../core/application-gateway/application-gateway';
import { ReportIdentity } from '../../shared/models/reports';
import { logoUrl } from './report-identity-logo';

/**
 * Los logos de las identidades, pedidos una vez.
 *
 * Un tablero con identidad pinta su logo en el encabezado y, al imprimir, otra
 * vez en cada página: sin esto serían varias peticiones del mismo medio MiB. La
 * clave lleva la fecha del logo, así que uno cambiado se vuelve a pedir solo.
 */
@Injectable({ providedIn: 'root' })
export class ReportIdentityLogos {
  private readonly _gateway = inject(ApplicationGateway);
  private readonly _cache = new Map<string, Promise<string | null>>();

  /** El logo como `data:` listo para un `<img>`, o `null` si no tiene o no llega. */
  get(identity: ReportIdentity): Promise<string | null> {
    if (!identity.logoUpdatedAtUtc) {
      return Promise.resolve(null);
    }

    const key = `${identity.id}:${identity.logoUpdatedAtUtc}`;
    let logo = this._cache.get(key);

    if (!logo) {
      logo = firstValueFrom(this._gateway.getReportIdentityLogo(identity.id))
        .then(logoUrl)
        .catch(() => {
          // Un fallo no se queda guardado: la próxima vez se vuelve a intentar.
          this._cache.delete(key);
          return null;
        });
      this._cache.set(key, logo);
    }

    return logo;
  }
}
