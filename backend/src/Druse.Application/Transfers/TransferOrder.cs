using Druse.Domain;

namespace Druse.Application.Transfers;

/// <summary>Una tabla del conjunto y las claves foráneas que declara.</summary>
/// <param name="Table">La tabla, con su esquema.</param>
/// <param name="ForeignKeys">Sus foráneas tal y como están hoy en el catálogo.</param>
public readonly record struct TransferNode(
    DatabaseObject Table,
    IReadOnlyList<DatabaseForeignKey> ForeignKeys);

/// <summary>
/// En qué orden se copian las tablas, y cuáles no se pudieron ordenar.
/// </summary>
/// <param name="Order">
/// Índices de las tablas recibidas, en el orden en que hay que copiarlas.
/// </param>
/// <param name="Cycles">
/// Tablas que quedaron atrapadas en un ciclo, por nombre calificado. Van al final
/// del orden, tal y como se pidieron.
/// </param>
public sealed record TransferOrdering(
    IReadOnlyList<int> Order,
    IReadOnlyList<string> Cycles);

/// <summary>
/// Ordena las tablas de una pasada por sus claves foráneas: las padres antes que
/// las hijas.
///
/// El grafo se mira **en el destino**, que es el único lado que puede rechazar
/// una escritura: si allí `pedidos` apunta a `clientes`, copiar los pedidos
/// primero falla por más ordenadas que estén en el origen. Cuando el destino no
/// declara ninguna foránea —una tabla recién creada por el asistente, por
/// ejemplo— no hay nada que ordenar y el orden pedido se respeta.
///
/// **Los ciclos no se resuelven, se avisan.** Dos tablas que se apuntan la una a
/// la otra no admiten ningún orden que las satisfaga a la vez, y elegir uno
/// callando sería fingir que sí. Es la misma salida que tomó el respaldo al dejar
/// las foráneas para el final del guion.
/// </summary>
public static class TransferOrder
{
    /// <summary>
    /// Devuelve el orden de copia y las tablas que quedaron sin ordenar.
    ///
    /// Es determinista: entre dos tablas que nadie obliga a separar, gana la que
    /// se pidió antes. Un orden que cambia de una ejecución a otra convertiría
    /// cualquier fallo a mitad en algo que no se puede reproducir.
    /// </summary>
    public static TransferOrdering Sort(IReadOnlyList<TransferNode> tables)
    {
        ArgumentNullException.ThrowIfNull(tables);

        if (tables.Count < 2)
        {
            return new TransferOrdering([.. Enumerable.Range(0, tables.Count)], []);
        }

        // Las tablas se buscan por esquema y nombre porque una foránea no dice de
        // qué base viene: dentro de una conexión, `ventas.pedidos` y
        // `compras.pedidos` son dos tablas distintas con el mismo nombre.
        var byName = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        for (var index = 0; index < tables.Count; index++)
        {
            byName.TryAdd(Key(tables[index].Table.Schema, tables[index].Table.Name), index);
        }

        var children = new List<int>[tables.Count];
        var pending = new int[tables.Count];

        for (var index = 0; index < tables.Count; index++)
        {
            children[index] = [];
        }

        for (var child = 0; child < tables.Count; child++)
        {
            foreach (var parent in Parents(tables, byName, child))
            {
                children[parent].Add(child);
                pending[child]++;
            }
        }

        var order = new List<int>(tables.Count);
        var placed = new bool[tables.Count];

        // Se recorre buscando cada vez la primera tabla sin nada pendiente, en vez
        // de con una cola: la lista es de decenas de tablas, y así el orden
        // original decide los empates sin tener que ordenar nada después.
        while (true)
        {
            var next = -1;

            for (var index = 0; index < tables.Count; index++)
            {
                if (!placed[index] && pending[index] == 0)
                {
                    next = index;
                    break;
                }
            }

            if (next < 0)
            {
                break;
            }

            placed[next] = true;
            order.Add(next);

            foreach (var child in children[next])
            {
                pending[child]--;
            }
        }

        // Lo que queda está en un ciclo o cuelga de uno. Va al final en el orden
        // en que se pidió: sin orden que sirva, el que escribió la lista es mejor
        // criterio que cualquiera que se invente aquí.
        var cycles = new List<string>();

        for (var index = 0; index < tables.Count; index++)
        {
            if (!placed[index])
            {
                order.Add(index);
                cycles.Add(Qualified(tables[index].Table));
            }
        }

        return new TransferOrdering(order, cycles);
    }

    /// <summary>
    /// De qué tablas **del conjunto** depende esta.
    ///
    /// Lo que apunta fuera del conjunto se ignora: esas tablas no se están
    /// copiando, así que o ya están en el destino o el motor se quejará por su
    /// cuenta, y ninguna de las dos cosas se arregla ordenando.
    ///
    /// Una tabla que se apunta a sí misma —la jerarquía de toda la vida, con su
    /// columna de padre— tampoco cuenta: no hay nada que ordenar entre una tabla y
    /// ella misma, y tratarlo como ciclo llenaría de avisos el caso más normal.
    /// </summary>
    private static IEnumerable<int> Parents(
        IReadOnlyList<TransferNode> tables,
        Dictionary<string, int> byName,
        int child)
    {
        var seen = new HashSet<int>();

        foreach (var foreignKey in tables[child].ForeignKeys)
        {
            // Sin esquema declarado se busca por el de la propia tabla, que es
            // donde el motor lo resolvería.
            var schema = foreignKey.ReferencedSchema ?? tables[child].Table.Schema;

            if (byName.TryGetValue(Key(schema, foreignKey.ReferencedTable), out var parent) &&
                parent != child &&
                seen.Add(parent))
            {
                yield return parent;
            }
        }
    }

    private static string Key(string? schema, string name) =>
        string.IsNullOrWhiteSpace(schema) ? name : $"{schema}.{name}";

    private static string Qualified(DatabaseObject table) =>
        Key(table.Schema, table.Name);
}
