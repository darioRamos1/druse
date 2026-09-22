import { DatabaseForeignKey, SchemaGraph } from '../../../shared/models/workspace';
import { findJoinPath } from './join-path';

function fk(column: string, referencedTable: string, referencedColumn = 'id'): DatabaseForeignKey {
  return {
    name: `fk_${column}`,
    columns: [column],
    referencedTable,
    referencedColumns: [referencedColumn],
    onDelete: 'noAction',
    onUpdate: 'noAction',
  } as DatabaseForeignKey;
}

function table(name: string, foreignKeys: DatabaseForeignKey[] = []) {
  return {
    table: { id: `table:public.${name}`, name, kind: 'table', schema: 'public', hasChildren: true },
    columns: [],
    structure: { foreignKeys, indexes: [], constraints: [] },
  };
}

/** clientes ← pedidos ← lineas → productos, y una tabla suelta. */
const graph = {
  tables: [
    table('clientes'),
    table('pedidos', [fk('cliente_id', 'clientes')]),
    table('lineas', [fk('pedido_id', 'pedidos'), fk('producto_id', 'productos')]),
    table('productos'),
    table('suelta'),
  ],
  missing: [],
} as unknown as SchemaGraph;

const ref = (name: string) => ({ schema: 'public', name });

describe('findJoinPath', () => {
  it('encadena los cruces en los dos sentidos de las claves', () => {
    const path = findJoinPath(graph, ref('clientes'), ref('productos'));

    expect(
      path?.map(
        (step) => `${step.from.name}.${step.fromColumn} = ${step.to.name}.${step.toColumn}`,
      ),
    ).toEqual([
      // pedidos apunta a clientes: se recorre al revés.
      'clientes.id = pedidos.cliente_id',
      'pedidos.id = lineas.pedido_id',
      // lineas apunta a productos: se recorre en su sentido.
      'lineas.producto_id = productos.id',
    ]);
  });

  it('una relación directa es un solo salto', () => {
    expect(findJoinPath(graph, ref('pedidos'), ref('clientes'))).toHaveLength(1);
  });

  it('sin camino devuelve null', () => {
    expect(findJoinPath(graph, ref('clientes'), ref('suelta'))).toBeNull();
  });

  it('respeta el límite de saltos', () => {
    expect(findJoinPath(graph, ref('clientes'), ref('productos'), 2)).toBeNull();
  });

  it('no distingue mayúsculas en los nombres', () => {
    expect(findJoinPath(graph, ref('CLIENTES'), ref('Pedidos'))).toHaveLength(1);
  });

  it('ignora las claves de varias columnas, que no sabe escribir en un ON', () => {
    const compuesta = {
      tables: [
        table('a', [{ ...fk('x', 'b'), columns: ['x', 'y'], referencedColumns: ['x', 'y'] }]),
        table('b'),
      ],
      missing: [],
    } as unknown as SchemaGraph;

    expect(findJoinPath(compuesta, ref('a'), ref('b'))).toBeNull();
  });
});
