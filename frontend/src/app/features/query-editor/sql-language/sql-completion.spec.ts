import { SchemaIndex } from '../../../shared/models/workspace';
import { registerSqlCompletion } from './sql-completion';

/**
 * Monaco mínimo para poder probar el proveedor sin cargar el editor entero.
 *
 * Solo se implementa lo que el proveedor usa; si algún día usa más, esta doble
 * fallará y habrá que ampliarla, que es lo correcto.
 */
function fakeMonaco() {
  let captured: any = null;

  const monaco = {
    languages: {
      CompletionItemKind: { Field: 1, Struct: 2, Interface: 3, Module: 4, Keyword: 5, Function: 6 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: (_language: string, provider: any) => {
        captured = provider;
        return { dispose: () => undefined };
      },
    },
  };

  return { monaco, provider: () => captured };
}

/** Modelo de texto mínimo, con el contenido y la posición del cursor. */
function fakeModel(text: string) {
  const lines = text.split('\n');

  return {
    getValue: () => text,
    getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
    getValueInRange: (range: any) => {
      const line = lines[range.startLineNumber - 1] ?? '';
      return line.slice(range.startColumn - 1, range.endColumn - 1);
    },
  };
}

const schema: SchemaIndex = {
  schemas: ['public'],
  relations: [
    {
      schema: 'public',
      name: 'users',
      kind: 'table',
      qualified: 'public.users',
      columns: ['id', 'name', 'email'],
    },
    {
      schema: 'public',
      name: 'pedidos',
      kind: 'table',
      qualified: 'public.pedidos',
      columns: ['id', 'total'],
    },
    {
      schema: 'public',
      name: 'usuarios_activos',
      kind: 'view',
      qualified: 'public.usuarios_activos',
      columns: ['id'],
    },
  ],
};

function complete(sql: string, engine: 'postgresql' | 'sqlserver' = 'postgresql') {
  const { monaco, provider } = fakeMonaco();

  registerSqlCompletion(monaco as never, () => ({ engine, schema }));

  const lines = sql.split('\n');
  const position = { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };

  const result = provider().provideCompletionItems(fakeModel(sql) as never, position);

  return result.suggestions as { label: string; detail?: string }[];
}

describe('autocompletado SQL', () => {
  it('sugiere tablas, esquemas y palabras reservadas', () => {
    const labels = complete('SELECT ').map((item) => item.label);

    expect(labels).toContain('users');
    expect(labels).toContain('public');
    expect(labels).toContain('FROM');
  });

  it('las tablas van antes que las palabras reservadas', () => {
    const suggestions = complete('SELECT ');

    const table = suggestions.findIndex((item) => item.label === 'users');
    const keyword = suggestions.findIndex((item) => item.label === 'SELECT');

    // Es lo que más se escribe; enterrarlo bajo las reservadas sería inútil.
    expect(table).toBeLessThan(keyword);
  });

  it('tras un punto sugiere solo las columnas de esa tabla', () => {
    const labels = complete('SELECT * FROM users\nWHERE users.').map((item) => item.label);

    expect(labels).toEqual(['id', 'name', 'email']);
  });

  it('resuelve los alias declarados en el FROM', () => {
    // El cursor va justo detrás del punto, que es donde se dispara la sugerencia.
    const labels = complete('SELECT *\nFROM users u\nWHERE u.').map((item) => item.label);

    // Sin resolver el alias, escribir `u.` no sugeriría nada útil.
    expect(labels).toEqual(['id', 'name', 'email']);
  });

  it('resuelve alias con AS', () => {
    const labels = complete('SELECT *\nFROM pedidos AS p\nWHERE p.').map((item) => item.label);

    expect(labels).toEqual(['id', 'total']);
  });

  it('distingue los alias de varias tablas', () => {
    const sql = 'SELECT * FROM users u JOIN pedidos p ON p.id = u.id\nWHERE p.';
    const labels = complete(sql).map((item) => item.label);

    expect(labels).toEqual(['id', 'total']);
  });

  it('no sugiere nada tras un punto de algo desconocido', () => {
    expect(complete('SELECT desconocida.')).toEqual([]);
  });

  it('sugiere lo propio de cada motor', () => {
    expect(complete('SELECT ', 'postgresql').map((i) => i.label)).toContain('ILIKE');
    expect(complete('SELECT ', 'sqlserver').map((i) => i.label)).toContain('TOP');

    // Y no mezcla dialectos.
    expect(complete('SELECT ', 'sqlserver').map((i) => i.label)).not.toContain('ILIKE');
  });

  it('indica cuántas columnas tiene cada tabla', () => {
    const users = complete('SELECT ').find((item) => item.label === 'users');

    expect(users?.detail).toContain('3 columnas');
  });
});
