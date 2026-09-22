import { Pipe, PipeTransform, inject } from '@angular/core';

import { I18nService } from './i18n.service';
import { MessageParams } from './icu';

/**
 * `{{ 'settings.title' | t }}` en las plantillas.
 *
 * Impuro porque el resultado cambia con el idioma sin que cambie la clave. Para
 * no formatear en cada pasada guarda el último resultado, y solo lo rehace si
 * cambian la clave, los parámetros o el idioma.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly _i18n = inject(I18nService);

  private _key: string | null = null;
  private _params = '';
  private _locale: string | null = null;
  private _value = '';

  transform(key: string, params?: MessageParams): string {
    const serialized = params ? JSON.stringify(params) : '';
    const locale = this._i18n.locale();

    if (key !== this._key || serialized !== this._params || locale !== this._locale) {
      this._key = key;
      this._params = serialized;
      this._locale = locale;
      this._value = this._i18n.t(key, params);
    }

    return this._value;
  }
}
