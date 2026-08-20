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
    /// SQL Server pide dos decisiones que los demás no.
    ///
    /// **El texto va en `nvarchar` y no en `varchar`**: es lo único que garantiza
    /// que lo que venía de un `text` de PostgreSQL —que es UTF-8— llegue entero,
    /// porque `varchar` depende de la intercalación de la base de destino.
    ///
    /// **Y no hay JSON.** Desde 2016 hay funciones para consultarlo, pero el tipo
    /// es texto: lo que se pierde al traerlo aquí es la validación, no los datos.
    /// </summary>
    public override string TypeFor(TypeFacets facets) => facets.Family switch
    {
        ColumnFamily.Uuid => "uniqueidentifier",
        ColumnFamily.Boolean => "bit",
        ColumnFamily.Integral => "bigint",
        ColumnFamily.Fractional => facets.Precision is { } precision
            ? $"decimal({precision},{facets.Scale ?? 0})"
            : "float",
        ColumnFamily.Date => "date",
        ColumnFamily.Time => "time",
        ColumnFamily.Timestamp => "datetime2",
        ColumnFamily.TimestampWithZone => "datetimeoffset",
        ColumnFamily.Binary => facets.IsUnbounded || facets.Length is null
            ? "varbinary(max)"
            : $"varbinary({facets.Length})",
        _ when facets.IsUnbounded || facets.Length is null => "nvarchar(max)",
        _ => $"nvarchar({facets.Length})",
    };

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
    /// Aquí un respaldo se lee con `SNAPSHOT` y no con lecturas repetibles.
    ///
    /// En SQL Server, `REPEATABLE READ` mantiene bloqueos compartidos hasta el
    /// final: un respaldo de media hora dejaría media base sin poder escribirse.
    /// La instantánea no bloquea a nadie, pero exige que la base la tenga
    /// habilitada, y si no la tiene el motor **rechaza la transacción** en vez de
    /// degradarla. Por eso se intenta y se declara lo que salga.
    /// </summary>
    public override ScripterCapabilities Capabilities { get; } = new()
    {
        Isolation = BackupIsolation.Snapshot,
    };

    /// <summary>
    /// Se le pregunta a la base si admite instantáneas **antes** de pedir una.
    ///
    /// No es precaución de más: SQL Server acepta abrir la transacción sin rechistar
    /// y **falla en la primera consulta** con «snapshot isolation is not allowed in
    /// this database». Un respaldo que reventara al leer la primera tabla no sería
    /// un límite declarado, sería una función rota en cualquier base que no tenga
    /// la opción encendida —que es como vienen de fábrica—.
    ///
    /// Sin instantánea se lee sin garantía y el manifiesto lo dice, en lugar de
    /// caer a `REPEATABLE READ`: allí eso mantiene bloqueos hasta el final y un
    /// respaldo de media hora dejaría media base sin poder escribirse.
    /// </summary>
    protected override async Task<BackupIsolation> ResolveIsolationAsync(
        DbConnection connection,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(connection);

        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT snapshot_isolation_state FROM sys.databases WHERE database_id = DB_ID();";

        var state = await command.ExecuteScalarAsync(cancellationToken);

        // 1 es «encendido»; 2 y 3 son estados de transición mientras se activa.
        return state is byte and 1 ? BackupIsolation.Snapshot : BackupIsolation.None;
    }

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

    /// <summary>
    /// SQL Server no admite `IF NOT EXISTS` en `CREATE SCHEMA`, y además exige
    /// que sea la primera instrucción de su lote: por eso va dentro de un
    /// `EXEC`, que es la forma de condicionarlo sin partir el guion en lotes.
    /// </summary>
    public override IReadOnlyList<string> ScriptSchema(string schema)
    {
        if (string.IsNullOrWhiteSpace(schema))
        {
            return [];
        }

        return
        [
            $"IF SCHEMA_ID({TextLiteral(schema)}) IS NULL EXEC({TextLiteral($"CREATE SCHEMA {Quote(schema)}")});",
        ];
    }

    /// <summary>El mismo normalizador que usan las consultas de este motor.</summary>
    protected override QueryError Normalize(Exception exception) =>
        SqlServerErrorNormalizer.Normalize(exception);

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
