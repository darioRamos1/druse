using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>
/// Lo único que comparten las lecturas en lote de los cuatro proveedores.
///
/// Las consultas no se pueden compartir —cada catálogo es distinto, y forzarlas
/// a parecerse es lo que el contrato de metadatos prohíbe—, pero repartir las
/// filas por la tabla a la que pertenecen y volver a juntarlas después es la
/// misma operación cuatro veces. Escribirla cuatro veces serían cuatro sitios
/// donde equivocarse con el mismo error.
/// </summary>
public static class MetadataBatch
{
    /// <summary>
    /// Las tablas pedidas, sin repetir y con el esquema ya resuelto.
    ///
    /// Quien llama puede pedir dos veces la misma tabla —el diagrama trae sus
    /// vecinas y una vecina puede estar ya en el lienzo—, y un filtro con el par
    /// repetido devolvería cada índice y cada clave dos veces.
    /// </summary>
    public static IReadOnlyList<TableRef> Unique(
        IReadOnlyList<DatabaseObject> tables,
        Func<DatabaseObject, TableRef> key)
    {
        ArgumentNullException.ThrowIfNull(tables);
        ArgumentNullException.ThrowIfNull(key);

        return [.. tables.Select(key).Distinct()];
    }

    /// <summary>
    /// Reparte por tabla las filas de una consulta que abarcó varias.
    ///
    /// Una tabla que no aparece en las filas **no queda con una lista vacía**: no
    /// queda. Distinguir «no tiene índices» de «no se preguntó por ella» es lo
    /// que permite después saber cuál desapareció del catálogo.
    /// </summary>
    public static IReadOnlyDictionary<TableRef, IReadOnlyList<T>> GroupByTable<T>(
        IEnumerable<(TableRef Owner, T Item)> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        var grouped = new Dictionary<TableRef, List<T>>();

        foreach (var (owner, item) in rows)
        {
            if (!grouped.TryGetValue(owner, out var items))
            {
                items = [];
                grouped[owner] = items;
            }

            items.Add(item);
        }

        return grouped.ToDictionary(entry => entry.Key, entry => (IReadOnlyList<T>)entry.Value);
    }

    /// <summary>
    /// Junta columnas y estructura devolviendo las tablas en el orden en que se
    /// pidieron.
    ///
    /// Una tabla **sin columnas no se devuelve**. No es una tabla vacía: no hay
    /// tablas sin columnas. Es una tabla que ya no está en el catálogo porque
    /// alguien la borró entre que se pidió el diagrama y se leyó, y eso no puede
    /// tumbar la lectura de las otras cincuenta y nueve. Quien llama compara lo
    /// pedido con lo devuelto y avisa de la diferencia.
    /// </summary>
    public static IReadOnlyList<TableDetail> Compose(
        IReadOnlyList<DatabaseObject> tables,
        Func<DatabaseObject, TableRef> key,
        IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseColumn>> columns,
        IReadOnlyDictionary<TableRef, TableStructure> structures)
    {
        ArgumentNullException.ThrowIfNull(tables);
        ArgumentNullException.ThrowIfNull(key);
        ArgumentNullException.ThrowIfNull(columns);
        ArgumentNullException.ThrowIfNull(structures);

        var details = new List<TableDetail>(tables.Count);

        foreach (var table in tables)
        {
            var reference = key(table);

            if (!columns.TryGetValue(reference, out var own) || own.Count == 0)
            {
                continue;
            }

            details.Add(new TableDetail
            {
                Table = table,
                Columns = own,
                Structure = structures.TryGetValue(reference, out var structure)
                    ? structure
                    : new TableStructure(),
            });
        }

        return details;
    }
}
