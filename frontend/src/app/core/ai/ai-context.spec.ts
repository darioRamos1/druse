import { describeSelectedTables, resolveAiDatabase } from './ai-context';
import { TableDetail } from '../../shared/models/workspace';

describe('describeSelectedTables', () => {
  const detail: TableDetail = {
    table: {
      id: 't',
      name: 'facturas',
      schema: 'ventas',
      database: 'bd',
      kind: 'table',
      hasChildren: true,
    },
    columns: [
      {
        name: 'empresa_id',
        dataType: 'integer',
        ordinal: 0,
        isNullable: false,
        isPrimaryKey: true,
      },
      {
        name: 'cliente_id',
        dataType: 'integer',
        ordinal: 1,
        isNullable: false,
        isPrimaryKey: true,
      },
      {
        name: 'importe',
        dataType: 'numeric',
        ordinal: 2,
        isNullable: true,
        isPrimaryKey: false,
        defaultValue: '0',
      },
    ],
    structure: {
      primaryKey: { name: 'pk', columns: ['cliente_id', 'empresa_id'] },
      foreignKeys: [
        {
          name: 'fk_cliente',
          columns: ['empresa_id', 'cliente_id'],
          referencedSchema: 'personas',
          referencedTable: 'clientes',
          referencedColumns: ['empresa', 'id'],
          onDelete: 'cascade',
          onUpdate: 'noAction',
        },
      ],
      indexes: [
        {
          name: 'ix_importe',
          columns: [{ name: 'importe', direction: 'desc' }],
          isUnique: false,
          isConstraintIndex: false,
          isPrimaryKey: false,
          includedColumns: ['cliente_id'],
          filter: 'importe > 0',
        },
      ],
      uniqueConstraints: [],
      checkConstraints: [],
    },
  };

  it('conserva el orden de las claves compuestas, las parejas de FK, índices y valores predeterminados', () => {
    const { schema } = describeSelectedTables([detail]);
    expect(schema).toContain('PRIMARY KEY ("cliente_id", "empresa_id")');
    expect(schema).toContain(
      'FOREIGN KEY ("empresa_id", "cliente_id") REFERENCES "personas"."clientes" ("empresa", "id")',
    );
    expect(schema).toContain('ON DELETE CASCADE ON UPDATE NO ACTION');
    expect(schema).toContain('"importe" numeric DEFAULT 0');
    expect(schema).toContain('("importe" DESC) INCLUDE ("cliente_id") WHERE importe > 0;');
  });

  it('no recorta columnas elegidas explícitamente ni las claves que las usan', () => {
    const columns = Array.from({ length: 85 }, (_, ordinal) => ({
      ...detail.columns[0],
      name: `c${ordinal}`,
      ordinal,
    }));
    const { schema } = describeSelectedTables([
      {
        ...detail,
        columns,
        structure: { ...detail.structure, primaryKey: { name: 'pk', columns: ['c84', 'c1'] } },
      },
    ]);
    expect(schema).toContain('"c84" integer NOT NULL');
    expect(schema).toContain('PRIMARY KEY ("c84", "c1")');
  });

  it('escapa comillas en nombres sin confundir esquema y tabla', () => {
    expect(
      describeSelectedTables([
        { ...detail, table: { ...detail.table, name: 'a"b', schema: 's.x' } },
      ]).schema,
    ).toContain('TABLE "s.x"."a""b"');
  });

  it('no inventa relaciones por los nombres de las columnas', () => {
    const { schema } = describeSelectedTables([
      { ...detail, structure: { ...detail.structure, foreignKeys: [] } },
    ]);
    expect(schema).not.toContain('FOREIGN KEY');
  });
});

describe('resolveAiDatabase', () => {
  it('resuelve el alias único de un motor basado en archivo sin sustituir bases elegidas explícitamente', () => {
    expect(resolveAiDatabase('C:/ventas.db', ['main'], true)).toBe('main');
    expect(resolveAiDatabase('aux', ['main', 'aux'], true)).toBe('aux');
    expect(resolveAiDatabase('C:/ventas.db', ['main', 'aux'], true)).toBe('C:/ventas.db');
    expect(resolveAiDatabase('ventas', ['otra'], false)).toBe('ventas');
  });
});
