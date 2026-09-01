import { SchemaGraph } from '../../shared/models/workspace';
import { toDbml, toMermaid } from './diagram-export';

function column(name: string, type = 'int8', options: { pk?: boolean; nullable?: boolean } = {}) {
  return {
    name,
    dataType: type,
    inputKind: 'integer' as const,
    isNullable: options.nullable ?? false,
    isPrimaryKey: options.pk ?? false,
    isGenerated: false,
    ordinal: 1,
  };
}

const grafo: SchemaGraph = {
  tables: [
    {
      table: {
        id: 'ventas.cliente',
        name: 'cliente',
        kind: 'table',
        schema: 'ventas',
        hasChildren: true,
      },
      columns: [column('id', 'int8', { pk: true }), column('nombre', 'varchar(200)')],
      structure: {
        primaryKey: { name: 'pk_cliente', columns: ['id'] },
        indexes: [],
        foreignKeys: [],
        uniqueConstraints: [],
        checkConstraints: [],
      },
    },
    {
      table: {
        id: 'ventas.factura',
        name: 'factura',
        kind: 'table',
        schema: 'ventas',
        hasChildren: true,
      },
      columns: [
        column('id', 'int8', { pk: true }),
        column('cliente_id', 'int8', { nullable: true }),
      ],
      structure: {
        primaryKey: { name: 'pk_factura', columns: ['id'] },
        indexes: [],
        foreignKeys: [
          {
            name: 'fk_factura_cliente',
            columns: ['cliente_id'],
            referencedSchema: 'ventas',
            referencedTable: 'cliente',
            referencedColumns: ['id'],
            onDelete: 'noAction',
            onUpdate: 'noAction',
          },
        ],
        uniqueConstraints: [],
        checkConstraints: [],
      },
    },
  ],
  missing: [],
  suggestions: [
    {
      fromSchema: 'ventas',
      fromTable: 'pedido',
      column: 'cliente_id',
      toSchema: 'ventas',
      toTable: 'cliente',
      referencedColumn: 'id',
      confidence: 'high',
      reason: '«cliente_id» nombra a «cliente» y el tipo encaja.',
    },
  ],
};

describe('exportar a Mermaid', () => {
  it('escribe las tablas con sus claves marcadas', () => {
    const salida = toMermaid(grafo, { includeSuggested: false });

    expect(salida).toContain('erDiagram');
    expect(salida).toContain('int8 id PK');
    expect(salida).toContain('int8 cliente_id FK');
  });

  it('la cardinalidad sale del catálogo, y la opcionalidad de la columna', () => {
    // `cliente_id` admite nulos: la relación es opcional.
    expect(toMermaid(grafo, { includeSuggested: false })).toContain('cliente ||--o{ factura');
  });

  /**
   * La regla que no se puede romper: un archivo exportado no puede presentar una
   * suposición como una clave foránea. Quien lo lea no tiene forma de saberlo.
   */
  it('las supuestas van comentadas, o no van', () => {
    const con = toMermaid(grafo, { includeSuggested: true });
    const sin = toMermaid(grafo, { includeSuggested: false });

    expect(con).toContain('%% supuesta por Druse');
    expect(sin).not.toContain('pedido');

    // Y ninguna línea sin comentar menciona la tabla supuesta.
    const activas = con.split('\n').filter((line) => !line.trim().startsWith('%%'));

    expect(activas.some((line) => line.includes('pedido'))).toBe(false);
  });

  it('sanea los nombres que Mermaid no admite', () => {
    const raro: SchemaGraph = {
      tables: [
        {
          table: { id: '1', name: 'orden de compra', kind: 'table', hasChildren: true },
          columns: [column('nº', 'varchar(10)')],
          structure: {
            indexes: [],
            foreignKeys: [],
            uniqueConstraints: [],
            checkConstraints: [],
          },
        },
      ],
      missing: [],
    };

    const salida = toMermaid(raro, { includeSuggested: false });

    expect(salida).toContain('orden_de_compra');
    expect(salida).toContain('varchar10');
  });
});

describe('exportar a DBML', () => {
  it('escribe las tablas y sus referencias', () => {
    const salida = toDbml(grafo, { includeSuggested: false });

    expect(salida).toContain('Table cliente {');
    expect(salida).toContain('id int8 [pk, not null]');
    expect(salida).toContain('Ref: factura.cliente_id > cliente.id');
  });

  it('las supuestas van comentadas, o no van', () => {
    const con = toDbml(grafo, { includeSuggested: true });
    const sin = toDbml(grafo, { includeSuggested: false });

    expect(con).toContain('// supuesta por Druse');
    expect(sin).not.toContain('pedido');

    const activas = con.split('\n').filter((line) => !line.trim().startsWith('//'));

    expect(activas.some((line) => line.includes('pedido'))).toBe(false);
  });

  it('la columna que admite nulos no se marca como obligatoria', () => {
    const salida = toDbml(grafo, { includeSuggested: false });

    expect(salida).toContain('cliente_id int8');
    expect(salida).not.toContain('cliente_id int8 [not null]');
  });
});
