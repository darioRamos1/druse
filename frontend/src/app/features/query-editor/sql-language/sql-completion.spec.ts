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

/**
 * Una base con esquema propio y nombres repetidos, como las de verdad.
 *
 * `tpublico` viene de un caso real: un SQL Server de preproducción donde nada
 * cuelga de `dbo`. Ahí es donde el autocompletado tiene que acertar, no en la
 * base de juguete con un solo esquema.
 */
const multiSchema: SchemaIndex = {
  schemas: ['dbo', 'tpublico'],
  relations: [
    {
      schema: 'tpublico',
      name: 'usuarios',
      kind: 'table',
      qualified: 'tpublico.usuarios',
      columns: ['id', 'nombre', 'correo'],
    },
    {
      schema: 'tpublico',
      name: 'facturas',
      kind: 'table',
      qualified: 'tpublico.facturas',
      columns: ['id', 'importe'],
    },
    {
      schema: 'dbo',
      name: 'usuarios',
      kind: 'table',
      qualified: 'dbo.usuarios',
      columns: ['user_id', 'login'],
    },
  ],
};

function complete(
  sql: string,
  engine: 'postgresql' | 'sqlserver' = 'postgresql',
  index: SchemaIndex = schema,
) {
  const { monaco, provider } = fakeMonaco();

  registerSqlCompletion(monaco as never, () => ({ engine, schema: index }));

  const lines = sql.split('\n');
  const position = { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 };

  const result = provider().provideCompletionItems(fakeModel(sql) as never, position);

  return result.suggestions as { label: string; detail?: string; insertText?: string }[];
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

  describe('con esquema propio', () => {
    const conEsquemas = (sql: string) => complete(sql, 'sqlserver', multiSchema);

    it('tras el punto de un esquema sugiere sus tablas', () => {
      // El caso que lo destapó: en una base sin nada en `dbo`, escribir el
      // esquema y el punto dejaba el desplegable vacío.
      const labels = conEsquemas('SELECT * FROM tpublico.').map((item) => item.label);

      expect(labels).toEqual(['usuarios', 'facturas']);
    });

    it('no mezcla las tablas de otro esquema', () => {
      const detalles = conEsquemas('SELECT * FROM tpublico.').map((item) => item.detail);

      expect(detalles.every((detalle) => detalle?.startsWith('tpublico.'))).toBe(true);
    });

    it('tras el esquema inserta solo el nombre de la tabla', () => {
      const [primera] = conEsquemas('SELECT * FROM tpublico.');

      // Insertar el calificado daría `tpublico.tpublico.usuarios`.
      expect(primera.insertText).toBe('usuarios');
    });

    it('sin esquema escrito inserta el nombre calificado', () => {
      const tabla = conEsquemas('SELECT * FROM ').find((item) => item.label === 'facturas');

      // `facturas` a secas solo funciona si el esquema por omisión del usuario
      // es `tpublico`, y eso el cliente no lo sabe.
      expect(tabla?.insertText).toBe('tpublico.facturas');
    });

    it('el nombre completo lleva a las columnas de esa tabla', () => {
      const labels = conEsquemas('SELECT * FROM tpublico.usuarios.').map((item) => item.label);

      expect(labels).toEqual(['id', 'nombre', 'correo']);
    });

    it('pide las tablas de un esquema que aún no se ha recorrido', async () => {
      // Un esquema conocido del que todavía no se sabe nada más. Pasa en las
      // bases con muchos esquemas, donde el precalentado no llega a todos.
      let index: SchemaIndex = { schemas: ['tpublico'], relations: [] };
      const pedidos: string[] = [];
      const { monaco, provider } = fakeMonaco();

      registerSqlCompletion(monaco as never, () => ({
        engine: 'sqlserver',
        schema: index,
        loadRelations: (schemaName) => {
          pedidos.push(schemaName);
          // Cargarlo es justo lo que hace el store: repone el índice.
          index = multiSchema;
          return Promise.resolve();
        },
      }));

      const sql = 'SELECT * FROM tpublico.';
      const result = await provider().provideCompletionItems(fakeModel(sql) as never, {
        lineNumber: 1,
        column: sql.length + 1,
      });

      expect(pedidos).toEqual(['tpublico']);
      expect(result.suggestions.map((item: { label: string }) => item.label)).toEqual([
        'usuarios',
        'facturas',
      ]);
    });

    it('pide las columnas que faltan en lugar de no sugerir nada', async () => {
      // Una tabla que el explorador conoce pero no ha abierto: sin columnas.
      const sinAbrir: SchemaIndex = {
        schemas: ['tpublico'],
        relations: [
          {
            schema: 'tpublico',
            name: 'facturas',
            kind: 'table',
            qualified: 'tpublico.facturas',
            columns: [],
          },
        ],
      };

      const pedidas: { schema: string | null; name: string }[] = [];
      const { monaco, provider } = fakeMonaco();

      registerSqlCompletion(monaco as never, () => ({
        engine: 'sqlserver',
        schema: sinAbrir,
        loadColumns: (schema, name) => {
          pedidas.push({ schema, name });
          return Promise.resolve(['id', 'importe']);
        },
      }));

      const sql = 'SELECT * FROM tpublico.facturas f\nWHERE f.';
      const lines = sql.split('\n');
      const result = await provider().provideCompletionItems(fakeModel(sql) as never, {
        lineNumber: lines.length,
        column: lines[lines.length - 1].length + 1,
      });

      expect(result.suggestions.map((item: { label: string }) => item.label)).toEqual(['id', 'importe']);
      // Con su esquema, para no traer las de la tabla homónima de otro.
      expect(pedidas).toEqual([{ schema: 'tpublico', name: 'facturas' }]);
    });

    it('no pide nada cuando las columnas ya están cargadas', () => {
      const pedidas: string[] = [];
      const { monaco, provider } = fakeMonaco();

      registerSqlCompletion(monaco as never, () => ({
        engine: 'sqlserver',
        schema: multiSchema,
        loadColumns: (_schema, name) => {
          pedidas.push(name);
          return Promise.resolve([]);
        },
      }));

      const sql = 'SELECT * FROM tpublico.usuarios u\nWHERE u.';
      const lines = sql.split('\n');
      provider().provideCompletionItems(fakeModel(sql) as never, {
        lineNumber: lines.length,
        column: lines[lines.length - 1].length + 1,
      });

      // Consultar el catálogo en cada pulsación sería mucho peor que el problema.
      expect(pedidas).toEqual([]);
    });

    it('el esquema decide entre dos tablas del mismo nombre', () => {
      const enTpublico = conEsquemas('SELECT * FROM tpublico.usuarios u\nWHERE u.');
      const enDbo = conEsquemas('SELECT * FROM dbo.usuarios u\nWHERE u.');

      expect(enTpublico.map((item) => item.label)).toEqual(['id', 'nombre', 'correo']);
      expect(enDbo.map((item) => item.label)).toEqual(['user_id', 'login']);
    });
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
