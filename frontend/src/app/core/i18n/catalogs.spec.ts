import en from '../../../i18n/en.json';
import es from '../../../i18n/es.json';
import fr from '../../../i18n/fr.json';
import ptBR from '../../../i18n/pt-BR.json';
import { messageParams, parseMessage } from './icu';

/**
 * La guarda de los catálogos, que corre en la CI con el resto de las pruebas.
 *
 * Usa el mismo analizador que la aplicación: un mensaje que aquí pasa es uno
 * que la aplicación sabe pintar.
 */
const catalogs: Record<string, Record<string, string>> = { es, en, 'pt-BR': ptBR, fr };

describe('catálogos de idioma', () => {
  it('el inglés tiene exactamente las claves del español', () => {
    // El inglés es el respaldo de los demás: una clave que le falte se vería en
    // español a quien tiene Druse en francés.
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it.each(['pt-BR', 'fr'])('%s no tiene claves que el español no conozca', (locale) => {
    const extra = Object.keys(catalogs[locale]).filter((key) => !(key in es));

    expect(extra).toEqual([]);
  });

  it.each(Object.keys(catalogs))('todos los mensajes de %s son ICU válido', (locale) => {
    const broken = Object.entries(catalogs[locale]).flatMap(([key, message]) => {
      try {
        parseMessage(message);
        return [];
      } catch (error) {
        return [`${key}: ${(error as Error).message}`];
      }
    });

    expect(broken).toEqual([]);
  });

  it.each(['en', 'pt-BR', 'fr'])('%s usa los mismos parámetros que el español', (locale) => {
    const mismatched = Object.entries(catalogs[locale]).flatMap(([key, message]) => {
      const source = es[key as keyof typeof es];

      if (source === undefined) {
        return [];
      }

      const expected = messageParams(source).join(',');
      const actual = messageParams(message).join(',');

      return expected === actual ? [] : [`${key}: espera {${expected}}, tiene {${actual}}`];
    });

    expect(mismatched).toEqual([]);
  });

  it('las claves siguen el formato feature.parte.nombre', () => {
    const malformed = Object.keys(es).filter((key) => !/^[a-z][\w-]*(\.[\w-]+)+$/i.test(key));

    expect(malformed).toEqual([]);
  });
});
