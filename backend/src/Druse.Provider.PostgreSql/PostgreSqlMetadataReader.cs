using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.PostgreSql;

/// <summary>
/// Lee el catálogo de PostgreSQL.
///
/// Las consultas usan los catálogos <c>pg_*</c> en lugar de
/// <c>information_schema</c>: son más rápidos, exponen el recuento estimado de
/// filas y distinguen tablas de vistas materializadas, cosa que el estándar no
/// hace. A cambio, este SQL solo vale para PostgreSQL, que es precisamente por
/// lo que vive dentro del proveedor y no en un sitio común.
/// </summary>
public sealed class PostgreSqlMetadataReader : IDatabaseMetadataReader
{
    /// <summary>Esquemas internos que no aportan nada al usuario.</summary>
    private const string SystemSchemaFilter =
        "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'";

    public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

    public async Task<IReadOnlyList<DatabaseObject>> GetDatabasesAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT d.datname
            FROM pg_database d
            WHERE d.datname = current_database()
              AND d.datistemplate = false
              AND d.datallowconn = true
              AND has_database_privilege(d.datname, 'CONNECT')
            ORDER BY d.datname
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
            // Npgsql abre la conexión contra una base concreta y PostgreSQL no
            // permite saltar entre bases sin reconectar. Por eso solo se listan los
            // esquemas de la base de la sesión.
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
                a.attname,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                NOT a.attnotnull                     AS is_nullable,
                COALESCE(pk.is_primary, false)       AS is_primary_key,
                pg_get_expr(ad.adbin, ad.adrelid)    AS default_value,
                a.attnum,
                a.attidentity <> ''
                    OR a.attgenerated <> ''
                    OR COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') LIKE 'nextval(%'
                                                    AS is_generated
            FROM pg_attribute a
            JOIN pg_class c     ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
            LEFT JOIN LATERAL (
                SELECT true AS is_primary
                FROM pg_index i
                WHERE i.indrelid = c.oid
                  AND i.indisprimary
                  AND a.attnum = ANY (i.indkey)
                LIMIT 1
            ) pk ON true
            WHERE n.nspname = @schema
              AND c.relname = @table
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
            """;

        return await QueryAsync(
            session,
            Sql,
            reader => new DatabaseColumn
            {
                Name = reader.GetString(0),
                DataType = reader.GetString(1),
                IsNullable = reader.GetBoolean(2),
                IsPrimaryKey = reader.GetBoolean(3),
                DefaultValue = reader.IsDBNull(4) ? null : reader.GetString(4),
                Ordinal = reader.GetInt16(5),
                IsGenerated = reader.GetBoolean(6),
            },
            cancellationToken,
            ("schema", table.Schema ?? "public"),
            ("table", table.Name));
    }

    public async Task<string> GetViewDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject view,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(view);

        const string Sql = """
            SELECT
                CASE c.relkind
                    WHEN 'm' THEN 'CREATE MATERIALIZED VIEW '
                    ELSE 'CREATE VIEW '
                END
                || quote_ident(n.nspname) || '.' || quote_ident(c.relname)
                || CASE
                    WHEN c.reloptions IS NULL THEN ''
                    ELSE E'\nWITH (' || array_to_string(c.reloptions, ', ') || ')'
                END
                || CASE
                    WHEN c.relkind = 'm' AND c.reltablespace <> 0
                    THEN E'\nTABLESPACE ' || quote_ident(t.spcname)
                    ELSE ''
                END
                || E' AS\n' || pg_get_viewdef(c.oid, true)
                || CASE
                    WHEN c.relkind = 'm' AND NOT c.relispopulated
                    THEN E'\nWITH NO DATA'
                    ELSE ''
                END
                || E';\n'
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_tablespace t ON t.oid = c.reltablespace
            WHERE n.nspname = @schema
              AND c.relname = @view
              AND c.relkind IN ('v', 'm')
            """;

        var definitions = await QueryAsync(
            session,
            Sql,
            reader => reader.GetString(0),
            cancellationToken,
            ("schema", view.Schema ?? "public"),
            ("view", view.Name));

        return RequireDefinition(definitions, view);
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetSchemasAsync(
        IDatabaseSession session,
        DatabaseObject parent,
        CancellationToken cancellationToken)
    {
        var sql = $"""
            SELECT n.nspname
            FROM pg_namespace n
            WHERE {SystemSchemaFilter}
              AND has_schema_privilege(n.nspname, 'USAGE')
            ORDER BY n.nspname
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

    /// <summary>Agrupadores fijos bajo un esquema. No salen del catálogo.</summary>
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
            "tables" => await GetRelationsAsync(session, folder, "'r', 'p'", DatabaseObjectKind.Table, cancellationToken),
            "views" => await GetRelationsAsync(session, folder, "'v', 'm'", DatabaseObjectKind.View, cancellationToken),
            "functions" => await GetRoutinesAsync(session, folder, "'f', 'a', 'w'", DatabaseObjectKind.Function, cancellationToken),
            "procedures" => await GetRoutinesAsync(session, folder, "'p'", DatabaseObjectKind.Procedure, cancellationToken),
            _ => [],
        };
    }

    /// <summary>
    /// Tablas o vistas del esquema.
    ///
    /// <c>reltuples</c> es la estimación del planificador, no un recuento exacto:
    /// contar de verdad exigiría un <c>COUNT(*)</c> por tabla, que en una base
    /// grande convertiría el explorador en algo inservible.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetRelationsAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        string relkinds,
        DatabaseObjectKind kind,
        CancellationToken cancellationToken)
    {
        var sql = $"""
            SELECT c.relname, c.reltuples::bigint
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = @schema
              AND c.relkind IN ({relkinds})
            ORDER BY c.relname
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
                HasChildren = true,
                ApproximateRowCount = reader.GetInt64(1) < 0 ? null : reader.GetInt64(1),
            },
            cancellationToken,
            ("schema", folder.Schema ?? "public"));
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetRoutinesAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        string prokinds,
        DatabaseObjectKind kind,
        CancellationToken cancellationToken)
    {
        var sql = $"""
            SELECT p.proname
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = @schema
              AND p.prokind IN ({prokinds})
            ORDER BY p.proname
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
            ("schema", folder.Schema ?? "public"));
    }

    /// <summary>Columnas presentadas como nodos, para el explorador.</summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetColumnsAsObjectsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        var reader = new PostgreSqlMetadataReader();
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
    /// Ejecuta una consulta de catálogo y proyecta cada fila.
    ///
    /// Los valores siempre van como parámetros: aunque el nombre de un esquema
    /// venga del propio catálogo, concatenarlo sería crear el hábito equivocado.
    /// Los fragmentos interpolados de las consultas son constantes del código.
    /// </summary>
    private static async Task<IReadOnlyList<T>> QueryAsync<T>(
        IDatabaseSession session,
        string sql,
        Func<DbDataReader, T> project,
        CancellationToken cancellationToken,
        params (string Name, object Value)[] parameters)
    {
        if (session is not PostgreSqlSession postgres)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor PostgreSQL.",
                nameof(session));
        }

        await using var command = postgres.Connection.CreateCommand();
        command.CommandText = sql;

        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
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
            throw new DatabaseOperationException(PostgreSqlErrorNormalizer.Normalize(exception));
        }
    }

    private static string RequireDefinition(
        IReadOnlyList<string> definitions,
        DatabaseObject view)
    {
        if (definitions.Count == 1 && !string.IsNullOrWhiteSpace(definitions[0]))
        {
            return definitions[0];
        }

        throw new DatabaseOperationException(new QueryError
        {
            Message = $"No se pudo obtener la definición de la vista {view.Schema}.{view.Name}.",
        });
    }
}
