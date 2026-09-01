using System.Collections.ObjectModel;
using System.Data.Common;
using System.Globalization;
using System.Text;
using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.SqlClient;
using static Druse.Database.Abstractions.MetadataBatch;

namespace Druse.Provider.SqlServer;

/// <summary>
/// Lee el catálogo de SQL Server.
///
/// Se usan las vistas `sys.*` en lugar de `INFORMATION_SCHEMA`: dan el recuento
/// de filas sin contar, distinguen tablas de vistas y exponen los procedimientos
/// aparte de las funciones. El SQL de aquí solo vale para SQL Server, que es
/// justo por lo que vive dentro del proveedor.
/// </summary>
public sealed class SqlServerMetadataReader : IDatabaseMetadataReader
{
    /// <summary>Esquema al que pertenece una tabla cuando nadie dice otro.</summary>
    private const string DefaultSchema = "dbo";

    /// <summary>Esquemas del sistema que no aportan nada al usuario.</summary>
    private const string SystemSchemaFilter = """
        s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner', 'db_accessadmin',
                       'db_securityadmin', 'db_ddladmin', 'db_backupoperator', 'db_datareader',
                       'db_datawriter', 'db_denydatareader', 'db_denydatawriter')
        """;

    public DatabaseEngine Engine => DatabaseEngine.SqlServer;

    public async Task<IReadOnlyList<DatabaseObject>> GetDatabasesAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT d.name
            FROM sys.databases d
            WHERE d.state = 0
              AND HAS_DBACCESS(d.name) = 1
            ORDER BY d.name
            """;

        return await QueryAsync(session, Sql, reader => new DatabaseObject
        {
            Id = $"db:{reader.GetString(0)}",
            Name = reader.GetString(0),
            Kind = DatabaseObjectKind.Database,
            Database = reader.GetString(0),
            HasChildren = true,
        }, cancellationToken);
    }

    public async Task<IReadOnlyList<DatabaseObject>> GetChildrenAsync(
        IDatabaseSession session,
        DatabaseObject parent,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(parent);

        return parent.Kind switch
        {
            DatabaseObjectKind.Database => await GetSchemasAsync(session, parent, cancellationToken),
            DatabaseObjectKind.Schema => GetSchemaFolders(parent),
            DatabaseObjectKind.Folder => await GetFolderContentAsync(session, parent, cancellationToken),
            DatabaseObjectKind.Table or DatabaseObjectKind.View => await GetColumnsAsObjectsAsync(session, parent, cancellationToken),
            _ => [],
        };
    }

    public async Task<IReadOnlyList<DatabaseColumn>> GetColumnsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(table);

        var columns = await GetColumnsAsync(session, [table], cancellationToken);

        return columns.TryGetValue(Key(table), out var found) ? found : [];
    }

    /// <summary>
    /// Columnas de varias tablas a la vez.
    ///
    /// Misma consulta, otro filtro: donde había un esquema y un nombre hay ahora
    /// una tabla derivada con los pares pedidos.
    /// </summary>
    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseColumn>>> GetColumnsAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        if (tables.Count == 0)
        {
            return ReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseColumn>>.Empty;
        }

        var (values, parameters) = Wanted(tables);

        var sql = $"""
            SELECT
                c.name,
                t.name AS type_name,
                c.max_length,
                c.precision,
                c.scale,
                c.is_nullable,
                CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
                dc.definition AS default_value,
                c.column_id,
                CASE WHEN c.is_identity = 1
                           OR c.is_computed = 1
                           OR c.generated_always_type <> 0
                           OR t.name IN ('timestamp', 'rowversion')
                     THEN 1 ELSE 0 END AS is_generated,
                s.name AS owner_schema,
                o.name AS owner_table
            FROM sys.columns c
            JOIN sys.objects o     ON o.object_id = c.object_id
            JOIN sys.schemas s     ON s.schema_id = o.schema_id
            JOIN sys.types t       ON t.user_type_id = c.user_type_id
            JOIN (VALUES {values}) AS want(schema_name, table_name)
                ON want.schema_name = s.name AND want.table_name = o.name
            LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
            LEFT JOIN (
                SELECT ic.object_id, ic.column_id
                FROM sys.index_columns ic
                JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                WHERE i.is_primary_key = 1
            ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
            ORDER BY s.name, o.name, c.column_id
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (
                Owner: Owner(reader, 10),
                Column: new DatabaseColumn
                {
                    Name = reader.GetString(0),
                    DataType = FormatType(
                        reader.GetString(1),
                        reader.GetInt16(2),
                        reader.GetByte(3),
                        reader.GetByte(4)),
                    IsNullable = reader.GetBoolean(5),
                    IsPrimaryKey = reader.GetInt32(6) != 0,
                    DefaultValue = reader.IsDBNull(7) ? null : reader.GetString(7),
                    Ordinal = reader.GetInt32(8),
                    IsGenerated = reader.GetInt32(9) != 0,
                }),
            cancellationToken,
            parameters);

        return GroupByTable(rows);
    }

    public Task<string> GetDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject databaseObject,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(databaseObject);

        return databaseObject.Kind switch
        {
            DatabaseObjectKind.View => GetViewDefinitionAsync(session, databaseObject, cancellationToken),
            DatabaseObjectKind.Procedure => GetProcedureDefinitionAsync(session, databaseObject, cancellationToken),
            _ => throw new ArgumentException(
                "Solo se puede obtener la definición de una vista o un procedimiento.",
                nameof(databaseObject)),
        };
    }

    public async Task<TableStructure> GetTableStructureAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(table);

        var structures = await GetStructuresAsync(session, [table], cancellationToken);

        return structures.TryGetValue(Key(table), out var found) ? found : new TableStructure();
    }

    /// <summary>
    /// Columnas y estructura de varias tablas en cinco consultas, sean dos tablas
    /// o sesenta.
    /// </summary>
    public async Task<IReadOnlyList<TableDetail>> GetTableDetailsAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(tables);

        if (tables.Count == 0)
        {
            return [];
        }

        var columns = await GetColumnsAsync(session, tables, cancellationToken);
        var structures = await GetStructuresAsync(session, tables, cancellationToken);

        return Compose(tables, Key, columns, structures);
    }

    /// <summary>Estructura de varias tablas, en cuatro consultas.</summary>
    private static async Task<IReadOnlyDictionary<TableRef, TableStructure>> GetStructuresAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        if (tables.Count == 0)
        {
            return ReadOnlyDictionary<TableRef, TableStructure>.Empty;
        }

        var indexes = await GetIndexesAsync(session, tables, cancellationToken);
        var foreignKeys = await GetForeignKeysAsync(session, tables, cancellationToken);
        var uniques = await GetUniqueConstraintsAsync(session, tables, cancellationToken);
        var checks = await GetCheckConstraintsAsync(session, tables, cancellationToken);

        var structures = new Dictionary<TableRef, TableStructure>();

        foreach (var table in tables)
        {
            var key = Key(table);

            if (structures.ContainsKey(key))
            {
                continue;
            }

            var own = indexes.TryGetValue(key, out var found) ? found : [];
            var primary = own.FirstOrDefault(index => index.IsPrimaryKey);

            structures[key] = new TableStructure
            {
                PrimaryKey = primary is null
                    ? null
                    : new DatabasePrimaryKey
                    {
                        Name = primary.Name,
                        Columns = [.. primary.Columns.Select(column => column.Name)],
                    },
                Indexes = own,
                ForeignKeys = foreignKeys.TryGetValue(key, out var keys) ? keys : [],
                UniqueConstraints = uniques.TryGetValue(key, out var unique) ? unique : [],
                CheckConstraints = checks.TryGetValue(key, out var check) ? check : [],
            };
        }

        return structures;
    }

    /// <summary>
    /// Índices con sus columnas de clave y las incluidas.
    ///
    /// Se descarta el montón (`index_id = 0`): no es un índice que alguien haya
    /// creado, sino la ausencia de uno, y ofrecerlo para borrar no tendría
    /// sentido. Las columnas se juntan con <c>STRING_AGG</c> ordenando por
    /// <c>key_ordinal</c>, porque en un índice el orden es lo que decide su uso.
    /// </summary>
    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseIndex>>> GetIndexesAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        var (values, parameters) = Wanted(tables);

        var sql = $"""
            SELECT
                i.name,
                i.is_unique,
                i.is_primary_key,
                CASE WHEN i.is_primary_key = 1 OR i.is_unique_constraint = 1 THEN 1 ELSE 0 END,
                LOWER(i.type_desc),
                i.filter_definition,
                (
                    SELECT STRING_AGG(
                        c.name + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END,
                        CHAR(31)) WITHIN GROUP (ORDER BY ic.key_ordinal)
                    FROM sys.index_columns ic
                    JOIN sys.columns c
                      ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                    WHERE ic.object_id = i.object_id
                      AND ic.index_id = i.index_id
                      AND ic.is_included_column = 0
                ),
                (
                    SELECT STRING_AGG(c.name, CHAR(31)) WITHIN GROUP (ORDER BY ic.index_column_id)
                    FROM sys.index_columns ic
                    JOIN sys.columns c
                      ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                    WHERE ic.object_id = i.object_id
                      AND ic.index_id = i.index_id
                      AND ic.is_included_column = 1
                ),
                s.name AS owner_schema,
                t.name AS owner_table
            FROM sys.indexes i
            JOIN sys.tables t   ON t.object_id = i.object_id
            JOIN sys.schemas s  ON s.schema_id = t.schema_id
            JOIN (VALUES {values}) AS want(schema_name, table_name)
                ON want.schema_name = s.name AND want.table_name = t.name
            WHERE i.index_id > 0
              AND i.name IS NOT NULL
            ORDER BY s.name, t.name, i.name
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (Owner: Owner(reader, 8), Index: new DatabaseIndex
            {
                Name = reader.GetString(0),
                IsUnique = reader.GetBoolean(1),
                IsPrimaryKey = reader.GetBoolean(2),
                IsConstraintIndex = reader.GetInt32(3) != 0,
                Method = reader.IsDBNull(4) ? null : reader.GetString(4),
                Filter = reader.IsDBNull(5) ? null : reader.GetString(5),
                Columns = reader.IsDBNull(6) ? [] : ParseIndexColumns(reader.GetString(6)),
                IncludedColumns = reader.IsDBNull(7) ? [] : Split(reader.GetString(7)),
            }),
            cancellationToken,
            parameters);

        return GroupByTable(rows);
    }

    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseForeignKey>>> GetForeignKeysAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        var (values, parameters) = Wanted(tables);

        // Las dos listas de columnas se ordenan por `constraint_column_id`, que es
        // lo que las empareja: son posicionales, no coincidentes por nombre.
        var sql = $"""
            SELECT
                fk.name,
                rs.name AS referenced_schema,
                rt.name AS referenced_table,
                fk.delete_referential_action,
                fk.update_referential_action,
                (
                    SELECT STRING_AGG(c.name, CHAR(31)) WITHIN GROUP (ORDER BY fkc.constraint_column_id)
                    FROM sys.foreign_key_columns fkc
                    JOIN sys.columns c
                      ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
                    WHERE fkc.constraint_object_id = fk.object_id
                ),
                (
                    SELECT STRING_AGG(c.name, CHAR(31)) WITHIN GROUP (ORDER BY fkc.constraint_column_id)
                    FROM sys.foreign_key_columns fkc
                    JOIN sys.columns c
                      ON c.object_id = fkc.referenced_object_id AND c.column_id = fkc.referenced_column_id
                    WHERE fkc.constraint_object_id = fk.object_id
                ),
                s.name AS owner_schema,
                t.name AS owner_table
            FROM sys.foreign_keys fk
            JOIN sys.tables t   ON t.object_id = fk.parent_object_id
            JOIN sys.schemas s  ON s.schema_id = t.schema_id
            JOIN sys.tables rt  ON rt.object_id = fk.referenced_object_id
            JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
            JOIN (VALUES {values}) AS want(schema_name, table_name)
                ON want.schema_name = s.name AND want.table_name = t.name
            ORDER BY s.name, t.name, fk.name
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (Owner: Owner(reader, 7), Key: new DatabaseForeignKey
            {
                Name = reader.GetString(0),
                ReferencedSchema = reader.GetString(1),
                ReferencedTable = reader.GetString(2),
                OnDelete = ParseAction(reader.GetByte(3)),
                OnUpdate = ParseAction(reader.GetByte(4)),
                Columns = reader.IsDBNull(5) ? [] : Split(reader.GetString(5)),
                ReferencedColumns = reader.IsDBNull(6) ? [] : Split(reader.GetString(6)),
            }),
            cancellationToken,
            parameters);

        return GroupByTable(rows);
    }

    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseUniqueConstraint>>> GetUniqueConstraintsAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        var (values, parameters) = Wanted(tables);

        var sql = $"""
            SELECT
                i.name,
                (
                    SELECT STRING_AGG(c.name, CHAR(31)) WITHIN GROUP (ORDER BY ic.key_ordinal)
                    FROM sys.index_columns ic
                    JOIN sys.columns c
                      ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                    WHERE ic.object_id = i.object_id
                      AND ic.index_id = i.index_id
                      AND ic.is_included_column = 0
                ),
                s.name AS owner_schema,
                t.name AS owner_table
            FROM sys.indexes i
            JOIN sys.tables t   ON t.object_id = i.object_id
            JOIN sys.schemas s  ON s.schema_id = t.schema_id
            JOIN (VALUES {values}) AS want(schema_name, table_name)
                ON want.schema_name = s.name AND want.table_name = t.name
            WHERE i.is_unique_constraint = 1
            ORDER BY s.name, t.name, i.name
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (Owner: Owner(reader, 2), Constraint: new DatabaseUniqueConstraint
            {
                Name = reader.GetString(0),
                Columns = reader.IsDBNull(1) ? [] : Split(reader.GetString(1)),
            }),
            cancellationToken,
            parameters);

        return GroupByTable(rows);
    }

    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseCheckConstraint>>> GetCheckConstraintsAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        var (values, parameters) = Wanted(tables);

        var sql = $"""
            SELECT cc.name, cc.definition, s.name AS owner_schema, t.name AS owner_table
            FROM sys.check_constraints cc
            JOIN sys.tables t   ON t.object_id = cc.parent_object_id
            JOIN sys.schemas s  ON s.schema_id = t.schema_id
            JOIN (VALUES {values}) AS want(schema_name, table_name)
                ON want.schema_name = s.name AND want.table_name = t.name
            ORDER BY s.name, t.name, cc.name
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (Owner: Owner(reader, 2), Constraint: new DatabaseCheckConstraint
            {
                Name = reader.GetString(0),
                Expression = Unwrap(reader.GetString(1)),
            }),
            cancellationToken,
            parameters);

        return GroupByTable(rows);
    }

    /// <summary>
    /// Parte una lista agregada por el servidor.
    ///
    /// El separador es el carácter 31, «separador de unidad», y no una coma: un
    /// nombre de columna puede llevar comas, y con ellas la lista se partiría
    /// donde no debe.
    /// </summary>
    private static string[] Split(string aggregated) =>
        aggregated.Split('\u001f', StringSplitOptions.RemoveEmptyEntries);

    private static IReadOnlyList<IndexColumn> ParseIndexColumns(string aggregated) =>
    [
        .. Split(aggregated).Select(entry =>
        {
            var descending = entry.EndsWith(" DESC", StringComparison.Ordinal);
            var separator = entry.LastIndexOf(' ');

            return new IndexColumn
            {
                Name = separator < 0 ? entry : entry[..separator],
                Direction = descending ? IndexSortDirection.Descending : IndexSortDirection.Ascending,
            };
        }),
    ];

    /// <summary>
    /// Quita los paréntesis con los que SQL Server envuelve una condición.
    ///
    /// El motor guarda `([precio]&gt;(0))` donde se escribió `precio &gt; 0`. Se
    /// retira solo el par exterior; normalizar el resto sería reescribir lo que
    /// el motor dice que tiene.
    /// </summary>
    private static string Unwrap(string definition)
    {
        var trimmed = definition.Trim();

        return trimmed.StartsWith('(') && trimmed.EndsWith(')')
            ? trimmed[1..^1].Trim()
            : trimmed;
    }

    /// <summary>Traduce el código de una acción referencial de SQL Server.</summary>
    private static ForeignKeyAction ParseAction(byte code) => code switch
    {
        1 => ForeignKeyAction.Cascade,
        2 => ForeignKeyAction.SetNull,
        3 => ForeignKeyAction.SetDefault,
        _ => ForeignKeyAction.NoAction,
    };

    private static async Task<string> GetViewDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject view,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT sm.definition
            FROM sys.views v
            JOIN sys.schemas s ON s.schema_id = v.schema_id
            LEFT JOIN sys.sql_modules sm ON sm.object_id = v.object_id
            WHERE s.name = @schema
              AND v.name = @view
            """;

        var definitions = await QueryAsync(
            session,
            Sql,
            reader => reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
            cancellationToken,
            ("schema", view.Schema ?? "dbo"),
            ("view", view.Name));

        if (definitions.Count == 1 && !string.IsNullOrWhiteSpace(definitions[0]))
        {
            return definitions[0].TrimEnd() + Environment.NewLine;
        }

        throw new DatabaseOperationException(new QueryError
        {
            Message = $"No se puede leer la definición de la vista {view.Schema}.{view.Name}; puede estar cifrada o no ser visible para este usuario.",
        });
    }

    private static async Task<string> GetProcedureDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject procedure,
        CancellationToken cancellationToken)
    {
        var schema = procedure.Schema ?? "dbo";

        const string Sql = """
            SELECT
                sm.definition,
                CASE WHEN p.type = 'PC' THEN 1 ELSE 0 END AS is_clr,
                CONVERT(bit, OBJECTPROPERTYEX(p.object_id, 'IsEncrypted')) AS is_encrypted
            FROM sys.procedures p
            JOIN sys.schemas s ON s.schema_id = p.schema_id
            LEFT JOIN sys.sql_modules sm ON sm.object_id = p.object_id
            WHERE s.name = @schema
              AND p.name = @procedure
            """;

        var definitions = await QueryAsync(
            session,
            Sql,
            reader => new ProcedureDefinition(
                reader.IsDBNull(0) ? null : reader.GetString(0),
                reader.GetInt32(1) != 0,
                !reader.IsDBNull(2) && reader.GetBoolean(2)),
            cancellationToken,
            ("schema", schema),
            ("procedure", procedure.Name));

        if (definitions.Count == 1 && definitions[0].Sql is { } definition
            && !string.IsNullOrWhiteSpace(definition))
        {
            return definition.TrimEnd() + Environment.NewLine;
        }

        var qualifiedName = $"{schema}.{procedure.Name}";
        var message = definitions.Count switch
        {
            0 => $"No se encontró el procedimiento {qualifiedName} o no es visible para este usuario.",
            _ when definitions[0].IsClr => $"La definición del procedimiento {qualifiedName} no está disponible porque es un procedimiento CLR.",
            _ when definitions[0].IsEncrypted => $"No se puede leer la definición del procedimiento {qualifiedName} porque está cifrado.",
            _ => $"La definición del procedimiento {qualifiedName} no está disponible para este usuario.",
        };

        throw new DatabaseOperationException(new QueryError { Message = message });
    }

    private sealed record ProcedureDefinition(string? Sql, bool IsClr, bool IsEncrypted);

    /// <summary>
    /// Firma de un procedimiento o función desde `sys.parameters`.
    ///
    /// El valor de retorno de una función aparece ahí con `parameter_id = 0` y
    /// sin nombre, así que se separa del resto en lugar de colarse como un
    /// parámetro más que nadie podría rellenar.
    ///
    /// `has_default_value` solo es de fiar en procedimientos CLR: para los de
    /// T-SQL, SQL Server no guarda en el catálogo si un parámetro tiene valor por
    /// omisión —está en el texto del `CREATE`— y devuelve 0 siempre. Se prefiere
    /// eso a interpretar el DDL: decir «no tiene» de más solo hace que la interfaz
    /// pida un valor que se podría haber omitido.
    /// </summary>
    public async Task<RoutineSignature> GetRoutineSignatureAsync(
        IDatabaseSession session,
        DatabaseObject routine,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(routine);

        var schema = routine.Schema ?? "dbo";

        const string Sql = """
            SELECT
                p.name,
                TYPE_NAME(p.user_type_id) AS type_name,
                p.max_length,
                p.precision,
                p.scale,
                p.is_output,
                p.parameter_id,
                p.has_default_value,
                o.type
            FROM sys.objects o
            JOIN sys.schemas s ON s.schema_id = o.schema_id
            LEFT JOIN sys.parameters p ON p.object_id = o.object_id
            WHERE s.name = @schema
              AND o.name = @routine
              AND o.type IN ('P', 'PC', 'FN', 'IF', 'TF', 'AF')
            ORDER BY p.parameter_id
            """;

        var rows = await QueryAsync(
            session,
            Sql,
            reader => new
            {
                Name = reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
                TypeName = reader.IsDBNull(1) ? "sql_variant" : reader.GetString(1),
                MaxLength = reader.IsDBNull(2) ? (short)0 : reader.GetInt16(2),
                Precision = reader.IsDBNull(3) ? (byte)0 : reader.GetByte(3),
                Scale = reader.IsDBNull(4) ? (byte)0 : reader.GetByte(4),
                IsOutput = !reader.IsDBNull(5) && reader.GetBoolean(5),
                ParameterId = reader.IsDBNull(6) ? -1 : reader.GetInt32(6),
                HasDefault = !reader.IsDBNull(7) && reader.GetBoolean(7),
                ObjectType = reader.GetString(8).Trim(),
            },
            cancellationToken,
            ("schema", schema),
            ("routine", routine.Name));

        if (rows.Count == 0)
        {
            throw new DatabaseOperationException(new QueryError
            {
                Message = $"No se encontró {schema}.{routine.Name} o no es visible para este usuario.",
            });
        }

        var isFunction = rows[0].ObjectType is "FN" or "IF" or "TF" or "AF";

        var parameters = rows
            .Where(row => row.ParameterId > 0)
            .Select(row => new RoutineParameter
            {
                Name = row.Name,
                DataType = FormatType(row.TypeName, row.MaxLength, row.Precision, row.Scale),
                Direction = row.IsOutput
                    ? RoutineParameterDirection.InputOutput
                    : RoutineParameterDirection.Input,
                Ordinal = row.ParameterId,
                HasDefault = row.HasDefault,
            })
            .ToList();

        var returnRow = rows.FirstOrDefault(row => row.ParameterId == 0);

        return new RoutineSignature
        {
            Name = routine.Name,
            Schema = schema,
            IsFunction = isFunction,
            Parameters = parameters,
            ReturnType = returnRow is null
                ? null
                : FormatType(returnRow.TypeName, returnRow.MaxLength, returnRow.Precision, returnRow.Scale),
        };
    }


    private static async Task<IReadOnlyList<DatabaseObject>> GetSchemasAsync(
        IDatabaseSession session,
        DatabaseObject parent,
        CancellationToken cancellationToken)
    {
        var sql = $"""
            SELECT s.name
            FROM sys.schemas s
            WHERE {SystemSchemaFilter}
            ORDER BY s.name
            """;

        return await QueryAsync(session, sql, reader => new DatabaseObject
        {
            Id = $"schema:{reader.GetString(0)}",
            Name = reader.GetString(0),
            Kind = DatabaseObjectKind.Schema,
            Database = parent.Database,
            Schema = reader.GetString(0),
            HasChildren = true,
        }, cancellationToken);
    }

    /// <summary>Agrupadores fijos bajo un esquema. Los mismos que en PostgreSQL.</summary>
    private static IReadOnlyList<DatabaseObject> GetSchemaFolders(DatabaseObject schema) =>
    [
        Folder("tables", "Tables", schema),
        Folder("views", "Views", schema),
        Folder("functions", "Functions", schema),
        Folder("procedures", "Procedures", schema),
    ];

    private static DatabaseObject Folder(string id, string name, DatabaseObject schema) => new()
    {
        Id = $"folder:{schema.Schema}:{id}",
        Name = name,
        Kind = DatabaseObjectKind.Folder,
        Database = schema.Database,
        Schema = schema.Schema,
        HasChildren = true,
    };

    private static async Task<IReadOnlyList<DatabaseObject>> GetFolderContentAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        CancellationToken cancellationToken)
    {
        var kind = folder.Id.Split(':').LastOrDefault();

        return kind switch
        {
            "tables" => await GetTablesAsync(session, folder, cancellationToken),
            "views" => await GetViewsAsync(session, folder, cancellationToken),
            "functions" => await GetRoutinesAsync(session, folder, "'FN', 'IF', 'TF', 'AF'", DatabaseObjectKind.Function, cancellationToken),
            "procedures" => await GetRoutinesAsync(session, folder, "'P', 'PC'", DatabaseObjectKind.Procedure, cancellationToken),
            _ => [],
        };
    }

    /// <summary>
    /// Tablas del esquema con su recuento aproximado.
    ///
    /// El recuento sale de `sys.partitions`, que es una vista de catálogo y solo
    /// exige poder ver la tabla. La DMV `sys.dm_db_partition_stats` daría lo
    /// mismo, pero **pide `VIEW DATABASE STATE`**, un permiso que un usuario de
    /// aplicación no suele tener: en una base restringida el servidor respondía
    /// con el error 262 y el explorador se quedaba sin poder listar nada.
    ///
    /// De un modo u otro el recuento es una estimación —lo mismo que `reltuples`
    /// en PostgreSQL—, porque un `COUNT(*)` por tabla haría inservible el
    /// explorador en una base grande.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetTablesAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        CancellationToken cancellationToken)
    {
        const string WithRowCount = """
            SELECT t.name, SUM(CASE WHEN p.index_id IN (0, 1) THEN p.[rows] ELSE 0 END) AS row_count
            FROM sys.tables t
            JOIN sys.schemas s ON s.schema_id = t.schema_id
            LEFT JOIN sys.partitions p ON p.object_id = t.object_id
            WHERE s.name = @schema
            GROUP BY t.name
            ORDER BY t.name
            """;

        // Sin recuento. Es la red de seguridad: mostrar las tablas sin el número
        // es infinitamente mejor que no mostrarlas.
        const string WithoutRowCount = """
            SELECT t.name, CAST(NULL AS bigint) AS row_count
            FROM sys.tables t
            JOIN sys.schemas s ON s.schema_id = t.schema_id
            WHERE s.name = @schema
            ORDER BY t.name
            """;

        DatabaseObject Project(DbDataReader reader) => new()
        {
            Id = $"{DatabaseObjectKind.Table}:{folder.Schema}.{reader.GetString(0)}",
            Name = reader.GetString(0),
            Kind = DatabaseObjectKind.Table,
            Database = folder.Database,
            Schema = folder.Schema,
            HasChildren = true,
            ApproximateRowCount = reader.IsDBNull(1) ? null : reader.GetInt64(1),
        };

        try
        {
            return await QueryAsync(
                session,
                WithRowCount,
                Project,
                cancellationToken,
                ("schema", folder.Schema ?? "dbo"));
        }
        catch (DatabaseOperationException exception) when (IsPermissionDenied(exception))
        {
            // Un permiso que falta al leer un dato accesorio no puede dejar al
            // usuario sin explorador.
            return await QueryAsync(
                session,
                WithoutRowCount,
                Project,
                cancellationToken,
                ("schema", folder.Schema ?? "dbo"));
        }
    }

    /// <summary>
    /// El servidor rechazó la consulta por permisos, no por estar mal escrita.
    ///
    /// Los números están comprobados, no supuestos: 229 y 230 son «permiso
    /// denegado» sobre un objeto o una columna; **262** es el que devolvió una
    /// base de Azure SQL al faltar `VIEW DATABASE PERFORMANCE STATE`, y **297**
    /// el que devuelve SQL Server 2022 ante un `DENY VIEW DATABASE STATE`; 300
    /// cubre los permisos de ámbito de servidor.
    ///
    /// El mismo permiso que falta se anuncia con un número distinto según dónde
    /// se ejecute, así que la lista tiene que cubrir las dos formas.
    ///
    /// El número llega como texto porque es lo que el error normalizado
    /// transporta: los motores no numeran igual, y el contrato no tiene por qué
    /// saberlo.
    /// </summary>
    private static bool IsPermissionDenied(DatabaseOperationException exception) =>
        exception.Error.Code is "229" or "230" or "262" or "297" or "300";

    private static async Task<IReadOnlyList<DatabaseObject>> GetViewsAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT v.name
            FROM sys.views v
            JOIN sys.schemas s ON s.schema_id = v.schema_id
            WHERE s.name = @schema
            ORDER BY v.name
            """;

        return await QueryAsync(
            session,
            Sql,
            reader => new DatabaseObject
            {
                Id = $"{DatabaseObjectKind.View}:{folder.Schema}.{reader.GetString(0)}",
                Name = reader.GetString(0),
                Kind = DatabaseObjectKind.View,
                Database = folder.Database,
                Schema = folder.Schema,
                HasChildren = true,
            },
            cancellationToken,
            ("schema", folder.Schema ?? "dbo"));
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetRoutinesAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        string types,
        DatabaseObjectKind kind,
        CancellationToken cancellationToken)
    {
        var sql = $"""
            SELECT o.name
            FROM sys.objects o
            JOIN sys.schemas s ON s.schema_id = o.schema_id
            WHERE s.name = @schema
              AND o.type IN ({types})
            ORDER BY o.name
            """;

        return await QueryAsync(
            session,
            sql,
            reader => new DatabaseObject
            {
                Id = $"{kind}:{folder.Schema}.{reader.GetString(0)}",
                Name = reader.GetString(0),
                Kind = kind,
                Database = folder.Database,
                Schema = folder.Schema,
                HasChildren = false,
            },
            cancellationToken,
            ("schema", folder.Schema ?? "dbo"));
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetColumnsAsObjectsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        var reader = new SqlServerMetadataReader();
        var columns = await reader.GetColumnsAsync(session, table, cancellationToken);

        return [.. columns.Select(column => new DatabaseObject
        {
            Id = $"column:{table.Schema}.{table.Name}.{column.Name}",
            Name = column.Name,
            Kind = DatabaseObjectKind.Column,
            Database = table.Database,
            Schema = table.Schema,
            HasChildren = false,
        })];
    }

    /// <summary>
    /// Compone el tipo con su longitud o precisión, como lo escribiría el usuario.
    ///
    /// `sys.columns` guarda las piezas por separado; mostrar solo «nvarchar» sin
    /// el tamaño perdería información que sí da PostgreSQL con `format_type`.
    /// </summary>
    private static string FormatType(string typeName, short maxLength, byte precision, byte scale)
    {
        switch (typeName.ToLowerInvariant())
        {
            case "nvarchar" or "nchar":
                // Se guarda en bytes; en caracteres es la mitad. -1 es MAX.
                return maxLength == -1
                    ? $"{typeName}(max)"
                    : $"{typeName}({maxLength / 2})";

            case "varchar" or "char" or "varbinary" or "binary":
                return maxLength == -1
                    ? $"{typeName}(max)"
                    : $"{typeName}({maxLength})";

            case "decimal" or "numeric":
                return $"{typeName}({precision},{scale})";

            case "datetime2" or "datetimeoffset" or "time":
                return $"{typeName}({scale})";

            default:
                return typeName;
        }
    }

    /// <summary>
    /// Las tablas pedidas como una tabla derivada de <c>VALUES</c>.
    ///
    /// SQL Server no sabe recorrer dos arreglos como hace PostgreSQL con
    /// <c>unnest</c>, y un tipo tabla obligaría a crearlo dentro de la base del
    /// usuario. Lo que se interpola en la consulta es **solo la lista de nombres
    /// de parámetro** —`(@s0, @n0), (@s1, @n1)`—, que son constantes generadas
    /// aquí: ningún nombre de esquema ni de tabla entra en el texto del SQL.
    ///
    /// El tope de parámetros de SQL Server son 2100, así que caben mil tablas en
    /// una lectura. Un diagrama con mil tablas tiene otros problemas antes.
    /// </summary>
    private static (string Values, (string Name, object Value)[] Parameters) Wanted(
        IReadOnlyList<DatabaseObject> tables)
    {
        var wanted = Unique(tables, Key);
        var values = new StringBuilder();
        var parameters = new (string Name, object Value)[wanted.Count * 2];

        for (var index = 0; index < wanted.Count; index++)
        {
            if (index > 0)
            {
                values.Append(", ");
            }

            values.Append(CultureInfo.InvariantCulture, $"(@s{index}, @n{index})");

            parameters[index * 2] = ($"s{index}", wanted[index].Schema ?? DefaultSchema);
            parameters[(index * 2) + 1] = ($"n{index}", wanted[index].Name);
        }

        return (values.ToString(), parameters);
    }

    /// <summary>
    /// La tabla a la que pertenece la fila que se está leyendo. Las dos columnas
    /// van al final de cada consulta para no descolocar lo que ya se leía.
    /// </summary>
    private static TableRef Owner(DbDataReader reader, int index) =>
        new(reader.GetString(index), reader.GetString(index + 1));

    /// <summary>
    /// Clave con la que se busca una tabla en lo leído, con el esquema por
    /// omisión ya aplicado igual que lo hace el filtro de la consulta.
    /// </summary>
    private static TableRef Key(DatabaseObject table) => new(table.Schema ?? DefaultSchema, table.Name);

    /// <summary>Ejecuta una consulta de catálogo y proyecta cada fila.</summary>
    private static async Task<IReadOnlyList<T>> QueryAsync<T>(
        IDatabaseSession session,
        string sql,
        Func<DbDataReader, T> project,
        CancellationToken cancellationToken,
        params (string Name, object Value)[] parameters)
    {
        if (session is not SqlServerSession sqlServer)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor SQL Server.",
                nameof(session));
        }

        await using var command = sqlServer.Connection.CreateCommand();
        command.CommandText = sql;

        // Leer el catálogo con una transacción manual abierta también va dentro
        // de ella. No es una preferencia: SQL Server se niega a ejecutar sobre
        // una conexión con transacción pendiente si el comando no la lleva, así
        // que sin esta línea expandir un nodo del árbol fallaría solo por haber
        // pulsado «Iniciar transacción».
        ((DbCommand)command).Transaction = sqlServer.Transaction.Current;

        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = $"@{name}";
            parameter.Value = value;
            command.Parameters.Add(parameter);
        }

        try
        {
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            var items = new List<T>();

            while (await reader.ReadAsync(cancellationToken))
            {
                items.Add(project(reader));
            }

            return items;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // El motivo real —un permiso que falta, un objeto que no está— tiene
            // que llegar a la pantalla. Ya viene saneado por el normalizador.
            throw new DatabaseOperationException(SqlServerErrorNormalizer.Normalize(exception));
        }
    }
}
