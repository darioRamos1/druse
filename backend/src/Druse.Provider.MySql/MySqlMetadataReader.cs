using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;
using MySqlConnector;

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
                CAST(c.ORDINAL_POSITION AS SIGNED) AS ordinal,
                c.EXTRA LIKE '%auto_increment%'
                    OR c.EXTRA LIKE '%GENERATED%' AS is_generated
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
                IsGenerated = reader.GetBoolean(6),
            },
            cancellationToken,
            ("schema", Schema(session, table)),
            ("table", table.Name));
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

        var schema = Schema(session, table);

        var indexes = await GetIndexesAsync(session, schema, table.Name, cancellationToken);
        var foreignKeys = await GetForeignKeysAsync(session, schema, table.Name, cancellationToken);
        var checks = await GetCheckConstraintsAsync(session, schema, table.Name, cancellationToken);
        var uniques = UniqueConstraints(indexes);

        var primary = indexes.FirstOrDefault(index => index.IsPrimaryKey);

        return new TableStructure
        {
            PrimaryKey = primary is null
                ? null
                : new DatabasePrimaryKey
                {
                    Name = primary.Name,
                    Columns = [.. primary.Columns.Select(column => column.Name)],
                },
            Indexes = indexes,
            ForeignKeys = foreignKeys,
            UniqueConstraints = uniques,
            CheckConstraints = checks,
        };
    }

    /// <summary>
    /// Índices, agrupando en memoria las filas que devuelve el catálogo.
    ///
    /// `STATISTICS` da una fila por columna y la tentación es juntarlas con
    /// `GROUP_CONCAT`, pero esa función corta en `group_concat_max_len` —1024
    /// bytes de fábrica— **sin avisar**: un índice ancho aparecería con menos
    /// columnas de las que tiene y nada lo delataría. Agrupar aquí no puede
    /// truncar.
    ///
    /// La clave primaria se llama siempre `PRIMARY` en MySQL, que es como se
    /// reconoce: no hay una columna que lo diga.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseIndex>> GetIndexesAsync(
        IDatabaseSession session,
        string schema,
        string table,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT
                INDEX_NAME,
                SEQ_IN_INDEX,
                COLUMN_NAME,
                NON_UNIQUE,
                COLLATION,
                INDEX_TYPE
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = @schema
              AND TABLE_NAME = @table
            ORDER BY INDEX_NAME, SEQ_IN_INDEX
            """;

        var rows = await QueryAsync(
            session,
            Sql,
            reader => (
                Index: reader.GetString(0),
                Column: reader.IsDBNull(2) ? null : reader.GetString(2),
                NonUnique: reader.GetInt64(3) != 0,
                Descending: !reader.IsDBNull(4) && reader.GetString(4) == "D",
                Type: reader.IsDBNull(5) ? null : reader.GetString(5)),
            cancellationToken,
            ("schema", schema),
            ("table", table));

        return
        [
            .. rows
                .GroupBy(row => row.Index, StringComparer.Ordinal)
                .Select(group => new DatabaseIndex
                {
                    Name = group.Key,
                    IsUnique = !group.First().NonUnique,
                    IsPrimaryKey = group.Key == "PRIMARY",

                    // En MySQL un índice único *es* la restricción de unicidad:
                    // no son dos objetos como en los otros motores. Se marca para
                    // que la interfaz no ofrezca borrarlo dos veces por caminos
                    // distintos.
                    IsConstraintIndex = group.Key == "PRIMARY" || !group.First().NonUnique,
                    Method = group.First().Type?.ToLowerInvariant(),
                    Columns =
                    [
                        .. group
                            .Where(row => row.Column is not null)
                            .Select(row => new IndexColumn
                            {
                                Name = row.Column!,
                                Direction = row.Descending
                                    ? IndexSortDirection.Descending
                                    : IndexSortDirection.Ascending,
                            }),
                    ],
                })
                .OrderBy(index => index.Name, StringComparer.Ordinal),
        ];
    }

    private static async Task<IReadOnlyList<DatabaseForeignKey>> GetForeignKeysAsync(
        IDatabaseSession session,
        string schema,
        string table,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT
                k.CONSTRAINT_NAME,
                k.ORDINAL_POSITION,
                k.COLUMN_NAME,
                k.REFERENCED_TABLE_SCHEMA,
                k.REFERENCED_TABLE_NAME,
                k.REFERENCED_COLUMN_NAME,
                r.DELETE_RULE,
                r.UPDATE_RULE
            FROM information_schema.KEY_COLUMN_USAGE k
            JOIN information_schema.REFERENTIAL_CONSTRAINTS r
              ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
             AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
             AND r.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = @schema
              AND k.TABLE_NAME = @table
              AND k.REFERENCED_TABLE_NAME IS NOT NULL
            ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
            """;

        var rows = await QueryAsync(
            session,
            Sql,
            reader => (
                Name: reader.GetString(0),
                Column: reader.GetString(2),
                ReferencedSchema: reader.IsDBNull(3) ? null : reader.GetString(3),
                ReferencedTable: reader.GetString(4),
                ReferencedColumn: reader.GetString(5),
                OnDelete: reader.GetString(6),
                OnUpdate: reader.GetString(7)),
            cancellationToken,
            ("schema", schema),
            ("table", table));

        return
        [
            .. rows
                .GroupBy(row => row.Name, StringComparer.Ordinal)
                .Select(group => new DatabaseForeignKey
                {
                    Name = group.Key,
                    ReferencedSchema = group.First().ReferencedSchema,
                    ReferencedTable = group.First().ReferencedTable,
                    OnDelete = ParseAction(group.First().OnDelete),
                    OnUpdate = ParseAction(group.First().OnUpdate),
                    Columns = [.. group.Select(row => row.Column)],
                    ReferencedColumns = [.. group.Select(row => row.ReferencedColumn)],
                })
                .OrderBy(key => key.Name, StringComparer.Ordinal),
        ];
    }

    /// <summary>
    /// Restricciones de unicidad, tomadas de los índices ya leídos.
    ///
    /// En MySQL una `UNIQUE` no existe aparte de su índice, así que consultarla
    /// en `TABLE_CONSTRAINTS` devolvería exactamente los mismos objetos con otro
    /// nombre de tabla del catálogo. Se derivan de lo que ya se leyó y así no se
    /// paga otra consulta sobre una conexión que no admite dos a la vez.
    /// </summary>
    private static IReadOnlyList<DatabaseUniqueConstraint> UniqueConstraints(
        IReadOnlyList<DatabaseIndex> indexes) =>
    [
        .. indexes
            .Where(index => index.IsUnique && !index.IsPrimaryKey)
            .Select(index => new DatabaseUniqueConstraint
            {
                Name = index.Name,
                Columns = [.. index.Columns.Select(column => column.Name)],
            }),
    ];

    /// <summary>
    /// Condiciones de comprobación.
    ///
    /// `CHECK_CONSTRAINTS` no existe antes de MySQL 8.0.16 ni de MariaDB 10.2. Un
    /// servidor viejo responde con un error de tabla desconocida, y quedarse sin
    /// ver los índices por eso sería peor que no enseñar las condiciones: se
    /// devuelve vacío.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseCheckConstraint>> GetCheckConstraintsAsync(
        IDatabaseSession session,
        string schema,
        string table,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT c.CONSTRAINT_NAME, c.CHECK_CLAUSE
            FROM information_schema.CHECK_CONSTRAINTS c
            JOIN information_schema.TABLE_CONSTRAINTS t
              ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA
             AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME
            WHERE t.TABLE_SCHEMA = @schema
              AND t.TABLE_NAME = @table
            ORDER BY c.CONSTRAINT_NAME
            """;

        try
        {
            return await QueryAsync(
                session,
                Sql,
                reader => new DatabaseCheckConstraint
                {
                    Name = reader.GetString(0),
                    Expression = reader.GetString(1),
                },
                cancellationToken,
                ("schema", schema),
                ("table", table));
        }
        catch (MySqlException error) when (error.Number is 1109 or 1146)
        {
            return [];
        }
    }

    /// <summary>Traduce la regla referencial que nombra el estándar.</summary>
    private static ForeignKeyAction ParseAction(string rule) => rule switch
    {
        "CASCADE" => ForeignKeyAction.Cascade,
        "SET NULL" => ForeignKeyAction.SetNull,
        "SET DEFAULT" => ForeignKeyAction.SetDefault,
        _ => ForeignKeyAction.NoAction,
    };

    private static async Task<string> GetViewDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject view,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(view);

        var schema = Schema(session, view);
        var sql = $"SHOW CREATE VIEW {Quote(schema)}.{Quote(view.Name)}";
        var definitions = await QueryAsync(
            session,
            sql,
            reader => reader.GetString(1),
            cancellationToken);

        if (definitions.Count == 1 && !string.IsNullOrWhiteSpace(definitions[0]))
        {
            return definitions[0].TrimEnd().TrimEnd(';') + ";" + Environment.NewLine;
        }

        throw new DatabaseOperationException(new QueryError
        {
            Message = $"No se pudo obtener la definición de la vista {schema}.{view.Name}.",
        });
    }

    private static async Task<string> GetProcedureDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject procedure,
        CancellationToken cancellationToken)
    {
        var schema = Schema(session, procedure);
        var sql = $"SHOW CREATE PROCEDURE {Quote(schema)}.{Quote(procedure.Name)}";
        var definitions = await QueryAsync(
            session,
            sql,
            reader => reader.GetString(2),
            cancellationToken);

        if (definitions.Count == 1 && !string.IsNullOrWhiteSpace(definitions[0]))
        {
            return definitions[0].TrimEnd().TrimEnd(';') + ";" + Environment.NewLine;
        }

        throw new DatabaseOperationException(new QueryError
        {
            Message = $"No se pudo obtener la definición del procedimiento {schema}.{procedure.Name}.",
        });
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

    private static string Quote(string identifier) =>
        $"`{identifier.Replace("`", "``", StringComparison.Ordinal)}`";

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
            throw new DatabaseOperationException(MySqlErrorNormalizer.Normalize(exception));
        }
    }
}
