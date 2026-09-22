import { functionsFor } from './sql-keywords';
import { describeReference, referenceFor, signatureLabel } from './sql-reference';

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
