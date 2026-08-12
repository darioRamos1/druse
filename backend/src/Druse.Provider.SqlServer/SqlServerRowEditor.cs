using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.SqlServer;

/// <summary>Escribe cambios de filas en SQL Server. Solo aporta su dialecto.</summary>
public sealed class SqlServerRowEditor : RowEditorBase
{
    public override DatabaseEngine Engine => DatabaseEngine.SqlServer;

    /// <summary>
    /// Corchetes, que es como SQL Server admite cualquier nombre.
    ///
    /// El corchete de cierre se duplica: sin eso, una tabla llamada `a]b`
    /// permitiría escapar del identificador.
    /// </summary>
    protected override string Quote(string identifier) =>
        $"[{identifier.Replace("]", "]]", StringComparison.Ordinal)}]";

    protected override string Parameter(int index) => $"@p{index}";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is SqlServerSession sqlServer
            ? sqlServer.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor SQL Server.",
                nameof(session));
}
