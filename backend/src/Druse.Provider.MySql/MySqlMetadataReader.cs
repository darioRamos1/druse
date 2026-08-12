using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.MySql;

/// <summary>
/// Lee el catálogo de MySQL y MariaDB.
///
/// Aquí sí se usa `information_schema`, al contrario que en los otros dos
/// proveedores: MySQL no tiene catálogos internos equivalentes a `pg_*` o `sys.*`
/// que aporten algo más, y `information_schema` ya trae el recuento aproximado de
/// filas y el tipo completo de cada columna.
///
/// **MySQL no distingue base de esquema: `SCHEMA` es un sinónimo de `DATABASE`.**
/// Aun así el árbol conserva los dos niveles, con un esquema del mismo nombre que
/// su base. Así el explorador se comporta igual en los tres motores y las
/// carpetas siempre cuelgan de un esquema; la alternativa —un árbol distinto solo
/// para MySQL— obligaría a ramificar por motor en la interfaz, que es justo lo
/// que el plan §13 prohíbe.
/// </summary>
public sealed class MySqlMetadataReader : IDatabaseMetadataReader
{
    /// <summary>Esquemas del sistema que no aportan nada al usuario.</summary>
    private const string SystemSchemaFilter =
        "s.SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')";

    public DatabaseEngine Engine => DatabaseEngine.MySql;

    public async Task<IReadOnlyList<DatabaseObject>> GetDatabasesAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        // MySQL sí permite consultar otras bases desde la misma conexión, así que
        // todas las que se listan aquí son navegables de verdad.
        var sql = $"""
            SELECT s.SCHEMA_NAME
            FROM information_schema.SCHEMATA s
            WHERE {SystemSchemaFilter}
            ORDER BY s.SCHEMA_NAME
            """;

        return await QueryAsync(session, sql, reader => new DatabaseObject
        {
            Id = $"db:{reader.GetString(0)}",
            Name = reader.GetString(0),
            Kind = DatabaseObjectKind.Database,
            Database = reader.GetString(0),
            HasChildren = true,
        }, cancellationToken);
    }

    public Task<IReadOnlyList<DatabaseObject>> GetChildrenAsync(
        IDatabaseSession session,
        DatabaseObject parent,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(parent);

        return parent.Kind switch
        {
            DatabaseObjectKind.Database => Task.FromResult(GetSchemas(parent)),
            DatabaseObjectKind.Schema => Task.FromResult(GetSchemaFolders(parent)),
            DatabaseObjectKind.Folder => GetFolderContentAsync(session, parent, cancellationToken),
            DatabaseObjectKind.Table or DatabaseObjectKind.View => GetColumnsAsObjectsAsync(session, parent, cancellationToken),
            _ => Task.FromResult<IReadOnlyList<DatabaseObject>>([]),
        };
    }

    public async Task<IReadOnlyList<DatabaseColumn>> GetColumnsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(table);

        // COLUMN_TYPE trae el tipo completo —`varchar(200)`, `decimal(10,2)`,
        // `enum('a','b')`—, mientras que DATA_TYPE solo daría la familia.
        // ORDINAL_POSITION es un entero sin signo, que .NET no lee como Int32.
        const string Sql = """
            SELECT
                c.COLUMN_NAME,
                c.COLUMN_TYPE,
                c.IS_NULLABLE,
                c.COLUMN_KEY,
                c.COLUMN_DEFAULT,
                CAST(c.ORDINAL_POSITION AS SIGNED) AS ordinal
            FROM information_schema.COLUMNS c
            WHERE c.TABLE_SCHEMA = @schema
              AND c.TABLE_NAME = @table
            ORDER BY c.ORDINAL_POSITION
            """;

        return await QueryAsync(
            session,
            Sql,
            reader => new DatabaseColumn
            {
                Name = reader.GetString(0),
                DataType = reader.GetString(1),
                // Se declara como texto 'YES'/'NO', no como booleano.
                IsNullable = reader.GetString(2) == "YES",
                // 'PRI' marca la clave primaria; 'UNI' y 'MUL' son otros índices.
                IsPrimaryKey = reader.GetString(3) == "PRI",
                DefaultValue = reader.IsDBNull(4) ? null : reader.GetString(4),
                Ordinal = (int)reader.GetInt64(5),
            },
            cancellationToken,
            ("schema", Schema(session, table)),
            ("table", table.Name));
    }

    /// <summary>
    /// El único esquema de una base de MySQL: ella misma.
    ///
    /// No se consulta el catálogo porque no hay nada que consultar. Ver la nota de
    /// la clase sobre por qué el nivel se conserva.
    /// </summary>
    private static IReadOnlyList<DatabaseObject> GetSchemas(DatabaseObject database) =>
    [
        new DatabaseObject
        {
            Id = $"schema:{database.Name}",
            Name = database.Name,
            Kind = DatabaseObjectKind.Schema,
            Database = database.Database ?? database.Name,
            Schema = database.Name,
            HasChildren = true,
        },
    ];

    /// <summary>Agrupadores fijos bajo un esquema. Los mismos que en los otros motores.</summary>
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
            "functions" => await GetRoutinesAsync(session, folder, "FUNCTION", DatabaseObjectKind.Function, cancellationToken),
            "procedures" => await GetRoutinesAsync(session, folder, "PROCEDURE", DatabaseObjectKind.Procedure, cancellationToken),
            _ => [],
        };
    }

    /// <summary>
    /// Tablas del esquema con su recuento aproximado.
    ///
    /// `TABLE_ROWS` es una estimación del motor de almacenamiento, no un recuento
    /// exacto: en InnoDB sale del muestreo del índice y puede desviarse bastante.
    /// Igual que `reltuples` en PostgreSQL, se prefiere a hacer un `COUNT(*)` por
    /// tabla, que dejaría inservible el explorador en una base grande.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetTablesAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT t.TABLE_NAME, CAST(t.TABLE_ROWS AS SIGNED) AS row_count
            FROM information_schema.TABLES t
            WHERE t.TABLE_SCHEMA = @schema
              AND t.TABLE_TYPE = 'BASE TABLE'
            ORDER BY t.TABLE_NAME
            """;

        return await QueryAsync(
            session,
            Sql,
            reader => new DatabaseObject
            {
                Id = $"{DatabaseObjectKind.Table}:{folder.Schema}.{reader.GetString(0)}",
                Name = reader.GetString(0),
                Kind = DatabaseObjectKind.Table,
                Database = folder.Database,
                Schema = folder.Schema,
                HasChildren = true,
                ApproximateRowCount = reader.IsDBNull(1) ? null : reader.GetInt64(1),
            },
            cancellationToken,
            ("schema", Schema(session, folder)));
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetViewsAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT t.TABLE_NAME
            FROM information_schema.TABLES t
            WHERE t.TABLE_SCHEMA = @schema
              AND t.TABLE_TYPE = 'VIEW'
            ORDER BY t.TABLE_NAME
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
            ("schema", Schema(session, folder)));
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetRoutinesAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        string routineType,
        DatabaseObjectKind kind,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT r.ROUTINE_NAME
            FROM information_schema.ROUTINES r
            WHERE r.ROUTINE_SCHEMA = @schema
              AND r.ROUTINE_TYPE = @type
            ORDER BY r.ROUTINE_NAME
            """;

        return await QueryAsync(
            session,
            Sql,
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
            ("schema", Schema(session, folder)),
            ("type", routineType));
    }

    /// <summary>Columnas presentadas como nodos, para el explorador.</summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetColumnsAsObjectsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        var reader = new MySqlMetadataReader();
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
    /// Esquema al que apunta un nodo.
    ///
    /// Si no lo trae, se usa la base de la sesión. En MySQL no hay un esquema por
    /// omisión equivalente a `public` o `dbo` que pudiera servir de recambio.
    /// </summary>
    private static string Schema(IDatabaseSession session, DatabaseObject node) =>
        node.Schema ?? node.Database ?? session.Profile.Database;

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
        if (session is not MySqlSession mysql)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor MySQL.",
                nameof(session));
        }

        await using var command = mysql.Connection.CreateCommand();
        command.CommandText = sql;

        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = $"@{name}";
            parameter.Value = value;
            command.Parameters.Add(parameter);
        }

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var items = new List<T>();

        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(project(reader));
        }

        return items;
    }
}
