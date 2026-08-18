using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>Un valor de un archivo que no cabe en su columna.</summary>
/// <param name="Row">Fila del archivo, empezando en 1 y sin contar la cabecera.</param>
public sealed record RowValueProblem(long Row, string Column, string Message);

/// <summary>Filas de texto ya convertidas, y lo que no se pudo convertir.</summary>
public sealed record PreparedRows(
    PreparedInsertBatch Batch,
    IReadOnlyList<RowValueProblem> Problems);

/// <summary>
/// Convierte filas de texto en el lote que se inserta.
///
/// Es el trozo que comparten importar un archivo y restaurar un respaldo con los
/// datos en CSV: los dos tienen delante lo mismo —celdas de texto y una tabla que
/// las espera con sus tipos— y los dos tienen que emparejarlas por nombre y
/// convertirlas antes de escribir. Dos copias de esto serían dos criterios
/// distintos sobre qué es un nulo, y esa diferencia solo se vería en los datos.
///
/// **No decide qué hacer con lo que no cabe.** Devuelve las celdas convertidas y
/// la lista de problemas, y quien llama elige: la importación los enseña todos
/// para que se corrija el archivo; la restauración para en el primero, porque
/// seguir metiendo filas deja una tabla que nadie sabe describir.
/// </summary>
public static class RowBatchPlanner
{
    /// <summary>
    /// A qué columna de la tabla va cada columna del archivo.
    ///
    /// Se emparejan por nombre sin distinguir mayúsculas. Lo que no case se queda
    /// en `null` y no se coloca por posición: adivinar ahí es exactamente como se
    /// importan teléfonos en la columna del código postal.
    /// </summary>
    public static IReadOnlyList<DatabaseColumn?> Match(
        IReadOnlyList<string> fileColumns,
        IReadOnlyList<DatabaseColumn> tableColumns)
    {
        ArgumentNullException.ThrowIfNull(fileColumns);
        ArgumentNullException.ThrowIfNull(tableColumns);

        var byName = new Dictionary<string, DatabaseColumn>(StringComparer.OrdinalIgnoreCase);

        foreach (var column in tableColumns)
        {
            byName[column.Name] = column;
        }

        return [.. fileColumns.Select(name => byName.GetValueOrDefault(name))];
    }

    /// <summary>
    /// Convierte las filas al tipo de cada columna.
    /// </summary>
    /// <param name="targets">
    /// Una entrada por columna del archivo, en su orden; `null` en las que no van
    /// a ninguna parte.
    /// </param>
    /// <param name="firstRow">
    /// Número de la primera fila dentro del archivo, para que los problemas
    /// digan dónde está el valor y no en qué posición del lote iba.
    /// </param>
    public static PreparedRows Prepare(
        string? schema,
        string table,
        IReadOnlyList<DatabaseColumn?> targets,
        IReadOnlyList<IReadOnlyList<string?>> rows,
        long firstRow = 1)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(table);
        ArgumentNullException.ThrowIfNull(targets);
        ArgumentNullException.ThrowIfNull(rows);

        var used = targets.OfType<DatabaseColumn>().Select(column => column.Name).ToList();
        var problems = new List<RowValueProblem>();
        var prepared = new List<IReadOnlyList<PreparedCell>>(rows.Count);

        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            var cells = new List<PreparedCell>(used.Count);

            for (var column = 0; column < targets.Count; column++)
            {
                if (targets[column] is not { } target)
                {
                    continue;
                }

                // Una fila más corta que la cabecera no es un error del archivo
                // entero: lo que falta es nulo, y eso lo dirá la columna si no lo
                // admite.
                var text = column < row.Count ? row[column] : null;

                if (!ColumnValueParser.TryParse(target.DataType, text, out var value, out var error))
                {
                    problems.Add(new RowValueProblem(firstRow + index, target.Name, error!));
                    continue;
                }

                cells.Add(new PreparedCell(
                    target.Name,
                    value,
                    ColumnValueParser.ToLiteral(target.DataType, text),
                    target.DataType));
            }

            prepared.Add(cells);
        }

        return new PreparedRows(
            new PreparedInsertBatch
            {
                Schema = schema,
                Table = table,
                Columns = used,
                Rows = prepared,
            },
            problems);
    }
}
