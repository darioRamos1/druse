import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';

import { ReportIdentity } from '../../../shared/models/reports';
import { cleanDetails } from '../report-identity-model';
import { ReportIdentityLogos } from '../report-identity-logos';

/**
 * El encabezado de un tablero con identidad: logo, nombre, subtítulo y datos.
 *
 * Es su propio componente porque se pinta en dos sitios —el tablero y la vista
 * de impresión— y los dos tienen que decir lo mismo. En las hojas que siguen a
 * la primera del PDF va `compact`: solo logo y nombre, en una franja baja.
 * La franja de abajo es del color de marca, con el tono de cada tema.
 */
@Component({
  selector: 'app-report-identity-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './report-identity-header.html',
  styleUrl: './report-identity-header.scss',
  host: { role: 'banner', '[class.compact]': 'compact()' },
})
export class ReportIdentityHeader {
  private readonly _logos = inject(ReportIdentityLogos);

  readonly identity = input.required<ReportIdentity>();
  readonly compact = input(false);

  protected readonly logo = signal<string | null>(null);

  protected details(identity: ReportIdentity): string {
    return cleanDetails(identity.details).join(' · ');
  }

  private readonly loadLogo = effect(() => {
    const identity = this.identity();
    this.logo.set(null);

    void this._logos.get(identity).then((logo) => {
      // Puede haber cambiado de identidad mientras llegaba.
      if (this.identity().id === identity.id) {
        this.logo.set(logo);
      }
    });
  });
}
