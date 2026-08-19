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
    /// MySQL tiene JSON propio, pero no identificadores únicos ni textos con
    /// zona horaria.
    ///
    /// **El límite de `varchar` no es el que dice el número.** Una fila entera
    /// cabe en 65 535 bytes, así que un `varchar(20000)` en UTF-8 ya no cabe con
    /// otra columna al lado; por eso lo que pasa de 8 000 se manda a `text`, que
    /// no cuenta contra ese límite.
    /// </summary>
    public override string TypeFor(TypeFacets facets) => facets.Family switch
    {
        // No hay tipo para un identificador único: 36 caracteres es su forma
        // escrita, y así se sigue leyendo igual que en el origen.
        ColumnFamily.Uuid => "char(36)",
        ColumnFamily.Boolean => "tinyint(1)",
        ColumnFamily.Integral => "bigint",
        ColumnFamily.Fractional => facets.Precision is { } precision
            ? $"decimal({precision},{facets.Scale ?? 0})"
            : "double",
        ColumnFamily.Date => "date",
        ColumnFamily.Time => "time",
        // MySQL no guarda la zona con la marca de tiempo: la convierte a UTC al
        // escribir y la devuelve en la zona de la sesión.
        ColumnFamily.Timestamp or ColumnFamily.TimestampWithZone => "datetime",
        ColumnFamily.Binary => facets.IsUnbounded || facets.Length is null
            ? "longblob"
            : $"varbinary({facets.Length})",
        _ when facets.IsJson => "json",
        _ when facets.IsUnbounded || facets.Length is null || facets.Length > 8000 => "longtext",
        _ => $"varchar({facets.Length})",
    };

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

    /// <summary>
    /// Aquí la barra invertida **también** escapa dentro de un literal, al
    /// contrario que en el estándar.
    ///
    /// Doblar solo las comillas dejaría que un texto acabado en barra se comiera
    /// la comilla de cierre y el respaldo siguiera leyéndose como instrucción. Es
    /// el mismo motivo por el que MySQL devuelve sus propias condiciones escapadas
    /// así, y por el que hay que deshacerlo al leerlas.
    /// </summary>
    protected override string TextLiteral(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        var escaped = text
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("'", "''", StringComparison.Ordinal);

        return $"'{escaped}'";
    }

    /// <summary>
    /// `X'…'` en lugar de `0x…`, que con una tira vacía sería un error de
    /// sintaxis: `X''` sí es un binario vacío válido.
    /// </summary>
    protected override string BinaryLiteral(byte[] value)
    {
        ArgumentNullException.ThrowIfNull(value);

        return $"X'{Convert.ToHexString(value)}'";
    }

    /// <summary>MySQL no tiene booleano: `BOOL` es `TINYINT(1)`, y se escribe así.</summary>
    protected override string BooleanLiteral(bool value) => value ? "1" : "0";

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
    /// En un respaldo, la tabla va a secas.
    ///
    /// Como aquí el esquema es la base, calificar el guion lo ataría a la base de
    /// la que salió: restaurar «en otra base» acabaría escribiendo en el origen.
    /// Sin nombre delante, cada instrucción va a donde apunte la conexión, que es
    /// lo que el usuario eligió. Es también lo que hace `mysqldump`.
    /// </summary>
    protected override ScriptedTable Portable(ScriptedTable table)
    {
        ArgumentNullException.ThrowIfNull(table);

        return table with
        {
            Table = table.Table with { Database = null, Schema = null },

            // Y lo mismo con lo que apuntan las claves foráneas: un `REFERENCES
            // ventas.clientes` en el `ALTER TABLE` ataría la mitad del artefacto
            // a la base de origen aunque las tablas se hubieran creado bien.
            Structure = table.Structure with
            {
                ForeignKeys =
                [
                    .. table.Structure.ForeignKeys
                        .Select(key => key with { ReferencedSchema = null }),
                ],
            },
        };
    }

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
