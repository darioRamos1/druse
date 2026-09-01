import { DatabaseObject, TableDetail } from '../../shared/models/workspace';
import { BOX, layoutDiagram, neighbours, tableKey, visibleColumns } from './diagram-layout';

function table(name: string, schema = 'ventas'): DatabaseObject {
  return {
    id: `${schema}.${name}`,
    name,
    kind: 'table',
    database: 'druse_test',
    schema,
    hasChildren: true,
  };
}

function column(
  name: string,
  options: { pk?: boolean; nullable?: boolean; type?: string } = {},
) {
  return {
    name,
    dataType: options.type ?? 'int8',
    inputKind: 'integer' as const,
    isNullable: options.nullable ?? false,
    isPrimaryKey: options.pk ?? false,
    isGenerated: false,
    ordinal: 1,
  };
}

function detail(
  name: string,
  columns: ReturnType<typeof column>[],
  foreignKeys: {
    name: string;
    columns: string[];
    referencedTable: string;
    referencedColumns?: string[];
    referencedSchema?: string;
  }[] = [],
  primaryKey?: string[],
  schema = 'ventas',
): TableDetail {
  return {
    table: table(name, schema),
    columns,
    structure: {
      primaryKey: primaryKey ? { name: `pk_${name}`, columns: primaryKey } : undefined,
      indexes: [],
      foreignKeys: foreignKeys.map((key) => ({
        name: key.name,
        columns: key.columns,
        referencedSchema: key.referencedSchema ?? schema,
        referencedTable: key.referencedTable,
        referencedColumns: key.referencedColumns ?? ['id'],
        onDelete: 'noAction' as const,
        onUpdate: 'noAction' as const,
      })),
      uniqueConstraints: [],
      checkConstraints: [],
    },
  };
}

/** cliente ← factura ← factura_detalle → producto, más una tabla suelta. */
function esquema(): TableDetail[] {
  return [
    detail('cliente', [column('id', { pk: true }), column('nombre', { type: 'varchar' })], [], ['id']),
    detail(
      'factura',
      [column('id', { pk: true }), column('cliente_id'), column('total', { type: 'numeric' })],
      [{ name: 'fk_factura_cliente', columns: ['cliente_id'], referencedTable: 'cliente' }],
      ['id'],
    ),
    detail('producto', [column('id', { pk: true }), column('sku', { type: 'varchar' })], [], ['id']),
    detail(
      'factura_detalle',
      [column('factura_id', { pk: true }), column('producto_id', { pk: true }), column('cantidad')],
      [
        { name: 'fk_detalle_factura', columns: ['factura_id'], referencedTable: 'factura' },
        { name: 'fk_detalle_producto', columns: ['producto_id'], referencedTable: 'producto' },
      ],
      ['factura_id', 'producto_id'],
    ),
    detail('bitacora', [column('id', { pk: true }), column('mensaje', { type: 'text' })], [], ['id']),
  ];
}

describe('colocación del diagrama', () => {
  it('pone en la primera capa lo que no apunta a nadie', () => {
    const { boxes } = layoutDiagram(esquema(), 'full');

    const x = (name: string) => boxes.find((box) => box.table.name === name)?.x ?? -1;

    expect(x('cliente')).toBe(BOX.marginX);
    expect(x('producto')).toBe(BOX.marginX);
    expect(x('bitacora')).toBe(BOX.marginX);
    expect(x('factura')).toBeGreaterThan(x('cliente'));
    expect(x('factura_detalle')).toBeGreaterThan(x('factura'));
  });

  /**
   * Un diagrama que se recoloca solo en cada apertura no se puede comparar
   * consigo mismo. Esta es la prueba que sostiene esa promesa.
   */
  it('es determinista: el mismo esquema sale siempre igual', () => {
    const primera = layoutDiagram(esquema(), 'full');
    const segunda = layoutDiagram(esquema().reverse(), 'full');

    expect(segunda.boxes.map((box) => [box.key, box.x, box.y])).toEqual(
      primera.boxes.map((box) => [box.key, box.x, box.y]),
    );
  });

  it('el alto de la caja sale de las columnas que se ven', () => {
    const completo = layoutDiagram(esquema(), 'full');
    const claves = layoutDiagram(esquema(), 'keys');
    const plegado = layoutDiagram(esquema(), 'collapsed');

    const alto = (layout: ReturnType<typeof layoutDiagram>, name: string) =>
      layout.boxes.find((box) => box.table.name === name)?.height ?? 0;

    expect(alto(completo, 'factura')).toBe(BOX.header + 3 * BOX.row);
    expect(alto(claves, 'factura')).toBe(BOX.header + 2 * BOX.row);
    expect(alto(plegado, 'factura')).toBe(BOX.header);
  });

  it('reconoce la tabla puente', () => {
    const { boxes } = layoutDiagram(esquema(), 'full');

    expect(boxes.find((box) => box.table.name === 'factura_detalle')?.isBridge).toBe(true);
    expect(boxes.find((box) => box.table.name === 'factura')?.isBridge).toBe(false);
  });

  /**
   * Una base sin claves foráneas declaradas —MyISAM, y tantas heredadas— tiene
   * todas sus tablas en la capa cero. En una sola columna serían una tira
   * vertical de miles de píxeles, que es justo lo que se vio en la primera
   * captura del barrido.
   */
  it('reparte en varias columnas la capa que no cabe de alto', () => {
    const sueltas = Array.from({ length: 8 }, (_, index) =>
      detail(`tabla_${index}`, [column('id', { pk: true }), column('nombre')], [], ['id']),
    );

    const { boxes } = layoutDiagram(sueltas, 'full', new Map(), 400);
    const columnas = new Set(boxes.map((box) => box.x));

    expect(columnas.size).toBeGreaterThan(1);

    // Y ninguna caja se sale por debajo del alto disponible.
    for (const box of boxes) {
      expect(box.y + box.height).toBeLessThanOrEqual(400);
    }
  });

  it('el reparto en columnas sigue siendo determinista', () => {
    const sueltas = () =>
      Array.from({ length: 8 }, (_, index) =>
        detail(`tabla_${index}`, [column('id', { pk: true })], [], ['id']),
      );

    const primera = layoutDiagram(sueltas(), 'full', new Map(), 400);
    const segunda = layoutDiagram(sueltas().reverse(), 'full', new Map(), 400);

    expect(segunda.boxes.map((box) => [box.key, box.x, box.y])).toEqual(
      primera.boxes.map((box) => [box.key, box.x, box.y]),
    );
  });

  it('respeta la posición que el usuario movió a mano', () => {
    const posiciones = new Map([['ventas.factura', { x: 900, y: 120 }]]);
    const { boxes } = layoutDiagram(esquema(), 'full', posiciones);

    const factura = boxes.find((box) => box.table.name === 'factura');

    expect([factura?.x, factura?.y]).toEqual([900, 120]);
  });

  it('no dibuja la relación cuyo destino no está en el lienzo', () => {
    const suelta = [
      detail(
        'factura',
        [column('id', { pk: true }), column('cliente_id')],
        [{ name: 'fk_factura_cliente', columns: ['cliente_id'], referencedTable: 'cliente' }],
        ['id'],
      ),
    ];

    expect(layoutDiagram(suelta, 'full').links).toHaveLength(0);
  });

  /**
   * Dos tablas que se apuntan entre sí no tienen capa posible. Sin tope, el
   * cálculo no termina; con él, salen colocadas aunque el orden sea arbitrario.
   */
  it('un ciclo entre dos tablas no cuelga la colocación', () => {
    const ciclo = [
      detail(
        'a',
        [column('id', { pk: true }), column('b_id')],
        [{ name: 'fk_a_b', columns: ['b_id'], referencedTable: 'b' }],
        ['id'],
      ),
      detail(
        'b',
        [column('id', { pk: true }), column('a_id')],
        [{ name: 'fk_b_a', columns: ['a_id'], referencedTable: 'a' }],
        ['id'],
      ),
    ];

    const { boxes, links } = layoutDiagram(ciclo, 'full');

    expect(boxes).toHaveLength(2);
    expect(links).toHaveLength(2);
  });

  it('la auto-referencia sale y vuelve por el mismo costado', () => {
    const empleado = [
      detail(
        'empleado',
        [column('id', { pk: true }), column('jefe_id', { nullable: true })],
        [{ name: 'fk_jefe', columns: ['jefe_id'], referencedTable: 'empleado' }],
        ['id'],
      ),
    ];

    const link = layoutDiagram(empleado, 'full').links[0];

    expect(link.from).toBe(link.to);
    expect(link.optional).toBe(true);
    expect(link.path).toMatch(/^M \d/);
  });

  it('marca opcional la clave cuya columna admite nulos', () => {
    const { links } = layoutDiagram(
      [
        detail('cliente', [column('id', { pk: true })], [], ['id']),
        detail(
          'factura',
          [column('id', { pk: true }), column('cliente_id', { nullable: true })],
          [{ name: 'fk', columns: ['cliente_id'], referencedTable: 'cliente' }],
          ['id'],
        ),
      ],
      'full',
    );

    expect(links[0].optional).toBe(true);
  });

  /**
   * El trazo ancla en la fila de la columna cuando se ve, y en el centro de la
   * caja cuando el nivel de detalle la esconde.
   */
  it('el trazo ancla en la fila de la clave, y en el centro si está plegada', () => {
    const completo = layoutDiagram(esquema(), 'full').links.find((link) => link.id === 'fk_factura_cliente');
    const plegado = layoutDiagram(esquema(), 'collapsed').links.find((link) => link.id === 'fk_factura_cliente');

    expect(completo?.path).not.toEqual(plegado?.path);
    expect(completo?.feet).toContain('M ');
    expect(plegado?.feet).toContain('M ');
  });
});

describe('columnas visibles', () => {
  it('en «claves» deja solo lo que sostiene una relación', () => {
    const factura = esquema().find((entry) => entry.table.name === 'factura');
    const columns = visibleColumns(factura!, 'keys');

    expect(columns.map((column) => column.name)).toEqual(['id', 'cliente_id']);
    expect(columns[1].isForeignKey).toBe(true);
  });

  it('en «plegado» no queda ninguna', () => {
    const factura = esquema().find((entry) => entry.table.name === 'factura');

    expect(visibleColumns(factura!, 'collapsed')).toHaveLength(0);
  });
});

describe('vecinas', () => {
  it('sin selección no se apaga nada', () => {
    const { links } = layoutDiagram(esquema(), 'full');

    expect(neighbours(links, null)).toBeNull();
  });

  it('con una tabla marcada quedan ella y sus vecinas directas', () => {
    const { links } = layoutDiagram(esquema(), 'full');
    const near = neighbours(links, 'ventas.factura');

    expect([...(near ?? [])].sort()).toEqual([
      'ventas.cliente',
      'ventas.factura',
      'ventas.factura_detalle',
    ]);
  });
});

describe('clave de una tabla', () => {
  it('dos tablas del mismo nombre en esquemas distintos son dos tablas', () => {
    expect(tableKey({ schema: 'ventas', name: 'factura' })).not.toBe(
      tableKey({ schema: 'compras', name: 'factura' }),
    );
  });
});
