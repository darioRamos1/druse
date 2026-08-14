using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.Informix;

/// <summary>DDL de Informix. Solo aporta su dialecto.</summary>
public sealed class InformixTableDesigner : TableDesignerBase
{
    public override DatabaseEngine Engine => DatabaseEngine.Informix;

    public override IReadOnlyList<string> CommonDataTypes =>
    [
        "INTEGER", "BIGINT", "SMALLINT", "INT8", "BOOLEAN",
        "DECIMAL(18,2)", "MONEY(12,2)", "FLOAT", "SMALLFLOAT",
        "VARCHAR(50)", "VARCHAR(255)", "LVARCHAR", "CHAR(10)", "TEXT",
        "DATE", "DATETIME YEAR TO SECOND", "DATETIME YEAR TO FRACTION(5)", "INTERVAL DAY TO SECOND",
        "BYTE", "CLOB", "BLOB",
    ];

    /// <summary>
    /// Informix es el más limitado de los cuatro en índices: ni columnas
    /// incluidas ni índices parciales, y tampoco se elige la estructura desde
    /// esta forma de instrucción.
    /// </summary>
    public override IndexCapabilities IndexCapabilities => new()
    {
        SupportsIncludedColumns = false,
        SupportsFilter = false,
        SupportsSortDirection = true,
        Methods = [],
    };

    /// <summary>
    /// Comillas dobles, duplicándolas para que no se pueda escapar.
    ///
    /// Solo delimitan identificadores si la conexión lleva `DELIMIDENT=Y`, que es
    /// lo que pone <see cref="InformixConnectionStringFactory"/>. Sin eso, todo
    /// este DDL hablaría de cadenas en lugar de columnas.
    /// </summary>
    protected override string Quote(string identifier) =>
        $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is InformixSession informix
            ? informix.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor Informix.",
                nameof(session));

    /// <summary>
    /// No hay cláusula que añadir: en Informix la identidad **es el tipo**.
    ///
    /// El trabajo lo hace <see cref="DataTypeOf"/>, sustituyendo el tipo elegido
    /// por su equivalente autoincremental.
    /// </summary>
    protected override string IdentityClause(TableColumnDefinition column) => string.Empty;

    /// <summary>
    /// Cambia el tipo por el serial correspondiente cuando el motor genera el valor.
    ///
    /// El ancho se conserva: un `BIGINT` autoincremental es `BIGSERIAL` y no
    /// `SERIAL`, porque degradarlo a 32 bits agotaría los identificadores de una
    /// tabla grande sin que nadie lo hubiera pedido.
    /// </summary>
    protected override string DataTypeOf(TableColumnDefinition column)
    {
        ArgumentNullException.ThrowIfNull(column);

        var type = column.DataType.Trim();

        if (!column.IsIdentity)
        {
            return type;
        }

        return type.ToUpperInvariant() switch
        {
            "BIGINT" => "BIGSERIAL",
            "INT8" => "SERIAL8",
            _ => "SERIAL",
        };
    }

    /// <summary>
    /// Informix reescribe la columna entera con `MODIFY`, como MySQL: lo que no
    /// se repita en la instrucción se pierde. Renombrar es una instrucción aparte
    /// y va primero, para que el `MODIFY` hable ya del nombre nuevo.
    /// </summary>
    protected override IReadOnlyList<string> AlterColumn(
        string qualifiedTable,
        ColumnAlteration change)
    {
        ArgumentNullException.ThrowIfNull(change);

        var statements = new List<string>();

        if (change.IsRename)
        {
            statements.Add(
                $"RENAME COLUMN {qualifiedTable}.{Quote(change.CurrentName)} " +
                $"TO {Quote(change.Column.Name)};");
        }

        statements.Add(
            $"ALTER TABLE {qualifiedTable} MODIFY ({ColumnDefinition(change.Column).TrimStart()});");

        return statements;
    }

    protected override string RenameTable(
        string qualifiedTable,
        DatabaseObject table,
        string newName) =>
        $"RENAME TABLE {qualifiedTable} TO {Quote(newName)};";

    /// <summary>
    /// Aquí un índice es un objeto de la base y no algo colgado de la tabla, como
    /// en PostgreSQL: se borra por su nombre y sin mencionarla.
    /// </summary>
    protected override string DropIndex(
        string qualifiedTable,
        DatabaseObject table,
        string indexName)
    {
        ArgumentNullException.ThrowIfNull(table);

        return $"DROP INDEX {Qualify(table.Database, table.Schema, indexName)};";
    }

    /// <summary>Informix no admite `USING`: la estructura del índice no se elige.</summary>
    protected override string IndexMethodClause(IndexDefinition index) => string.Empty;

    /// <summary>
    /// El propietario hace de esquema, así que se califica igual que en los otros
    /// motores: `propietario.objeto`.
    /// </summary>
    protected override string Qualify(string? database, string? schema, string name)
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(schema))
        {
            parts.Add(Quote(schema));
        }

        parts.Add(Quote(name));

        return string.Join(".", parts);
    }
}
