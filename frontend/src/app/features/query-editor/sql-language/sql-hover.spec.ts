import { SchemaIndex } from '../../../shared/models/workspace';
import { registerSqlHover } from './sql-hover';

function col(
  name: string,
  dataType: string,
  { pk = false, nullable = false }: { pk?: boolean; nullable?: boolean } = {},
) {
  return { name, dataType, isPrimaryKey: pk, isNullable: nullable };
}

const schema: SchemaIndex = {
  schemas: ['tpublico'],
  relations: [
    {
      schema: 'tpublico',
      name: 'usuarios',
      kind: 'table',
      qualified: 'tpublico.usuarios',
      columns: [
        col('id', 'int', { pk: true }),
        col('nombre', 'varchar(200)'),
        col('correo', 'varchar(200)', { nullable: true }),
      ],
    },
    {
      schema: 'tpublico',
      name: 'activos',
      kind: 'view',
      qualified: 'tpublico.activos',
      columns: [],
    },
  ],
};

/** Monaco mínimo: solo lo que el proveedor de tooltips usa. */
function fakeMonaco() {
  let captured: any = null;

  return {
    monaco: {
      languages: {
        registerHoverProvider: (_language: string, provider: any) => {
          captured = provider;
          return { dispose: () => undefined };
        },
      },
    },
    provider: () => captured,
  };
}

/** Devuelve el texto del tooltip al posarse sobre `palabra` dentro de `sql`. */
function hover(sql: string, palabra: string): string | null {
  const { monaco, provider } = fakeMonaco();
  registerSqlHover(monaco as never, () => ({ schema }));

  const lines = sql.split('\n');
  const lineNumber = lines.findIndex((line) => line.includes(palabra)) + 1;
  const line = lines[lineNumber - 1];
  const startColumn = line.indexOf(palabra) + 1;

  const model = {
    getValue: () => sql,
    getLineContent: (n: number) => lines[n - 1],
    getWordAtPosition: () => ({
      word: palabra,
      startColumn,
      endColumn: startColumn + palabra.length,
    }),
  };

  const result = provider().provideHover(model as never, {
    lineNumber,
    column: startColumn + 1,
  });

  return result ? (result.contents[0].value as string) : null;
}

describe('tooltip del editor', () => {
  it('sobre una tabla describe qué es y qué columnas tiene', () => {
    const texto = hover('SELECT * FROM tpublico.usuarios', 'usuarios');

    expect(texto).toContain('**Tabla**');
    expect(texto).toContain('tpublico.usuarios');
    expect(texto).toContain('3 columnas');
    expect(texto).toContain('**nombre**');
  });

  it('distingue una vista de una tabla', () => {
    expect(hover('SELECT * FROM tpublico.activos', 'activos')).toContain('**Vista**');
  });

  it('no dice que una tabla no tiene columnas cuando solo faltan por cargar', () => {
    const texto = hover('SELECT * FROM tpublico.activos', 'activos');

    // Decir «0 columnas» sería mentir sobre el servidor.
    expect(texto).toContain('aún no se han cargado');
  });

  it('sobre un alias describe la tabla a la que apunta', () => {
    expect(hover('SELECT * FROM tpublico.usuarios u', 'u')).toContain('tpublico.usuarios');
  });

  it('sobre una columna da su tipo y si admite nulos', () => {
    const texto = hover('SELECT u.correo FROM tpublico.usuarios u', 'correo');

    expect(texto).toContain('varchar(200)');
    expect(texto).toContain('Admite nulos');
  });

  it('marca la clave primaria', () => {
    const texto = hover('SELECT u.id FROM tpublico.usuarios u', 'id');

    expect(texto).toContain('clave primaria');
    expect(texto).toContain('No admite nulos');
  });

  it('no inventa nada sobre lo que no conoce', () => {
    expect(hover('SELECT * FROM tpublico.usuarios WHERE loquesea = 1', 'loquesea')).toBeNull();
  });
});
