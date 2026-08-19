using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.PostgreSql;

/// <summary>Escribe cambios de filas en PostgreSQL. Solo aporta su dialecto.</summary>
public sealed class PostgreSqlRowEditor : RowEditorBase
{
    public override DatabaseEngine Engine => DatabaseEngine.PostgreSql;

    /// <summary>
    /// Comillas dobles, y duplicadas por dentro.
    ///
    /// En PostgreSQL citar no es opcional cuando el nombre lleva mayúsculas: sin
    /// comillas, el servidor lo pasa a minúsculas y no encuentra la tabla.
    /// </summary>
    protected override string Quote(string identifier) =>
        $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    /// <summary>Npgsql admite parámetros con nombre; se usan por claridad.</summary>
    protected override string Parameter(int index) => $"@p{index}";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is PostgreSqlSession postgres
            ? postgres.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor PostgreSQL.",
                nameof(session));

    /// <summary>
    /// `ON CONFLICT`, que es donde PostgreSQL lo dice mejor que nadie.
    ///
    /// Las columnas del conflicto se nombran, así que **la fila que se actualiza
    /// es la que choca con esas columnas y no con cualquier otra restricción de la
    /// tabla**. Es la diferencia con MySQL, y la razón de que aquí no haga falta
    /// avisar de nada.
    ///
    /// `EXCLUDED` es la fila que se intentaba insertar: sin ella habría que
    /// repetir los valores, y con marcadores posicionales eso significa mandarlos
    /// dos veces.
    /// </summary>
    protected override string ConflictClause(
        PreparedInsertBatch batch,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns)
    {
        ArgumentNullException.ThrowIfNull(keyColumns);

        var conflict = string.Join(", ", keyColumns.Select(Quote));

        if (onExisting == ExistingRowAction.Skip)
        {
            return $"ON CONFLICT ({conflict}) DO NOTHING";
        }

        var updatable = Updatable(batch, keyColumns);

        // Sin columnas que cambiar, actualizar es no hacer nada. Se dice así en
        // lugar de escribir un `SET` vacío, que no compila.
        if (updatable.Count == 0)
        {
            return $"ON CONFLICT ({conflict}) DO NOTHING";
        }

        var set = string.Join(
            ", ",
            updatable.Select(column => $"{Quote(column)} = EXCLUDED.{Quote(column)}"));

        return $"ON CONFLICT ({conflict}) DO UPDATE SET {set}";
    }
}
