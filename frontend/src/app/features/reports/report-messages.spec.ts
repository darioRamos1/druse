import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApplicationGateway } from '../../core/application-gateway/application-gateway';
import { I18nService } from '../../core/i18n/i18n.service';
import { failureText, serverText } from './report-messages';

describe('Mensajes de Reportes en el idioma de la ventana', () => {
  let i18n: I18nService;

  const tiposDistintos = {
    key: 'server.reports.joinTypesDiffer',
    text: 'Las columnas mes y fecha tienen tipos distintos.',
    args: { left: 'mes', right: 'fecha' },
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationGateway, useValue: { setPreference: () => of(undefined) } }],
    });
    i18n = TestBed.inject(I18nService);
  });

  afterEach(async () => {
    await i18n.setLocale('es', { persist: false });
    document.documentElement.lang = 'es';
  });

  it('escribe con su clave el motivo de Druse, también en inglés', async () => {
    expect(serverText(i18n, tiposDistintos, null)).toBe('Las columnas mes y fecha tienen tipos distintos.');

    await i18n.setLocale('en', { persist: false });

    expect(serverText(i18n, tiposDistintos, null)).toBe('The columns mes and fecha have different types.');
    expect(serverText(i18n, { key: 'server.reports.interrupted', text: 'x' }, 'x')).toBe(
      'Druse closed while refreshing. The previous data is kept.',
    );
  });

  it('sin clave enseña el texto: un intento viejo o un error del motor', async () => {
    await i18n.setLocale('en', { persist: false });

    expect(serverText(i18n, null, 'No se pudo leer alguna fuente.')).toBe('No se pudo leer alguna fuente.');
    expect(failureText(i18n, 'database-error', 'relation "ventas" does not exist', null)).toBe(
      'relation "ventas" does not exist',
    );
    expect(failureText(i18n, 'invalid-query', 'texto', { key: 'server.reports.readOnlyQuery', text: 'texto' })).toBe(
      'Report sources must use read-only queries.',
    );
  });
});
