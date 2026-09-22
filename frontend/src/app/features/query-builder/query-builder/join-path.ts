import { SchemaGraph } from '../../../shared/models/workspace';

/** Una tabla, por su esquema y su nombre. */
export interface TableRef {
  readonly schema?: string;
  readonly name: string;
}

/**
 * Un salto del camino: de la tabla anterior a la siguiente, por una clave
 * foránea que puede apuntar en cualquiera de los dos sentidos.
 */
export interface JoinStep {
  readonly from: TableRef;
  readonly fromColumn: string;
  readonly to: TableRef;
  readonly toColumn: string;
}

/**
 * Cuántos saltos se buscan como mucho.
 *
 * Más allá, el camino más corto suele pasar por tablas que no tienen que ver
 * —una de auditoría que apunta a todo— y el resultado confunde más que ayuda.
 */
export const MAX_JOIN_HOPS = 4;

const key = (table: TableRef) =>
  `${(table.schema ?? '').toLowerCase()}.${table.name.toLowerCase()}`;

/**
 * El camino más corto de claves foráneas entre dos tablas.
 *
 * Se recorren **en los dos sentidos**: de `lineas` a `productos` se llega por
 * la clave que `lineas` declara, y de `clientes` a `pedidos` por la que declara
 * `pedidos`. Solo cuentan las claves de una columna, que son las que el
 * compositor sabe escribir en un `ON`.
 *
 * Devuelve `[]` si origen y destino son la misma tabla, y `null` si no hay
 * camino dentro del límite de saltos.
 */
export function findJoinPath(
  graph: SchemaGraph,
  from: TableRef,
  to: TableRef,
  maxHops = MAX_JOIN_HOPS,
): JoinStep[] | null {
  const start = key(from);
  const goal = key(to);

  if (start === goal) {
    return [];
  }

  // Aristas por tabla, en los dos sentidos.
  const edges = new Map<string, JoinStep[]>();
  const add = (step: JoinStep) => {
    const list = edges.get(key(step.from)) ?? [];
    list.push(step);
    edges.set(key(step.from), list);
  };

  for (const detail of graph.tables) {
    const own: TableRef = { schema: detail.table.schema, name: detail.table.name };

    for (const foreign of detail.structure.foreignKeys) {
      if (foreign.columns.length !== 1 || foreign.referencedColumns.length !== 1) {
        continue;
      }

      const target: TableRef = {
        schema: foreign.referencedSchema ?? detail.table.schema,
        name: foreign.referencedTable,
      };

      add({
        from: own,
        fromColumn: foreign.columns[0],
        to: target,
        toColumn: foreign.referencedColumns[0],
      });
      add({
        from: target,
        fromColumn: foreign.referencedColumns[0],
        to: own,
        toColumn: foreign.columns[0],
      });
    }
  }

  // Búsqueda en anchura: el primer camino que llega es el más corto.
  const previous = new Map<string, JoinStep | null>([[start, null]]);
  let frontier = [start];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const next: string[] = [];

    for (const table of frontier) {
      for (const step of edges.get(table) ?? []) {
        const reached = key(step.to);

        if (previous.has(reached)) {
          continue;
        }

        previous.set(reached, step);

        if (reached === goal) {
          const path: JoinStep[] = [];

          for (
            let current = previous.get(goal);
            current;
            current = previous.get(key(current.from))
          ) {
            path.unshift(current);
          }

          return path;
        }

        next.push(reached);
      }
    }

    frontier = next;
  }

  return null;
}
