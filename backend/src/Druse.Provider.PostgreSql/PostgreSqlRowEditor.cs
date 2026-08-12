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
}
