using System.Collections.ObjectModel;
using System.Data.Common;
using System.Globalization;
using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.Sqlite;
using static Druse.Database.Abstractions.MetadataBatch;

namespace Druse.Provider.Sqlite;

/// <summary>
/// Lee el catálogo de SQLite.
///
/// Aquí no hay `information_schema` ni vistas del sistema: hay **una tabla**,
/// `sqlite_master`, con el nombre y el `CREATE` de cada objeto, y unos `PRAGMA`
/// que devuelven lo demás. Los `PRAGMA` son la parte incómoda, porque de origen
/// hablan de una tabla cada uno: leer sesenta tablas serían ciento ochenta
/// llamadas.
///
/// Desde SQLite 3.16 se pueden usar **como si fueran tablas** —`pragma_table_info`
/// dentro de un `FROM`— y eso es lo que convierte tres llamadas por tabla en tres
/// consultas para todas. Es lo que hace posible un diagrama aquí.
///
/// **El árbol tiene los mismos niveles que en los demás motores**, aunque aquí
/// solo haya una base: el archivo abierto se llama `main` y debajo cuelga un
/// esquema de su mismo nombre. Es el truco que ya usan MySQL y Oracle, y lo que
/// permite que el explorador se comporte igual en los seis (plan §13).
/// </summary>
public sealed class SqliteMetadataReader : IDatabaseMetadataReader
{
    /// <summary>El archivo abierto. SQLite siempre lo llama así.</summary>
    internal const string MainDatabase = "main";

    public DatabaseEngine Engine => DatabaseEngine.Sqlite;

    /// <summary>
    /// Objetos que SQLite se crea para sí. Todos empiezan por `sqlite_`, y ese
    /// prefijo lo tiene reservado: nadie puede crear uno que se llame así.
    /// </summary>
    private const string NotInternal = "m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'";

    /// <summary>
    /// Las bases de esta conexión.
    ///
    /// Normalmente una: el archivo abierto. Salen más si alguien ha hecho un
    /// `ATTACH` en esta misma sesión, y entonces son navegables de verdad, así que
    /// se listan. `temp` no: es la base en memoria de la conexión y no contiene
    /// nada del usuario.
    /// </summary>
    public async Task<IReadOnlyList<DatabaseObject>> GetDatabasesAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT d.name
            FROM pragma_database_list() d
            WHERE d.name <> 'temp'
            ORDER BY d.seq
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
            DatabaseObjectKind.Table or DatabaseObjectKind.View =>
                GetColumnsAsObjectsAsync(session, parent, cancellationToken),
            _ => Task.FromResult<IReadOnlyList<DatabaseObject>>([]),
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
    /// Columnas de varias tablas en **una** consulta.
    ///
    /// `table_xinfo` y no `table_info` porque el primero además enseña las
    /// columnas calculadas, que el segundo esconde: sin ellas, el diseñador
    /// creería que no existen y el `INSERT` que escribiera intentaría rellenarlas.
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

        var (placeholders, parameters) = Wanted(tables);

        var sql = $"""
            SELECT c.name, c.type, c."notnull", c.dflt_value, c.pk, c.hidden, c.cid, m.name
            FROM sqlite_master m
            JOIN pragma_table_xinfo(m.name) c
            WHERE m.name IN ({placeholders})
            ORDER BY m.name, c.cid
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (
                Table: reader.GetString(7),
                Name: reader.GetString(0),
                // El tipo **declarado**, que en SQLite puede estar vacío: una
                // columna sin tipo es legal y acepta cualquier cosa. Se enseña
                // como `BLOB`, que es la afinidad que el motor le da.
                Type: reader.IsDBNull(1) || reader.GetString(1).Length == 0
                    ? "BLOB"
                    : reader.GetString(1),
                NotNull: reader.GetInt64(2) != 0,
                Default: reader.IsDBNull(3) ? null : reader.GetString(3),
                PrimaryKey: reader.GetInt64(4) != 0,
                // 2 y 3 son las columnas calculadas —virtual y almacenada—; 1 es
                // una columna oculta de una tabla virtual.
                Generated: reader.GetInt64(5) is 2 or 3,
                Ordinal: (int)reader.GetInt64(6)),
            cancellationToken,
            parameters);

        var grouped = new Dictionary<TableRef, IReadOnlyList<DatabaseColumn>>();

        foreach (var group in rows.GroupBy(row => row.Table))
        {
            var columnas = group.ToList();

            // Una tabla con **una sola** clave primaria declarada `INTEGER` no
            // guarda esa columna: es un alias del `rowid`, y el motor la rellena
            // solo si se omite. Es el autoincremento de SQLite, y hay que decirlo
            // o el diseñador propondría escribirla a mano.
            var claves = columnas.Where(column => column.PrimaryKey).ToList();
            var esRowId = claves.Count == 1
                && string.Equals(claves[0].Type, "INTEGER", StringComparison.OrdinalIgnoreCase);

            grouped[new TableRef(null, group.Key)] =
            [
                .. columnas.Select((column, index) => new DatabaseColumn
                {
                    Name = column.Name,
                    DataType = column.Type,
                    IsNullable = !column.NotNull,
                    IsPrimaryKey = column.PrimaryKey,
                    DefaultValue = column.Default,
                    // `cid` cuenta desde cero y el resto del sistema desde uno.
                    Ordinal = column.Ordinal + 1,
                    IsGenerated = column.Generated
                        || (esRowId && column.PrimaryKey),
                }),
            ];
        }

        return grouped;
    }

    /// <summary>
    /// El `CREATE` tal y como lo guardó el motor.
    ///
    /// SQLite es el único de los seis que guarda **el texto original**: ni lo
    /// reescribe ni lo normaliza. Lo que se devuelve aquí es literalmente lo que
    /// alguien escribió, con sus saltos de línea y sus comentarios.
    /// </summary>
    public async Task<string> GetDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject databaseObject,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(databaseObject);

        if (databaseObject.Kind is not (DatabaseObjectKind.View or DatabaseObjectKind.Table))
        {
            throw new ArgumentException(
                "Solo se puede obtener la definición de una vista o una tabla: SQLite no tiene " +
                "procedimientos.",
                nameof(databaseObject));
        }

        const string Sql = "SELECT m.sql FROM sqlite_master m WHERE m.name = $nombre";

        var rows = await QueryAsync(
            session,
            Sql,
            reader => reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
            cancellationToken,
            ("nombre", databaseObject.Name));

        return rows.Count > 0 ? rows[0] : string.Empty;
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

    /// <summary>Columnas y estructura de varias tablas en cuatro consultas.</summary>
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

    private static async Task<IReadOnlyDictionary<TableRef, TableStructure>> GetStructuresAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        if (tables.Count == 0)
        {
            return ReadOnlyDictionary<TableRef, TableStructure>.Empty;
        }

        var columns = await GetColumnsAsync(session, tables, cancellationToken);
        var indexes = await GetIndexesAsync(session, tables, cancellationToken);
        var foreignKeys = await GetForeignKeysAsync(session, tables, cancellationToken);

        var wanted = Unique(tables, Key);
        var result = new Dictionary<TableRef, TableStructure>();

        foreach (var table in wanted)
        {
            var tableIndexes = indexes.TryGetValue(table, out var found) ? found : [];

            // **La clave primaria no está entre los índices.** SQLite solo crea un
            // índice para ella cuando no es un `INTEGER PRIMARY KEY`, así que
            // sacarla de ahí la perdería justo en el caso más común. Sale de las
            // columnas, que es donde siempre está.
            var claves = columns.TryGetValue(table, out var suyas)
                ? suyas.Where(column => column.IsPrimaryKey).Select(column => column.Name).ToList()
                : [];

            result[table] = new TableStructure
            {
                PrimaryKey = claves.Count == 0
                    ? null
                    : new DatabasePrimaryKey
                    {
                        // SQLite no le pone nombre: la restricción no es un objeto
                        // con identidad propia. Se nombra como la nombraría
                        // cualquiera al escribirla.
                        Name = $"pk_{table.Name}",
                        Columns = claves,
                    },
                Indexes = tableIndexes,
                ForeignKeys = foreignKeys.TryGetValue(table, out var keys) ? keys : [],
                UniqueConstraints =
                [
                    .. tableIndexes
                        .Where(index => index.IsConstraintIndex && !index.IsPrimaryKey)
                        .Select(index => new DatabaseUniqueConstraint
                        {
                            Name = index.Name,
                            Columns = [.. index.Columns.Select(column => column.Name)],
                        }),
                ],

                // **Las condiciones de comprobación no se leen.**
                //
                // SQLite las admite, pero no las expone en ningún `PRAGMA`: lo
                // único que hay es el `CREATE TABLE` original, en texto. Sacarlas
                // de ahí exigiría interpretar SQL, y hacerlo a medias produciría
                // condiciones inventadas. Por eso el diseñador tampoco las ofrece
                // —ver `IndexCapabilities`—: enseñar un campo que se guarda y
                // desaparece al releer sería peor que no tenerlo.
                CheckConstraints = [],
            };
        }

        return result;
    }

    /// <summary>
    /// Índices de varias tablas, con sus columnas y su sentido.
    ///
    /// `index_xinfo` y no `index_info` porque el primero trae el sentido de
    /// ordenación y marca cuáles de las columnas son de la clave y cuáles las
    /// arrastra el `rowid`; esas últimas se descartan, que es lo que hace que un
    /// índice de una columna no se lea como uno de dos.
    /// </summary>
    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseIndex>>> GetIndexesAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        var (placeholders, parameters) = Wanted(tables);

        var sql = $"""
            SELECT m.name, i.name, i."unique", i.origin, i.partial,
                   x.name, x.desc, x.seqno, s.sql
            FROM sqlite_master m
            JOIN pragma_index_list(m.name) i
            JOIN pragma_index_xinfo(i.name) x
            LEFT JOIN sqlite_master s ON s.type = 'index' AND s.name = i.name
            WHERE m.name IN ({placeholders}) AND x.key = 1
            ORDER BY m.name, i.name, x.seqno
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (
                Table: reader.GetString(0),
                Index: reader.GetString(1),
                Unique: reader.GetInt64(2) != 0,
                // `c` es un índice que alguien creó; `u` y `pk` los sostiene una
                // restricción y el motor no deja borrarlos sueltos.
                Origin: reader.GetString(3),
                Partial: reader.GetInt64(4) != 0,
                // En un índice sobre una expresión la columna llega nula, y lo
                // que hay es el `CREATE INDEX` entero.
                Column: reader.IsDBNull(5) ? null : reader.GetString(5),
                Descending: reader.GetInt64(6) != 0,
                Definition: reader.IsDBNull(8) ? null : reader.GetString(8)),
            cancellationToken,
            parameters);

        var grouped = new Dictionary<TableRef, List<DatabaseIndex>>();

        foreach (var group in rows.GroupBy(row => (row.Table, row.Index)))
        {
            var first = group.First();
            var key = new TableRef(null, first.Table);

            if (!grouped.TryGetValue(key, out var list))
            {
                list = [];
                grouped[key] = list;
            }

            list.Add(new DatabaseIndex
            {
                Name = first.Index,
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
                IsUnique = first.Unique,
                IsPrimaryKey = first.Origin == "pk",
                IsConstraintIndex = first.Origin is "pk" or "u",
                // Un índice parcial lleva su condición dentro del `CREATE`, que es
                // lo único que SQLite guarda de ella.
                Filter = first.Partial ? Where(first.Definition) : null,
                Definition = first.Definition,
            });
        }

        return grouped.ToDictionary(
            pair => pair.Key,
            pair => (IReadOnlyList<DatabaseIndex>)pair.Value);
    }

    /// <summary>
    /// La condición de un índice parcial, sacada de su `CREATE INDEX`.
    ///
    /// No es interpretar SQL: es quedarse con lo que va después del último
    /// `WHERE`, que en un `CREATE INDEX` solo puede ser eso. Se enseña tal cual y
    /// no se vuelve a escribir a partir de ella.
    /// </summary>
    private static string? Where(string? definition)
    {
        if (definition is null)
        {
            return null;
        }

        var index = definition.LastIndexOf(" WHERE ", StringComparison.OrdinalIgnoreCase);

        return index < 0 ? null : definition[(index + 7)..].Trim();
    }

    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseForeignKey>>> GetForeignKeysAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        var (placeholders, parameters) = Wanted(tables);

        // `id` agrupa las columnas de una misma clave; `seq` las ordena dentro.
        var sql = $"""
            SELECT m.name, f.id, f.seq, f."table", f."from", f."to",
                   f.on_delete, f.on_update
            FROM sqlite_master m
            JOIN pragma_foreign_key_list(m.name) f
            WHERE m.name IN ({placeholders})
            ORDER BY m.name, f.id, f.seq
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (
                Table: reader.GetString(0),
                Id: reader.GetInt64(1),
                Referenced: reader.GetString(3),
                Column: reader.GetString(4),
                // Nula cuando la clave apunta a la primaria del destino sin
                // nombrarla, que es lo corriente.
                ReferencedColumn: reader.IsDBNull(5) ? null : reader.GetString(5),
                OnDelete: reader.GetString(6),
                OnUpdate: reader.GetString(7)),
            cancellationToken,
            parameters);

        var grouped = new Dictionary<TableRef, List<DatabaseForeignKey>>();

        foreach (var group in rows.GroupBy(row => (row.Table, row.Id)))
        {
            var first = group.First();
            var key = new TableRef(null, first.Table);

            if (!grouped.TryGetValue(key, out var list))
            {
                list = [];
                grouped[key] = list;
            }

            list.Add(new DatabaseForeignKey
            {
                // Tampoco tienen nombre: SQLite no lo guarda aunque se escriba un
                // `CONSTRAINT x FOREIGN KEY`. Se nombra por la tabla y su orden,
                // que es estable mientras la tabla no cambie.
                Name = $"fk_{first.Table}_{first.Id.ToString(CultureInfo.InvariantCulture)}",
                Columns = [.. group.Select(row => row.Column)],
                ReferencedTable = first.Referenced,
                ReferencedColumns =
                [
                    .. group.Select(row => row.ReferencedColumn ?? "rowid"),
                ],
                OnDelete = ParseAction(first.OnDelete),
                OnUpdate = ParseAction(first.OnUpdate),
            });
        }

        return grouped.ToDictionary(
            pair => pair.Key,
            pair => (IReadOnlyList<DatabaseForeignKey>)pair.Value);
    }

    private static ForeignKeyAction ParseAction(string rule) => rule switch
    {
        "CASCADE" => ForeignKeyAction.Cascade,
        "SET NULL" => ForeignKeyAction.SetNull,
        "SET DEFAULT" => ForeignKeyAction.SetDefault,
        // `RESTRICT` no está en el dominio porque los demás motores lo tratan
        // igual que no hacer nada: los dos rechazan el borrado. Lo que cambia
        // es cuándo se comprueba, y eso no se puede pedir al diseñarla.
        _ => ForeignKeyAction.NoAction,
    };

    /// <summary>
    /// SQLite **no tiene rutinas**.
    ///
    /// No hay procedimientos, no hay funciones almacenadas y no hay lenguaje en
    /// el que escribirlas: lo que se puede añadir son funciones definidas por la
    /// aplicación que abre el archivo, y esas viven en el programa y no en la
    /// base. Se lanza en vez de devolver una firma vacía porque llegar aquí es un
    /// error de quien llama, y una firma sin parámetros se leería como una rutina
    /// que existe y no recibe nada.
    /// </summary>
    public Task<RoutineSignature> GetRoutineSignatureAsync(
        IDatabaseSession session,
        DatabaseObject routine,
        CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "SQLite no tiene procedimientos ni funciones almacenadas.");

    // -----------------------------------------------------------------------
    // El árbol
    // -----------------------------------------------------------------------

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

    /// <summary>
    /// Dos carpetas y no cuatro: aquí no hay funciones ni procedimientos.
    ///
    /// Enseñarlas vacías diría que la base no tiene ninguno, cuando lo que pasa
    /// es que el motor no sabe lo que son.
    /// </summary>
    private static IReadOnlyList<DatabaseObject> GetSchemaFolders(DatabaseObject schema) =>
    [
        Folder("tables", "Tables", schema),
        Folder("views", "Views", schema),
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
            "tables" => await GetObjectsAsync(
                session, folder, "table", DatabaseObjectKind.Table, cancellationToken),
            "views" => await GetObjectsAsync(
                session, folder, "view", DatabaseObjectKind.View, cancellationToken),
            _ => [],
        };
    }

    /// <summary>
    /// Tablas o vistas del archivo.
    ///
    /// **No hay recuento aproximado.** SQLite no guarda estadísticas de filas —lo
    /// más parecido es `ANALYZE`, que hay que pedir a mano y casi nadie pide— así
    /// que se deja vacío en lugar de hacer un `COUNT(*)` por tabla, que en un
    /// archivo grande dejaría el explorador inservible.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetObjectsAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        string type,
        DatabaseObjectKind kind,
        CancellationToken cancellationToken)
    {
        var sql = $"""
            SELECT m.name
            FROM sqlite_master m
            WHERE m.type = $tipo AND {NotInternal}
            ORDER BY m.name
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
            },
            cancellationToken,
            ("tipo", type));
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetColumnsAsObjectsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        var reader = new SqliteMetadataReader();
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

    // -----------------------------------------------------------------------
    // Ayudantes
    // -----------------------------------------------------------------------

    /// <summary>
    /// Clave con la que se busca una tabla en lo leído.
    ///
    /// **Sin esquema**: en SQLite no hay dos niveles que distinguir, y el que el
    /// árbol enseña es sintético. Guardarlo aquí haría que la misma tabla no se
    /// encontrara según de qué nodo viniera.
    /// </summary>
    private static TableRef Key(DatabaseObject table) => new(null, table.Name);

    /// <summary>
    /// Las tablas pedidas como lista de parámetros para un <c>IN</c>.
    ///
    /// Se interpolan **solo nombres de parámetro**; ningún identificador entra en
    /// el texto de la consulta.
    /// </summary>
    private static (string Placeholders, (string Name, object Value)[] Parameters) Wanted(
        IReadOnlyList<DatabaseObject> tables)
    {
        var wanted = Unique(tables, Key);
        var nombres = new string[wanted.Count];
        var parameters = new (string Name, object Value)[wanted.Count];

        for (var index = 0; index < wanted.Count; index++)
        {
            nombres[index] = $"$t{index.ToString(CultureInfo.InvariantCulture)}";
            parameters[index] = ($"t{index}", wanted[index].Name);
        }

        return (string.Join(", ", nombres), parameters);
    }

    /// <summary>
    /// Ejecuta una consulta de catálogo y proyecta cada fila.
    ///
    /// Los valores siempre van como parámetros: aunque el nombre de una tabla
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
        if (session is not SqliteSession sqlite)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor SQLite.",
                nameof(session));
        }

        await using var command = sqlite.Connection.CreateCommand();
        command.CommandText = sql;

        // Con una transacción manual abierta, leer el catálogo va dentro de ella
        // como todo lo demás que pase por esta conexión.
        command.Transaction = (SqliteTransaction?)sqlite.Transaction.Current;

        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = $"${name}";
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
            throw new DatabaseOperationException(SqliteErrorNormalizer.Normalize(exception));
        }
    }
}
