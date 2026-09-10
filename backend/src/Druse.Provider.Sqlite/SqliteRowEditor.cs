using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.Sqlite;

/// <summary>Escribe cambios de filas en SQLite. Solo aporta su dialecto.</summary>
public sealed class SqliteRowEditor : RowEditorBase
{
    public override DatabaseEngine Engine => DatabaseEngine.Sqlite;

    /// <summary>
    /// Comillas dobles, duplicándolas por dentro.
    ///
    /// A diferencia de Oracle, aquí citar **no cambia la caja**: SQLite compara
    /// los nombres sin distinguir mayúsculas y guarda el que se escribió. Así que
    /// se cita siempre, que es lo que permite que una columna se llame `order` o
    /// `group`.
    /// </summary>
    protected override string Quote(string identifier) =>
        $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    protected override string Parameter(int index) => $"$p{index}";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is SqliteSession sqlite
            ? sqlite.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor SQLite.",
                nameof(session));

    /// <summary>
    /// `ON CONFLICT`, que aquí sí deja decir **con qué clave** se choca.
    ///
    /// Es la forma de PostgreSQL, y SQLite la adoptó tal cual en la 3.24: se
    /// nombran las columnas y el motor solo reacciona ante esa restricción, no
    /// ante cualquier otra de la tabla. Es lo contrario de MySQL, donde una fila
    /// puede acabar actualizando a otra que no comparte la clave nombrada.
    /// </summary>
    protected override string ConflictClause(
        PreparedInsertBatch batch,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns)
    {
        ArgumentNullException.ThrowIfNull(batch);
        ArgumentNullException.ThrowIfNull(keyColumns);

        // Sin columnas que nombrar no se puede apuntar a una restricción concreta,
        // y `ON CONFLICT` a secas solo admite `DO NOTHING`. Se rechaza aquí en vez
        // de escribir algo que hace otra cosa.
        if (keyColumns.Count == 0)
        {
            throw new NotSupportedException(
                "Para decidir qué hacer con una fila que ya está hace falta saber qué " +
                "columnas la identifican.");
        }

        var target = string.Join(", ", keyColumns.Select(Quote));

        if (onExisting == ExistingRowAction.Skip)
        {
            return $"ON CONFLICT ({target}) DO NOTHING";
        }

        var updatable = Updatable(batch, keyColumns);

        if (updatable.Count == 0)
        {
            // Sin columnas que cambiar, actualizar es no hacer nada, y aquí sí hay
            // forma de decirlo sin rodeos.
            return $"ON CONFLICT ({target}) DO NOTHING";
        }

        var set = string.Join(
            ", ",
            updatable.Select(column => $"{Quote(column)} = excluded.{Quote(column)}"));

        return $"ON CONFLICT ({target}) DO UPDATE SET {set}";
    }
}
