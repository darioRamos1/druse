using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.SqlClient;

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
        // El proveedor todavía consulta `sys.*` en el catálogo de la conexión.
        // Mostrar otras bases aquí haría que el árbol etiquetara como ajenos
        // objetos que en realidad leyó de la base conectada.
        const string Sql = """
            SELECT d.name
            FROM sys.databases d
            WHERE d.name = DB_NAME()
              AND d.state = 0
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

        const string Sql = """
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
                     THEN 1 ELSE 0 END AS is_generated
            FROM sys.columns c
            JOIN sys.objects o     ON o.object_id = c.object_id
            JOIN sys.schemas s     ON s.schema_id = o.schema_id
            JOIN sys.types t       ON t.user_type_id = c.user_type_id
            LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
            LEFT JOIN (
                SELECT ic.object_id, ic.column_id
                FROM sys.index_columns ic
                JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                WHERE i.is_primary_key = 1
            ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
            WHERE s.name = @schema
              AND o.name = @table
            ORDER BY c.column_id
            """;

        return await QueryAsync(
            session,
            Sql,
            reader => new DatabaseColumn
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
            },
            cancellationToken,
            ("schema", table.Schema ?? "dbo"),
            ("table", table.Name));
    }

    public Task<string> GetDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject databaseObject,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(databaseObject);

        if (!string.IsNullOrWhiteSpace(databaseObject.Database)
            && !string.Equals(databaseObject.Database, session.Profile.Database, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException(
                "La definición solo está disponible para objetos de la base conectada.",
                nameof(databaseObject));
        }

        return databaseObject.Kind switch
        {
            DatabaseObjectKind.View => GetViewDefinitionAsync(session, databaseObject, cancellationToken),
            DatabaseObjectKind.Procedure => GetProcedureDefinitionAsync(session, databaseObject, cancellationToken),
            _ => throw new ArgumentException(
                "Solo se puede obtener la definición de una vista o un procedimiento.",
                nameof(databaseObject)),
        };
    }

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
