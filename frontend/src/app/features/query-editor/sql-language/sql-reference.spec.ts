import { functionsFor } from './sql-keywords';
import { describeReference, referenceFor, signatureLabel } from './sql-reference';
import { SQL_REFERENCE_EN } from './sql-reference.en';
import { SQL_REFERENCE_ES } from './sql-reference.es';

describe('catálogo de funciones y palabras', () => {
  it('no sugiere en SQL Server funciones que allí no existen', () => {
    const sqlServer = functionsFor('sqlserver');

    expect(sqlServer).toContain('LEN');
    expect(sqlServer).toContain('CEILING');
    expect(sqlServer).not.toContain('LENGTH');
    expect(sqlServer).not.toContain('CEIL');
  });

  it('cada motor recibe sus funciones propias', () => {
    expect(functionsFor('oracle')).toContain('NVL');
    expect(functionsFor('sqlserver')).toContain('ISNULL');
    expect(functionsFor('postgresql')).not.toContain('ISNULL');
  });

  it('no repite un nombre aunque tenga dos entradas', () => {
    const nombres = functionsFor('sqlserver');

    expect(nombres.filter((nombre) => nombre === 'DATEDIFF')).toHaveLength(1);
  });

  it('encuentra las entradas sin distinguir mayúsculas', () => {
    expect(referenceFor('coalesce')?.name).toBe('COALESCE');
    expect(referenceFor('group by')?.name).toBe('GROUP BY');
  });

  it('escribe la firma como se escribe la llamada', () => {
    expect(signatureLabel(referenceFor('COALESCE')!)).toBe('COALESCE(valor, alternativa, …)');
    expect(signatureLabel(referenceFor('GETDATE', 'sqlserver')!)).toBe('GETDATE()');
  });

  it('la descripción dice de qué motor es lo que no es de todos', () => {
    expect(describeReference(referenceFor('NVL', 'oracle')!)).toContain('Oracle, Informix');
    expect(describeReference(referenceFor('COALESCE')!)).not.toContain('_Oracle');
  });
});

/**
 * Las dos referencias tienen que describir lo mismo.
 *
 * Es el riesgo de tener un archivo por idioma en vez de claves en el catálogo:
 * que una entrada nueva se añada en español y nadie se acuerde del inglés. Y una
 * referencia que se queda atrás es peor que no tenerla, porque explica una
 * función que ese motor no tiene o con los parámetros al revés.
 */
describe('la referencia traducida', () => {
  const firma = (entry: (typeof SQL_REFERENCE_ES)[number]) =>
    [
      entry.name,
      entry.kind,
      (entry.engines ?? []).join('|'),
      entry.variadic ? 'variadic' : '',
      (entry.params ?? []).length,
      // El ejemplo se traduce —`pedidos` es `orders`—, así que se compara que
      // lo haya y no lo que dice.
      entry.example ? 'con ejemplo' : 'sin ejemplo',
    ].join(' · ');

  it('tiene las mismas entradas que el original, en el mismo orden', () => {
    expect(SQL_REFERENCE_EN.map(firma)).toEqual(SQL_REFERENCE_ES.map(firma));
  });

  it('no deja ninguna entrada sin traducir', () => {
    const iguales = SQL_REFERENCE_EN.filter((entry, index) => {
      const original = SQL_REFERENCE_ES[index];

      // Hay resúmenes que coinciden porque no hay nada que traducir; los que
      // llevan palabras se comparan.
      return (
        entry.summary === original.summary && /[a-záéíóúñ]{4,} [a-záéíóúñ]{3,}/.test(entry.summary)
      );
    });

    expect(iguales.map((entry) => entry.name)).toEqual([]);
  });
});
