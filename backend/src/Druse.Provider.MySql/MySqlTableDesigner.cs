using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.MySql;

/// <summary>DDL de MySQL y MariaDB. Solo aporta su dialecto.</summary>
public sealed class MySqlTableDesigner : TableDesignerBase
{
    public override DatabaseEngine Engine => DatabaseEngine.MySql;

    public override IReadOnlyList<string> CommonDataTypes =>
    [
        "INT", "BIGINT", "SMALLINT", "TINYINT(1)",
        "DECIMAL(18,2)", "FLOAT", "DOUBLE",
        "VARCHAR(50)", "VARCHAR(255)", "TEXT", "LONGTEXT", "CHAR(10)",
        "DATE", "DATETIME", "TIMESTAMP", "TIME",
        "JSON", "BLOB", "BINARY(16)",
    ];

    /// <summary>Acentos graves, duplicándolos para que no se pueda escapar.</summary>
    protected override string Quote(string identifier) =>
        $"`{identifier.Replace("`", "``", StringComparison.Ordinal)}`";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is MySqlSession mySql
            ? mySql.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor MySQL.",
                nameof(session));

    /// <summary>
    /// MySQL hace un commit implícito antes de cada `ALTER TABLE`.
    ///
    /// Envolverlo en una transacción daría una falsa sensación de seguridad: si la
    /// tercera instrucción falla, las dos primeras ya están aplicadas y no hay
    /// vuelta atrás. Es mejor decirlo que fingir lo contrario.
    /// </summary>
    protected override bool SupportsTransactionalDdl => false;

    protected override string IdentityClause(TableColumnDefinition column) => "AUTO_INCREMENT";

    /// <summary>
    /// `MODIFY` y `CHANGE` reescriben la columna entera.
    ///
    /// A diferencia de los otros motores, aquí no se puede tocar solo el tipo o
    /// solo la nulabilidad: lo que no se repita en la instrucción se pierde. Por
    /// eso se vuelca la definición completa, incluido el valor por omisión.
    /// </summary>
    protected override IReadOnlyList<string> AlterColumn(
        string qualifiedTable,
        ColumnAlteration change)
    {
        var definition = ColumnDefinition(change.Column).TrimStart();

        // `CHANGE` es el único que renombra; `MODIFY` es el mismo cambio sin
        // nombre nuevo, y se usa cuando la columna se llama igual.
        return change.IsRename
            ?
            [
                $"ALTER TABLE {qualifiedTable} CHANGE {Quote(change.CurrentName)} {definition};",
            ]
            :
            [
                $"ALTER TABLE {qualifiedTable} MODIFY {definition};",
            ];
    }

    protected override string RenameTable(
        string qualifiedTable,
        DatabaseObject table,
        string newName) =>
        $"RENAME TABLE {qualifiedTable} TO {Quote(newName)};";

    /// <summary>
    /// En MySQL el esquema **es** la base, así que no hay dos niveles que
    /// calificar: escribir `base.esquema.tabla` sería un nombre inválido.
    /// </summary>
    protected override string Qualify(string? database, string? schema, string name)
    {
        var container = !string.IsNullOrWhiteSpace(schema) ? schema : database;

        return string.IsNullOrWhiteSpace(container)
            ? Quote(name)
            : $"{Quote(container)}.{Quote(name)}";
    }
}
