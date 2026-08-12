using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.MySql;

/// <summary>Escribe cambios de filas en MySQL. Solo aporta su dialecto.</summary>
public sealed class MySqlRowEditor : RowEditorBase
{
    public override DatabaseEngine Engine => DatabaseEngine.MySql;

    /// <summary>
    /// Comillas invertidas, que es lo que permite en MySQL que una columna se
    /// llame `order` o `group`. La de cierre se duplica por dentro.
    /// </summary>
    protected override string Quote(string identifier) =>
        $"`{identifier.Replace("`", "``", StringComparison.Ordinal)}`";

    protected override string Parameter(int index) => $"@p{index}";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is MySqlSession mysql
            ? mysql.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor MySQL.",
                nameof(session));
}
