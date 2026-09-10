using System.Collections.ObjectModel;
using System.Data.Common;
using System.Globalization;
using Druse.Database.Abstractions;
using Druse.Domain;
using Oracle.ManagedDataAccess.Client;
using static Druse.Database.Abstractions.MetadataBatch;

namespace Druse.Provider.Oracle;

/// <summary>
/// Lee el catálogo de Oracle.
///
/// **Aquí no hay varias bases.** Una conexión apunta a un servicio y dentro solo
/// hay esquemas, que en Oracle *son* usuarios: crear un esquema es crear un
/// usuario, y el dueño de una tabla es el esquema al que pertenece. Es la misma
/// situación que en MySQL al revés —allí la base es el esquema— y se resuelve
/// igual: el primer nivel del árbol enseña los esquemas como si fueran bases, y
/// debajo cuelga uno del mismo nombre. Así el explorador se comporta igual en los
/// cinco motores y las carpetas siempre cuelgan de un esquema; la alternativa
/// —un árbol distinto solo para Oracle— obligaría a ramificar por motor en la
/// interfaz, que es justo lo que el plan §13 prohíbe.
///
/// Se leen las vistas `ALL_*` y no las `DBA_*`: las primeras enseñan lo que el
/// usuario conectado puede ver, y las segundas exigen un permiso que casi nadie
/// tiene. Un explorador que solo funcione siendo administrador no sirve.
/// </summary>
public sealed class OracleMetadataReader : IDatabaseMetadataReader
{
    public DatabaseEngine Engine => DatabaseEngine.Oracle;

    /// <summary>
    /// Esquemas que mantiene el propio motor.
    ///
    /// `ORACLE_MAINTAINED` lo marca el catálogo desde 12.1 y es mucho mejor que
    /// una lista escrita a mano: una instalación de serie trae más de treinta
    /// esquemas del sistema y cada versión añade los suyos.
    /// </summary>
    private const string UserFilter = "u.ORACLE_MAINTAINED = 'N'";

    public async Task<IReadOnlyList<DatabaseObject>> GetDatabasesAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        var sql = $"""
            SELECT u.USERNAME
            FROM ALL_USERS u
            WHERE {UserFilter}
            ORDER BY u.USERNAME
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

        return columns.TryGetValue(Key(session, table), out var found) ? found : [];
    }

    /// <summary>Columnas de varias tablas a la vez.</summary>
    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseColumn>>> GetColumnsAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        if (tables.Count == 0)
        {
            return ReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseColumn>>.Empty;
        }

        var (pairs, parameters) = Wanted(session, tables);

        // `DATA_DEFAULT` es de tipo LONG, que hay que pedir entero antes de leer;
        // de eso se encarga `QueryAsync`.
        //
        // La clave primaria no está en `ALL_TAB_COLUMNS`: se cruza con las dos
        // vistas de restricciones, que es donde Oracle la guarda.
        var sql = $"""
            SELECT
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.CHAR_LENGTH,
                c.CHAR_USED,
                c.DATA_LENGTH,
                c.DATA_PRECISION,
                c.DATA_SCALE,
                c.NULLABLE,
                c.DATA_DEFAULT,
                c.COLUMN_ID,
                c.IDENTITY_COLUMN,
                c.VIRTUAL_COLUMN,
                CASE WHEN p.COLUMN_NAME IS NULL THEN 'N' ELSE 'Y' END AS es_clave,
                c.OWNER,
                c.TABLE_NAME
            FROM ALL_TAB_COLS c
            LEFT JOIN (
                SELECT cc.OWNER, cc.TABLE_NAME, cc.COLUMN_NAME
                FROM ALL_CONSTRAINTS k
                JOIN ALL_CONS_COLUMNS cc
                  ON cc.OWNER = k.OWNER AND cc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                WHERE k.CONSTRAINT_TYPE = 'P'
            ) p
              ON p.OWNER = c.OWNER AND p.TABLE_NAME = c.TABLE_NAME
             AND p.COLUMN_NAME = c.COLUMN_NAME
            WHERE (c.OWNER, c.TABLE_NAME) IN ({pairs})
              AND c.HIDDEN_COLUMN = 'NO'
            ORDER BY c.OWNER, c.TABLE_NAME, c.COLUMN_ID
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (
                Owner: Owner(reader, 13),
                Column: new DatabaseColumn
                {
                    Name = reader.GetString(0),
                    DataType = OracleTypeNames.Compose(new OracleTypeNames.RawType(
                        reader.GetString(1),
                        Int(reader, 2),
                        reader.IsDBNull(3) ? null : reader.GetString(3),
                        Int(reader, 5),
                        Int(reader, 6),
                        Int(reader, 4))),
                    // Se declara como texto 'Y'/'N', no como booleano.
                    IsNullable = reader.GetString(7) == "Y",
                    // El valor por omisión llega con los espacios con los que se
                    // escribió; se recortan porque nadie quiere ver `'x'   `.
                    DefaultValue = reader.IsDBNull(8) ? null : reader.GetString(8).Trim(),
                    Ordinal = Int(reader, 9) ?? 0,
                    // Identidad o columna calculada: las dos las rellena el motor
                    // y en las dos escribir es un error.
                    IsGenerated = reader.GetString(10) == "YES" || reader.GetString(11) == "YES",
                    IsPrimaryKey = reader.GetString(12) == "Y",
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
            DatabaseObjectKind.View =>
                GetViewDefinitionAsync(session, databaseObject, cancellationToken),
            DatabaseObjectKind.Procedure or DatabaseObjectKind.Function =>
                GetSourceAsync(session, databaseObject, cancellationToken),
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

        return structures.TryGetValue(Key(session, table), out var found)
            ? found
            : new TableStructure();
    }

    /// <summary>
    /// Columnas y estructura de varias tablas **en cuatro consultas**, sean dos
    /// tablas o sesenta.
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

        return Compose(tables, table => Key(session, table), columns, structures);
    }

    /// <summary>Estructura de varias tablas, en tres consultas.</summary>
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
        var checks = await GetCheckConstraintsAsync(session, tables, cancellationToken);

        var wanted = Unique(tables, table => Key(session, table));
        var result = new Dictionary<TableRef, TableStructure>();

        foreach (var table in wanted)
        {
            var tableIndexes = indexes.TryGetValue(table, out var found) ? found : [];
            var primary = tableIndexes.FirstOrDefault(index => index.IsPrimaryKey);

            result[table] = new TableStructure
            {
                PrimaryKey = primary is null
                    ? null
                    : new DatabasePrimaryKey
                    {
                        Name = primary.Name,
                        Columns = [.. primary.Columns.Select(column => column.Name)],
                    },
                Indexes = tableIndexes,
                ForeignKeys = foreignKeys.TryGetValue(table, out var keys) ? keys : [],
                UniqueConstraints = UniqueConstraints(tableIndexes),
                CheckConstraints = checks.TryGetValue(table, out var found2) ? found2 : [],
            };
        }

        return result;
    }

    /// <summary>
    /// Índices de varias tablas, con el nombre de la restricción que los sostiene
    /// cuando la hay.
    ///
    /// En Oracle una clave primaria **es** un índice y comparten nombre, así que
    /// las dos cosas salen de la misma consulta. `ALL_IND_EXPRESSIONS` aporta la
    /// expresión de los índices funcionales, donde la columna del catálogo es un
    /// nombre generado —`SYS_NC00007$`— que no sirve para nada.
    /// </summary>
    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseIndex>>> GetIndexesAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        var (pairs, parameters) = Wanted(session, tables);

        var sql = $"""
            SELECT
                i.INDEX_NAME,
                i.UNIQUENESS,
                i.INDEX_TYPE,
                c.COLUMN_NAME,
                c.DESCEND,
                e.COLUMN_EXPRESSION,
                NVL(k.CONSTRAINT_TYPE, ' ') AS tipo_restriccion,
                i.TABLE_OWNER,
                i.TABLE_NAME
            FROM ALL_INDEXES i
            JOIN ALL_IND_COLUMNS c
              ON c.INDEX_OWNER = i.OWNER AND c.INDEX_NAME = i.INDEX_NAME
            LEFT JOIN ALL_IND_EXPRESSIONS e
              ON e.INDEX_OWNER = i.OWNER AND e.INDEX_NAME = i.INDEX_NAME
             AND e.COLUMN_POSITION = c.COLUMN_POSITION
            LEFT JOIN ALL_CONSTRAINTS k
              ON k.OWNER = i.OWNER AND k.CONSTRAINT_NAME = i.INDEX_NAME
             AND k.CONSTRAINT_TYPE IN ('P', 'U')
            WHERE (i.TABLE_OWNER, i.TABLE_NAME) IN ({pairs})
            ORDER BY i.TABLE_OWNER, i.TABLE_NAME, i.INDEX_NAME, c.COLUMN_POSITION
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (
                Owner: Owner(reader, 7),
                Name: reader.GetString(0),
                Unique: reader.GetString(1) == "UNIQUE",
                Type: reader.GetString(2),
                // En un índice funcional se prefiere la expresión al nombre
                // generado que Oracle inventa para la columna oculta.
                Column: reader.IsDBNull(5)
                    ? reader.GetString(3)
                    : Unquote(reader.GetString(5)),
                Descending: reader.GetString(4) == "DESC",
                Constraint: reader.GetString(6)),
            cancellationToken,
            parameters);

        var grouped = new Dictionary<TableRef, List<DatabaseIndex>>();

        foreach (var (owner, byIndex) in rows
            .GroupBy(row => row.Owner)
            .Select(group => (group.Key, group.GroupBy(row => row.Name))))
        {
            var list = new List<DatabaseIndex>();

            foreach (var index in byIndex)
            {
                var first = index.First();

                list.Add(new DatabaseIndex
                {
                    Name = index.Key,
                    Columns =
                    [
                        .. index.Select(row => new IndexColumn
                        {
                            Name = row.Column,
                            Direction = row.Descending
                                ? IndexSortDirection.Descending
                                : IndexSortDirection.Ascending,
                        }),
                    ],
                    IsUnique = first.Unique,
                    IsPrimaryKey = first.Constraint == "P",
                    IsConstraintIndex = first.Constraint is "P" or "U",
                    // `NORMAL` es el B-tree de siempre y no aporta nada escrito;
                    // los demás —`BITMAP`, `FUNCTION-BASED NORMAL`— sí.
                    Method = first.Type == "NORMAL" ? null : first.Type,
                });
            }

            grouped[owner] = list;
        }

        return grouped.ToDictionary(
            pair => pair.Key,
            pair => (IReadOnlyList<DatabaseIndex>)pair.Value);
    }

    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseForeignKey>>> GetForeignKeysAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        var (pairs, parameters) = Wanted(session, tables);

        // Oracle no guarda a qué tabla apunta una clave foránea: guarda **a qué
        // restricción** apunta, y hay que volver a saltar al catálogo para saber
        // de quién es esa restricción. De ahí las dos uniones con la misma vista.
        //
        // Y no tiene `ON UPDATE`: cambiar una clave referenciada simplemente se
        // rechaza. Por eso solo se lee la regla de borrado.
        var sql = $"""
            SELECT
                k.CONSTRAINT_NAME,
                c.COLUMN_NAME,
                r.OWNER AS ref_owner,
                r.TABLE_NAME AS ref_table,
                rc.COLUMN_NAME AS ref_column,
                k.DELETE_RULE,
                k.OWNER,
                k.TABLE_NAME
            FROM ALL_CONSTRAINTS k
            JOIN ALL_CONS_COLUMNS c
              ON c.OWNER = k.OWNER AND c.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            JOIN ALL_CONSTRAINTS r
              ON r.OWNER = k.R_OWNER AND r.CONSTRAINT_NAME = k.R_CONSTRAINT_NAME
            JOIN ALL_CONS_COLUMNS rc
              ON rc.OWNER = r.OWNER AND rc.CONSTRAINT_NAME = r.CONSTRAINT_NAME
             AND rc.POSITION = c.POSITION
            WHERE k.CONSTRAINT_TYPE = 'R'
              AND (k.OWNER, k.TABLE_NAME) IN ({pairs})
            ORDER BY k.OWNER, k.TABLE_NAME, k.CONSTRAINT_NAME, c.POSITION
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (
                Owner: Owner(reader, 6),
                Name: reader.GetString(0),
                Column: reader.GetString(1),
                RefSchema: reader.GetString(2),
                RefTable: reader.GetString(3),
                RefColumn: reader.GetString(4),
                Delete: reader.IsDBNull(5) ? "NO ACTION" : reader.GetString(5)),
            cancellationToken,
            parameters);

        var grouped = new Dictionary<TableRef, List<DatabaseForeignKey>>();

        foreach (var group in rows.GroupBy(row => (row.Owner, row.Name)))
        {
            var first = group.First();

            if (!grouped.TryGetValue(first.Owner, out var list))
            {
                list = [];
                grouped[first.Owner] = list;
            }

            list.Add(new DatabaseForeignKey
            {
                Name = first.Name,
                Columns = [.. group.Select(row => row.Column)],
                ReferencedSchema = first.RefSchema,
                ReferencedTable = first.RefTable,
                ReferencedColumns = [.. group.Select(row => row.RefColumn)],
                OnDelete = ParseAction(first.Delete),
                OnUpdate = ForeignKeyAction.NoAction,
            });
        }

        return grouped.ToDictionary(
            pair => pair.Key,
            pair => (IReadOnlyList<DatabaseForeignKey>)pair.Value);
    }

    /// <summary>
    /// Las restricciones de unicidad salen de los índices que las sostienen.
    ///
    /// Es lo mismo que hacen los otros proveedores, y en Oracle además es
    /// literal: la restricción y su índice comparten nombre.
    /// </summary>
    private static IReadOnlyList<DatabaseUniqueConstraint> UniqueConstraints(
        IReadOnlyList<DatabaseIndex> indexes) =>
    [
        .. indexes
            .Where(index => index.IsConstraintIndex && !index.IsPrimaryKey)
            .Select(index => new DatabaseUniqueConstraint
            {
                Name = index.Name,
                Columns = [.. index.Columns.Select(column => column.Name)],
            }),
    ];

    /// <summary>
    /// Condiciones de comprobación, **sin las que Oracle se inventa**.
    ///
    /// Cada columna obligatoria produce una restricción `"COL" IS NOT NULL` que
    /// nadie escribió y que no debe salir en la lista: enseñarlas llenaría la
    /// pantalla de ruido y el guionizado las repetiría al reproducir la tabla,
    /// donde ya están dichas con el `NOT NULL` de la columna.
    /// </summary>
    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseCheckConstraint>>> GetCheckConstraintsAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        var (pairs, parameters) = Wanted(session, tables);

        // `SEARCH_CONDITION` es LONG; `SEARCH_CONDITION_VC` es la misma en
        // `VARCHAR2` y existe desde 12.1, que es la versión mínima que se
        // soporta. Se usa la segunda porque se puede filtrar en SQL.
        var sql = $"""
            SELECT
                k.CONSTRAINT_NAME,
                k.SEARCH_CONDITION_VC,
                k.OWNER,
                k.TABLE_NAME
            FROM ALL_CONSTRAINTS k
            WHERE k.CONSTRAINT_TYPE = 'C'
              AND k.GENERATED = 'USER NAME'
              AND (k.OWNER, k.TABLE_NAME) IN ({pairs})
              AND k.SEARCH_CONDITION_VC NOT LIKE '%IS NOT NULL'
            ORDER BY k.OWNER, k.TABLE_NAME, k.CONSTRAINT_NAME
            """;

        var rows = await QueryAsync(
            session,
            sql,
            reader => (
                Owner: Owner(reader, 2),
                Check: new DatabaseCheckConstraint
                {
                    Name = reader.GetString(0),
                    Expression = reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                }),
            cancellationToken,
            parameters);

        return GroupByTable(rows);
    }

    /// <summary>Oracle solo admite dos reglas de borrado, y ninguna de cambio.</summary>
    private static ForeignKeyAction ParseAction(string rule) => rule switch
    {
        "CASCADE" => ForeignKeyAction.Cascade,
        "SET NULL" => ForeignKeyAction.SetNull,
        _ => ForeignKeyAction.NoAction,
    };

    /// <summary>
    /// El `SELECT` de una vista, tal y como lo guardó el motor.
    ///
    /// Se antepone el `CREATE OR REPLACE VIEW` porque `ALL_VIEWS` guarda solo el
    /// cuerpo, y lo que se enseña tiene que poder ejecutarse tal cual.
    /// </summary>
    private static async Task<string> GetViewDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject view,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT v.TEXT
            FROM ALL_VIEWS v
            WHERE v.OWNER = :owner AND v.VIEW_NAME = :name
            """;

        var rows = await QueryAsync(
            session,
            Sql,
            reader => reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
            cancellationToken,
            ("owner", Schema(session, view)),
            ("name", view.Name));

        var body = rows.Count > 0 ? rows[0] : string.Empty;

        return string.IsNullOrWhiteSpace(body)
            ? string.Empty
            : $"CREATE OR REPLACE VIEW {Quote(Schema(session, view))}.{Quote(view.Name)} AS\n{body.Trim()}";
    }

    /// <summary>
    /// El código de un procedimiento o una función.
    ///
    /// `ALL_SOURCE` lo guarda **partido en líneas**, una fila por línea, así que
    /// hay que volver a juntarlo en orden. Y lo guarda sin el `CREATE`: empieza
    /// directamente por `PROCEDURE …`, que no se puede ejecutar tal cual, así que
    /// se le antepone lo que falta.
    /// </summary>
    private static async Task<string> GetSourceAsync(
        IDatabaseSession session,
        DatabaseObject routine,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT s.TEXT
            FROM ALL_SOURCE s
            WHERE s.OWNER = :owner AND s.NAME = :name AND s.TYPE = :type
            ORDER BY s.LINE
            """;

        var lines = await QueryAsync(
            session,
            Sql,
            reader => reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
            cancellationToken,
            ("owner", Schema(session, routine)),
            ("name", routine.Name),
            ("type", routine.Kind == DatabaseObjectKind.Function ? "FUNCTION" : "PROCEDURE"));

        if (lines.Count == 0)
        {
            return string.Empty;
        }

        var body = string.Concat<string>(lines).TrimEnd();

        return body.StartsWith("CREATE", StringComparison.OrdinalIgnoreCase)
            ? body
            : $"CREATE OR REPLACE {body}";
    }

    /// <summary>
    /// Los parámetros de una rutina, leídos del catálogo y no del código.
    ///
    /// `POSITION = 0` no es un parámetro: es **lo que devuelve la función**, y
    /// Oracle lo guarda en la misma lista. Confundirlo con un parámetro más
    /// escribiría una llamada con un argumento de sobra.
    ///
    /// Se filtra por `PACKAGE_NAME IS NULL` porque `ALL_ARGUMENTS` mezcla las
    /// rutinas sueltas con las de dentro de un paquete, y el árbol de Druse
    /// todavía no tiene un nivel para los paquetes.
    /// </summary>
    public async Task<RoutineSignature> GetRoutineSignatureAsync(
        IDatabaseSession session,
        DatabaseObject routine,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(routine);

        const string Sql = """
            SELECT
                NVL(a.ARGUMENT_NAME, ' ') AS nombre,
                a.DATA_TYPE,
                a.IN_OUT,
                a.POSITION,
                a.DEFAULTED
            FROM ALL_ARGUMENTS a
            WHERE a.OWNER = :owner
              AND a.OBJECT_NAME = :name
              AND a.PACKAGE_NAME IS NULL
              AND a.DATA_LEVEL = 0
            ORDER BY a.POSITION
            """;

        var rows = await QueryAsync(
            session,
            Sql,
            reader => (
                Name: reader.GetString(0).Trim(),
                Type: reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                InOut: reader.IsDBNull(2) ? "IN" : reader.GetString(2),
                Position: Int(reader, 3) ?? 0,
                Defaulted: !reader.IsDBNull(4) && reader.GetString(4) == "Y"),
            cancellationToken,
            ("owner", Schema(session, routine)),
            ("name", routine.Name));

        var isFunction = routine.Kind == DatabaseObjectKind.Function
            || rows.Any(row => row.Position == 0);

        return new RoutineSignature
        {
            Name = routine.Name,
            Schema = Schema(session, routine),
            IsFunction = isFunction,
            ReturnType = rows.FirstOrDefault(row => row.Position == 0).Type,
            Parameters =
            [
                .. rows
                    .Where(row => row.Position > 0)
                    .Select(row => new RoutineParameter
                    {
                        Name = row.Name,
                        DataType = row.Type,
                        Direction = row.InOut switch
                        {
                            "OUT" => RoutineParameterDirection.Output,
                            "IN/OUT" => RoutineParameterDirection.InputOutput,
                            _ => RoutineParameterDirection.Input,
                        },
                        Ordinal = row.Position,
                        HasDefault = row.Defaulted,
                    }),
            ],
        };
    }

    // -----------------------------------------------------------------------
    // El árbol
    // -----------------------------------------------------------------------

    /// <summary>
    /// El único esquema de una «base» de Oracle: ella misma.
    ///
    /// No se consulta el catálogo porque no hay nada que consultar. Ver la nota
    /// de la clase sobre por qué el nivel se conserva.
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
            "functions" => await GetRoutinesAsync(
                session, folder, "FUNCTION", DatabaseObjectKind.Function, cancellationToken),
            "procedures" => await GetRoutinesAsync(
                session, folder, "PROCEDURE", DatabaseObjectKind.Procedure, cancellationToken),
            _ => [],
        };
    }

    /// <summary>
    /// Tablas del esquema con su recuento aproximado.
    ///
    /// `NUM_ROWS` es lo que dejaron las últimas estadísticas, no un recuento de
    /// ahora: en una tabla que nadie ha analizado viene vacío, y en una que
    /// creció desde entonces se queda corto. Igual que `reltuples` en PostgreSQL,
    /// se prefiere a un `COUNT(*)` por tabla, que dejaría inservible el
    /// explorador en una base grande.
    ///
    /// Se dejan fuera las tablas de la papelera —las que empiezan por `BIN$`—,
    /// que son las que alguien borró y Oracle guarda por si acaso.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetTablesAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT t.TABLE_NAME, t.NUM_ROWS
            FROM ALL_TABLES t
            WHERE t.OWNER = :owner
              AND t.TABLE_NAME NOT LIKE 'BIN$%'
              AND t.NESTED = 'NO'
              AND (t.IOT_TYPE IS NULL OR t.IOT_TYPE = 'IOT')
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
                ApproximateRowCount = reader.IsDBNull(1) ? null : (long?)reader.GetDecimal(1),
            },
            cancellationToken,
            ("owner", Schema(session, folder)));
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetViewsAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT v.VIEW_NAME
            FROM ALL_VIEWS v
            WHERE v.OWNER = :owner
            ORDER BY v.VIEW_NAME
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
            ("owner", Schema(session, folder)));
    }

    /// <summary>
    /// Procedimientos y funciones sueltos.
    ///
    /// Los que viven dentro de un paquete no salen: el árbol no tiene todavía un
    /// nivel para paquetes, y colgarlos del esquema como si fueran sueltos
    /// produciría nombres que no se pueden llamar tal cual.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetRoutinesAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        string objectType,
        DatabaseObjectKind kind,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT o.OBJECT_NAME
            FROM ALL_OBJECTS o
            WHERE o.OWNER = :owner
              AND o.OBJECT_TYPE = :type
              AND o.OBJECT_NAME NOT LIKE 'BIN$%'
            ORDER BY o.OBJECT_NAME
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
            ("owner", Schema(session, folder)),
            ("type", objectType));
    }

    /// <summary>Columnas presentadas como nodos, para el explorador.</summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetColumnsAsObjectsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        var reader = new OracleMetadataReader();
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
    /// Esquema al que apunta un nodo.
    ///
    /// Si no lo trae, se usa el del usuario conectado, que es el equivalente al
    /// `public` de PostgreSQL: el sitio donde caen las tablas que se crean sin
    /// nombrar dueño.
    /// </summary>
    private static string Schema(IDatabaseSession session, DatabaseObject node) =>
        node.Schema
            ?? node.Database
            ?? (session as OracleSession)?.CurrentSchema
            ?? string.Empty;

    /// <summary>
    /// Las tablas pedidas como lista de pares para un <c>IN</c> de tuplas.
    ///
    /// Oracle sabe comparar `(OWNER, TABLE_NAME) IN ((…), (…))`. Se interpolan
    /// **solo nombres de parámetro**; ningún identificador entra en el texto de
    /// la consulta.
    /// </summary>
    private static (string Pairs, (string Name, object Value)[] Parameters) Wanted(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables)
    {
        var wanted = Unique(tables, table => Key(session, table));
        var pairs = new System.Text.StringBuilder();
        var parameters = new (string Name, object Value)[wanted.Count * 2];

        for (var index = 0; index < wanted.Count; index++)
        {
            if (index > 0)
            {
                pairs.Append(", ");
            }

            pairs.Append(CultureInfo.InvariantCulture, $"(:s{index}, :n{index})");

            parameters[index * 2] = ($"s{index}", wanted[index].Schema ?? string.Empty);
            parameters[(index * 2) + 1] = ($"n{index}", wanted[index].Name);
        }

        return (pairs.ToString(), parameters);
    }

    /// <summary>
    /// La tabla a la que pertenece la fila que se está leyendo. Las dos columnas
    /// van al final de cada consulta para no descolocar lo que ya se leía.
    /// </summary>
    private static TableRef Owner(DbDataReader reader, int index) =>
        new(reader.GetString(index), reader.GetString(index + 1));

    /// <summary>Clave con la que se busca una tabla en lo leído.</summary>
    private static TableRef Key(IDatabaseSession session, DatabaseObject table) =>
        new(Schema(session, table), table.Name);

    /// <summary>
    /// Un entero del catálogo.
    ///
    /// Oracle no tiene enteros: todo número es `NUMBER`, y ODP.NET lo entrega
    /// como `decimal`. Leerlo con `GetInt32` funciona a veces y falla otras según
    /// lo que el catálogo tenga guardado, así que se convierte siempre.
    /// </summary>
    private static int? Int(DbDataReader reader, int index) =>
        reader.IsDBNull(index) ? null : (int)reader.GetDecimal(index);

    /// <summary>
    /// El nombre de una columna cuando la expresión de un índice no es más que
    /// eso.
    ///
    /// **Un índice descendente en Oracle es un índice funcional.** No hay forma
    /// de pedir un `DESC` sin que el motor cree por detrás una columna oculta
    /// —`SYS_NC00005$`— y guarde la expresión aparte. Esa expresión es
    /// literalmente `"ID"`, con sus comillas, y devolverla así diría que la
    /// columna se llama con comillas incluidas.
    ///
    /// Solo se desnuda cuando **toda** la expresión es un nombre citado: un
    /// `LOWER("NIT")` es de verdad una expresión y tiene que llegar entera, que
    /// es de lo que se ocupa `DatabaseIndex.Definition`.
    /// </summary>
    private static string Unquote(string expression)
    {
        var trimmed = expression.Trim();

        return trimmed.Length > 2
            && trimmed[0] == '"'
            && trimmed[^1] == '"'
            && !trimmed[1..^1].Contains('"', StringComparison.Ordinal)
            ? trimmed[1..^1]
            : trimmed;
    }

    private static string Quote(string identifier) => OracleIdentifier.Quote(identifier);

    /// <summary>
    /// Ejecuta una consulta de catálogo y proyecta cada fila.
    ///
    /// Los valores siempre van como parámetros: aunque el nombre de un esquema
    /// venga del propio catálogo, concatenarlo sería crear el hábito equivocado.
    /// Los fragmentos interpolados de las consultas son constantes del código.
    ///
    /// **`BindByName` no es opcional.** ODP.NET liga los parámetros por orden a
    /// menos que se le diga lo contrario, y aquí el mismo nombre aparece varias
    /// veces en una consulta: sin esto, cada aparición consumiría un parámetro y
    /// la consulta hablaría de tablas que nadie pidió.
    /// </summary>
    private static async Task<IReadOnlyList<T>> QueryAsync<T>(
        IDatabaseSession session,
        string sql,
        Func<DbDataReader, T> project,
        CancellationToken cancellationToken,
        params (string Name, object Value)[] parameters)
    {
        if (session is not OracleSession oracle)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor Oracle.",
                nameof(session));
        }

        await using var command = oracle.Connection.CreateCommand();
        command.CommandText = sql;
        command.BindByName = true;

        // Varias columnas del catálogo son de tipo LONG —el valor por omisión de
        // una columna, el cuerpo de una vista— y ODP.NET solo trae los primeros
        // bytes salvo que se le pidan enteras. Sin esto, un valor por omisión
        // largo llegaría cortado por la mitad.
        command.InitialLONGFetchSize = -1;

        // Con una transacción manual abierta, leer el catálogo va dentro de ella
        // como todo lo demás que pase por esta conexión.
        ((DbCommand)command).Transaction = oracle.Transaction.Current;

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
            throw new DatabaseOperationException(OracleErrorNormalizer.Normalize(exception));
        }
    }
}
