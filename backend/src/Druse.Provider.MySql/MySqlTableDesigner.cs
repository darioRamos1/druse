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

    /// <summary>
    /// MySQL es el más limitado de los tres: ni columnas incluidas ni índices
    /// parciales. A cambio ofrece estructuras que los otros no tienen, y por eso
    /// aparecen aquí `fulltext` y `spatial`, que en MySQL son una clase de índice
    /// y no un `USING`.
    /// </summary>
    public override IndexCapabilities IndexCapabilities => new()
    {
        SupportsIncludedColumns = false,
        SupportsFilter = false,
        SupportsSortDirection = true,
        Methods = ["btree", "hash", "fulltext", "spatial"],
    };

    /// <summary>
    /// Lo que MySQL pierde al reproducir una tabla, declarado en vez de disimulado.
    ///
    /// Su clave primaria se llama siempre `PRIMARY`, escriba uno lo que escriba, y
    /// aquí el esquema **es** la base: no hay dos niveles que calificar.
    /// </summary>
    public override ScripterCapabilities Capabilities { get; } = new()
    {
        NamesPrimaryKey = false,
        SupportsSchemas = false,
    };

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
    public override bool SupportsTransactionalDdl => false;

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

    /// <summary>Aquí el índice pertenece a la tabla y hay que nombrarla al borrarlo.</summary>
    protected override string DropIndex(
        string qualifiedTable,
        DatabaseObject table,
        string indexName) =>
        $"DROP INDEX {Quote(indexName)} ON {qualifiedTable};";

    /// <summary>
    /// `FULLTEXT` y `SPATIAL` no son un `USING`: son la clase del índice y van
    /// donde en otros motores iría `UNIQUE`.
    /// </summary>
    protected override string IndexKind(IndexDefinition index)
    {
        ArgumentNullException.ThrowIfNull(index);

        return index.Method?.ToLowerInvariant() switch
        {
            "fulltext" => "FULLTEXT ",
            "spatial" => "SPATIAL ",
            _ => index.IsUnique ? "UNIQUE " : string.Empty,
        };
    }

    /// <summary>
    /// La estructura se escribe al final, después de las columnas, y solo cuando
    /// de verdad es una estructura: `FULLTEXT` ya se escribió delante.
    /// </summary>
    protected override string IndexMethodClause(IndexDefinition index) => string.Empty;

    protected override string IndexSuffix(IndexDefinition index)
    {
        ArgumentNullException.ThrowIfNull(index);

        return index.Method?.ToLowerInvariant() switch
        {
            "btree" or "hash" => $" USING {index.Method.ToUpperInvariant()}",
            _ => string.Empty,
        };
    }

    /// <summary>
    /// MySQL exige decir qué clase de restricción se suelta.
    ///
    /// `DROP CONSTRAINT` genérico solo existe desde MySQL 8.0.19 y no cubre las
    /// claves foráneas ni los índices únicos, así que se nombra siempre el tipo:
    /// funciona igual en 8.0 y en MariaDB.
    /// </summary>
    protected override string DropConstraint(
        string qualifiedTable,
        string name,
        ConstraintKind kind) => kind switch
        {
            ConstraintKind.PrimaryKey => $"ALTER TABLE {qualifiedTable} DROP PRIMARY KEY;",
            ConstraintKind.ForeignKey => $"ALTER TABLE {qualifiedTable} DROP FOREIGN KEY {Quote(name)};",
            ConstraintKind.Unique => $"ALTER TABLE {qualifiedTable} DROP INDEX {Quote(name)};",
            _ => $"ALTER TABLE {qualifiedTable} DROP CHECK {Quote(name)};",
        };

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
