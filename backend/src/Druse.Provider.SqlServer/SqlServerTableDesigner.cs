using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.SqlServer;

/// <summary>DDL de SQL Server. Solo aporta su dialecto.</summary>
public sealed class SqlServerTableDesigner : TableDesignerBase
{
    public override DatabaseEngine Engine => DatabaseEngine.SqlServer;

    public override IReadOnlyList<string> CommonDataTypes =>
    [
        "INT", "BIGINT", "SMALLINT", "TINYINT", "BIT",
        "DECIMAL(18,2)", "MONEY", "FLOAT",
        "NVARCHAR(50)", "NVARCHAR(255)", "NVARCHAR(MAX)", "VARCHAR(255)", "CHAR(10)",
        "DATE", "DATETIME2", "TIME", "DATETIMEOFFSET",
        "UNIQUEIDENTIFIER", "VARBINARY(MAX)",
    ];

    /// <summary>
    /// SQL Server admite columnas incluidas y filtros, pero no elegir estructura:
    /// un índice es un árbol B salvo que sea de otro tipo —columnar, espacial—,
    /// y esos no se crean con esta forma de instrucción.
    /// </summary>
    public override IndexCapabilities IndexCapabilities => new()
    {
        SupportsIncludedColumns = true,
        SupportsFilter = true,
        SupportsSortDirection = true,
        Methods = [],
    };

    /// <summary>
    /// Copiar los datos significa copiar también las claves que ya tienen, y SQL
    /// Server no deja escribir en una columna de identidad sin abrirle paso.
    ///
    /// Solo se emite donde hay identidad: `SET IDENTITY_INSERT` sobre una tabla
    /// que no la tiene es un error, no una instrucción que no hace nada.
    /// </summary>
    public override IReadOnlyList<string> BeginDataLoad(ScriptedTable table) =>
        HasIdentity(table) ? [$"SET IDENTITY_INSERT {Name(table)} ON;"] : [];

    public override IReadOnlyList<string> EndDataLoad(ScriptedTable table) =>
        HasIdentity(table) ? [$"SET IDENTITY_INSERT {Name(table)} OFF;"] : [];

    private static bool HasIdentity(ScriptedTable table)
    {
        ArgumentNullException.ThrowIfNull(table);

        return table.Columns.Any(column => column.IsGenerated);
    }

    private string Name(ScriptedTable table) =>
        Qualify(table.Table.Database, table.Table.Schema, table.Table.Name);

    /// <summary>Aquí el límite va delante de las columnas, no al final.</summary>
    protected override string RowLimitPrefix(int maxRows) =>
        $"TOP ({maxRows.ToString(System.Globalization.CultureInfo.InvariantCulture)})";

    protected override string RowLimitSuffix(int maxRows) => string.Empty;

    /// <summary>`BIT` no entiende `true`: se escribe con uno y cero.</summary>
    protected override string BooleanLiteral(bool value) => value ? "1" : "0";

    /// <summary>Corchetes, duplicando el de cierre para que no se pueda escapar.</summary>
    protected override string Quote(string identifier) =>
        $"[{identifier.Replace("]", "]]", StringComparison.Ordinal)}]";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is SqlServerSession sqlServer
            ? sqlServer.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor SQL Server.",
                nameof(session));

    protected override string IdentityClause(TableColumnDefinition column) => "IDENTITY(1,1)";

    /// <summary>
    /// SQL Server separa las dos cosas: renombrar es un procedimiento del sistema
    /// y cambiar el tipo es `ALTER COLUMN`, que reescribe la columna entera. Por
    /// eso hay que repetir en ella todo lo que debe conservarse.
    /// </summary>
    protected override IReadOnlyList<string> AlterColumn(
        string qualifiedTable,
        ColumnAlteration change)
    {
        var statements = new List<string>();
        var column = change.Column;

        if (change.IsRename)
        {
            // El procedimiento recibe cadenas, no identificadores citados, así que
            // se escapa la comilla simple; el nombre viaja como literal.
            statements.Add(
                $"EXEC sp_rename '{Escape(qualifiedTable)}.{Escape(Quote(change.CurrentName))}', " +
                $"'{Escape(column.Name)}', 'COLUMN';");
        }

        var nullability = column.IsNullable ? "NULL" : "NOT NULL";

        statements.Add(
            $"ALTER TABLE {qualifiedTable} ALTER COLUMN {Quote(column.Name)} " +
            $"{column.DataType.Trim()} {nullability};");

        // El valor por omisión de SQL Server es una restricción con nombre propio,
        // no una propiedad de la columna: no se puede cambiar con ALTER COLUMN.
        if (!string.IsNullOrWhiteSpace(column.DefaultValue))
        {
            statements.Add(
                $"ALTER TABLE {qualifiedTable} ADD DEFAULT {column.DefaultValue.Trim()} " +
                $"FOR {Quote(column.Name)};");
        }

        return statements;
    }

    protected override string RenameTable(
        string qualifiedTable,
        DatabaseObject table,
        string newName) =>
        $"EXEC sp_rename '{Escape(qualifiedTable)}', '{Escape(newName)}';";

    /// <summary>Aquí el índice pertenece a la tabla y hay que nombrarla al borrarlo.</summary>
    protected override string DropIndex(
        string qualifiedTable,
        DatabaseObject table,
        string indexName) =>
        $"DROP INDEX {Quote(indexName)} ON {qualifiedTable};";

    /// <summary>SQL Server no admite `USING`: la estructura no se elige.</summary>
    protected override string IndexMethodClause(IndexDefinition index) => string.Empty;

    /// <summary>Escapa una comilla simple para meter un nombre dentro de un literal.</summary>
    private static string Escape(string value) =>
        value.Replace("'", "''", StringComparison.Ordinal);
}
