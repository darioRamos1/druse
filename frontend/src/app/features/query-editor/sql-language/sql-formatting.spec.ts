import { formatSql } from './sql-formatting';

describe('formatSql', () => {
  it('pone las palabras reservadas en mayúsculas y reparte en líneas', async () => {
    const result = await formatSql('select id, name from users where active = true', 'postgresql');

    expect(result.changed).toBe(true);
    expect(result.sql).toContain('SELECT');
    expect(result.sql).toContain('FROM');
    expect(result.sql.split('\n').length).toBeGreaterThan(1);
  });

  it('respeta el casting de PostgreSQL', async () => {
    const result = await formatSql("select '42'::int8 as n", 'postgresql');

    // Partir `::` cambiaría el significado del SQL.
    expect(result.sql).toContain('::');
    expect(result.error).toBeUndefined();
  });

  it('respeta los corchetes de SQL Server', async () => {
    const result = await formatSql('select [id] from [dbo].[usuarios]', 'sqlserver');

    expect(result.sql).toContain('[dbo]');
    expect(result.sql).toContain('[usuarios]');
    expect(result.error).toBeUndefined();
  });

  it('formatea T-SQL con TOP', async () => {
    const result = await formatSql('select top 10 * from dbo.usuarios', 'sqlserver');

    expect(result.sql).toContain('TOP');
    expect(result.error).toBeUndefined();
  });

  it('no toca un texto vacío', async () => {
    const result = await formatSql('   ', 'postgresql');

    expect(result.changed).toBe(false);
    expect(result.sql).toBe('   ');
  });

  it('devuelve el texto intacto si no se puede analizar', async () => {
    // A medio escribir, que es el estado normal mientras se teclea.
    const original = 'SELECT * FROM WHERE ((';
    const result = await formatSql(original, 'postgresql');

    // Reformatear a la fuerza algo que no se entendió sería la forma más rápida
    // de que alguien pierda trabajo.
    if (result.error) {
      expect(result.sql).toBe(original);
      expect(result.changed).toBe(false);
    }
  });

  it('no marca cambio si ya estaba formateado', async () => {
    const once = await formatSql('select 1', 'postgresql');
    const twice = await formatSql(once.sql, 'postgresql');

    expect(twice.changed).toBe(false);
  });
});
