import { DEFAULT_FORMAT_SETTINGS } from '../../../core/workspace/format-settings';
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

  it('respeta las comillas invertidas de MySQL', async () => {
    const result = await formatSql('select `id` from `druse_test`.`usuarios`', 'mysql');

    // En MySQL las comillas invertidas son lo que permite que una columna se
    // llame `order` o `group`. Perderlas rompería la consulta.
    expect(result.sql).toContain('`id`');
    expect(result.sql).toContain('`usuarios`');
    expect(result.error).toBeUndefined();
  });

  it('formatea el LIMIT de MySQL', async () => {
    const result = await formatSql('select * from usuarios limit 10 offset 20', 'mysql');

    expect(result.sql).toContain('LIMIT');
    expect(result.sql).toContain('OFFSET');
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

  describe('ajustes elegidos por el usuario', () => {
    const sql = 'select id, name from users where active = true and age > 18';

    it('el estilo tabular alinea los valores tras la palabra clave', async () => {
      const estandar = await formatSql(sql, 'postgresql', DEFAULT_FORMAT_SETTINGS);
      const tabular = await formatSql(sql, 'postgresql', {
        ...DEFAULT_FORMAT_SETTINGS,
        style: 'tabular',
      });

      // En estándar la palabra clave se queda sola en su línea; en tabular
      // arrastra el primer valor a su derecha.
      expect(estandar.sql).toMatch(/^SELECT\n/);
      expect(tabular.sql).toMatch(/^SELECT\s+id/);
    });

    it('deja las palabras clave como están cuando se pide', async () => {
      const result = await formatSql(sql, 'postgresql', {
        ...DEFAULT_FORMAT_SETTINGS,
        keywordCase: 'preserve',
      });

      expect(result.sql).toContain('select');
      expect(result.sql).not.toContain('SELECT');
    });

    /**
     * El ancho manda sobre las expresiones —los argumentos de una función, una
     * lista—, no sobre las cláusulas: `FROM` siempre empieza línea.
     */
    it('un ancho mayor deja la expresión larga en una sola línea', async () => {
      const largo = "select concat(nombre, ' ', apellido, ' ', ciudad) as etiqueta from usuarios";

      const estrecho = await formatSql(largo, 'postgresql', {
        ...DEFAULT_FORMAT_SETTINGS,
        expressionWidth: 20,
      });
      const ancho = await formatSql(largo, 'postgresql', {
        ...DEFAULT_FORMAT_SETTINGS,
        expressionWidth: 120,
      });

      expect(estrecho.sql).toMatch(/concat\(\n/);
      expect(ancho.sql).toContain("concat(nombre, ' ', apellido, ' ', ciudad)");
      expect(ancho.sql.split('\n').length).toBeLessThan(estrecho.sql.split('\n').length);
    });

    it('sangra con tabulaciones cuando se pide', async () => {
      const result = await formatSql(sql, 'postgresql', {
        ...DEFAULT_FORMAT_SETTINGS,
        indent: 'tabs',
      });

      expect(result.sql).toContain('\t');
    });

    it('sangra con cuatro espacios cuando se pide', async () => {
      const result = await formatSql(sql, 'postgresql', {
        ...DEFAULT_FORMAT_SETTINGS,
        indent: 'spaces4',
      });

      expect(result.sql).toContain('\n    id');
    });
  });
});
