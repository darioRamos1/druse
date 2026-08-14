using System.Data.Common;
using System.Text;
using Druse.Database.Abstractions;
using Druse.Domain;
using IBM.Data.Db2;

namespace Druse.Provider.Informix;

/// <summary>
/// Lee el catálogo de Informix.
///
/// Informix no tiene `information_schema`: su catálogo son las tablas `sys*` de
/// cada base — `systables`, `syscolumns`, `sysindexes`, `sysconstraints`—, y el
/// tipo de una columna no viene escrito sino codificado en un número (ver
/// <see cref="InformixTypeNames"/>).
///
/// **El «esquema» de Informix es el propietario de la tabla.** No es un objeto
/// que se cree aparte como en PostgreSQL: cada tabla pertenece a un usuario, y
/// ese usuario hace de esquema al calificarla. El árbol conserva los dos niveles
/// para comportarse igual que en los otros motores.
/// </summary>
public sealed class InformixMetadataReader : IDatabaseMetadataReader
{
    /// <summary>
    /// Las tablas del sistema ocupan los primeros identificadores de cada base.
    ///
    /// Es la convención de Informix: `tabid` por debajo de 100 son las tablas del
    /// catálogo. Filtrar por nombre sería frágil, porque un usuario puede llamar
    /// a la suya `sysalgo` sin que sea del sistema.
    /// </summary>
    private const string UserTables = "t.tabid >= 100";

    public DatabaseEngine Engine => DatabaseEngine.Informix;

    public async Task<IReadOnlyList<DatabaseObject>> GetDatabasesAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        // La lista de bases vive en `sysmaster`, que es otra base: leerla exige un
        // permiso que un usuario de aplicación puede no tener. Si lo rechaza, se
        // devuelve al menos la base conectada, para que el explorador siga
        // sirviendo en lugar de quedarse vacío por un listado informativo. Es la
        // misma lección que dejó la DMV de recuento de filas en SQL Server.
        const string Sql = """
            SELECT name
            FROM sysmaster:sysdatabases
            ORDER BY name
            """;

        try
        {
            return await QueryAsync(session, Sql, reader => new DatabaseObject
            {
                Id = $"db:{reader.GetString(0)}",
                Name = reader.GetString(0),
                Kind = DatabaseObjectKind.Database,
                Database = reader.GetString(0),
                HasChildren = true,
            }, cancellationToken);
        }
        catch (DatabaseOperationException)
        {
            var current = session.Profile.Database;

            return
            [
                new DatabaseObject
                {
                    Id = $"db:{current}",
                    Name = current,
                    Kind = DatabaseObjectKind.Database,
                    Database = current,
                    HasChildren = true,
                },
            ];
        }
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
            DatabaseObjectKind.Table or DatabaseObjectKind.View =>
                await GetColumnsAsObjectsAsync(session, parent, cancellationToken),
            _ => [],
        };
    }

    public async Task<IReadOnlyList<DatabaseColumn>> GetColumnsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(table);

        // `default` de una columna vive en `sysdefaults`, con el valor en `default`
        // y una letra en `type` que dice de qué clase es. Se toma solo el literal,
        // que es lo que el diseñador puede volver a escribir.
        const string Sql = """
            SELECT
                c.colname,
                c.coltype,
                c.collength,
                c.colno,
                d.type,
                d.default
            FROM syscolumns c
            JOIN systables t ON t.tabid = c.tabid
            LEFT JOIN sysdefaults d ON d.tabid = c.tabid AND d.colno = c.colno
            WHERE t.tabname = ? AND t.owner = ?
            ORDER BY c.colno
            """;

        var columns = await QueryAsync(
            session,
            Sql,
            reader =>
            {
                var coltype = reader.GetInt32(1);
                var collength = reader.GetInt32(2);

                return new DatabaseColumn
                {
                    Name = reader.GetString(0),
                    DataType = InformixTypeNames.Format(coltype, collength),
                    IsNullable = InformixTypeNames.IsNullable(coltype),
                    // La clave primaria no está en syscolumns: se rellena después.
                    IsPrimaryKey = false,
                    IsGenerated = InformixTypeNames.IsSerial(coltype),
                    DefaultValue = reader.IsDBNull(5) ? null : reader.GetString(5).Trim(),
                    Ordinal = reader.GetInt16(3),
                };
            },
            cancellationToken,
            table.Name,
            Owner(session, table));

        var key = await GetPrimaryKeyColumnsAsync(session, table, cancellationToken);

        return key.Count == 0
            ? columns
            : [.. columns.Select(column => key.Contains(column.Name)
                ? column with { IsPrimaryKey = true }
                : column)];
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

        var indexes = await GetIndexesAsync(session, table, cancellationToken);
        var (primary, unique, foreignKeys, checks) =
            await GetConstraintsAsync(session, table, cancellationToken);

        return new TableStructure
        {
            PrimaryKey = primary,
            // Un índice queda marcado como sostenido por una restricción si su
            // nombre aparece entre los índices que respaldan las restricciones.
            Indexes =
            [
                .. indexes.Select(index => index with
                {
                    IsPrimaryKey = primary is not null && index.Name == primary.Name,
                    IsConstraintIndex =
                        (primary is not null && index.Name == primary.Name)
                        || unique.Any(constraint => constraint.Name == index.Name),
                }),
            ],
            ForeignKeys = foreignKeys,
            UniqueConstraints = unique,
            CheckConstraints = checks,
        };
    }

    /// <summary>
    /// Índices con sus columnas en orden.
    ///
    /// `sysindexes` guarda hasta dieciséis columnas en campos numerados —`part1` a
    /// `part16`— con el número de columna en cada uno, y **el signo indica el
    /// sentido**: negativo es descendente. No es una lista que se pueda unir con
    /// `syscolumns` de una vez, así que se traen las partes y se resuelven contra
    /// los nombres ya leídos.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseIndex>> GetIndexesAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT
                i.idxname,
                i.idxtype,
                i.part1, i.part2, i.part3, i.part4, i.part5, i.part6, i.part7, i.part8,
                i.part9, i.part10, i.part11, i.part12, i.part13, i.part14, i.part15, i.part16
            FROM sysindexes i
            JOIN systables t ON t.tabid = i.tabid
            WHERE t.tabname = ? AND t.owner = ?
            ORDER BY i.idxname
            """;

        var names = await GetColumnNumbersAsync(session, table, cancellationToken);

        return await QueryAsync(
            session,
            Sql,
            reader =>
            {
                var columns = new List<IndexColumn>();

                for (var part = 0; part < 16; part++)
                {
                    var position = reader.GetInt16(2 + part);

                    if (position == 0)
                    {
                        break;
                    }

                    var number = Math.Abs((int)position);

                    if (!names.TryGetValue(number, out var name))
                    {
                        continue;
                    }

                    columns.Add(new IndexColumn
                    {
                        Name = name,
                        Direction = position < 0
                            ? IndexSortDirection.Descending
                            : IndexSortDirection.Ascending,
                    });
                }

                return new DatabaseIndex
                {
                    Name = reader.GetString(0),
                    // `idxtype` es 'U' para único y 'D' para admitir duplicados.
                    IsUnique = reader.GetString(1).Trim().StartsWith('U'),
                    Columns = columns,
                };
            },
            cancellationToken,
            table.Name,
            Owner(session, table));
    }

    /// <summary>
    /// Restricciones de la tabla, todas en una lectura.
    ///
    /// `sysconstraints` las guarda juntas y las distingue por `constrtype`: 'P'
    /// primaria, 'U' unicidad, 'R' referencial y 'C' comprobación. Cada una apunta
    /// a un índice cuyas columnas son las de la restricción.
    /// </summary>
    private static async Task<(
        DatabasePrimaryKey? Primary,
        IReadOnlyList<DatabaseUniqueConstraint> Unique,
        IReadOnlyList<DatabaseForeignKey> ForeignKeys,
        IReadOnlyList<DatabaseCheckConstraint> Checks)>
        GetConstraintsAsync(
            IDatabaseSession session,
            DatabaseObject table,
            CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT
                c.constrname,
                c.constrtype,
                c.idxname,
                c.constrid,
                pt.tabname,
                pt.owner,
                r.delrule
            FROM sysconstraints c
            JOIN systables t ON t.tabid = c.tabid
            LEFT JOIN sysreferences r ON r.constrid = c.constrid
            LEFT JOIN systables pt ON pt.tabid = r.ptabid
            WHERE t.tabname = ? AND t.owner = ?
            ORDER BY c.constrname
            """;

        var rows = await QueryAsync(
            session,
            Sql,
            reader => (
                Name: reader.GetString(0).Trim(),
                Type: reader.GetString(1).Trim(),
                IndexName: reader.IsDBNull(2) ? null : reader.GetString(2).Trim(),
                ConstraintId: reader.GetInt32(3),
                ReferencedTable: reader.IsDBNull(4) ? null : reader.GetString(4).Trim(),
                ReferencedOwner: reader.IsDBNull(5) ? null : reader.GetString(5).Trim(),
                DeleteRule: reader.IsDBNull(6) ? null : reader.GetString(6).Trim()),
            cancellationToken,
            table.Name,
            Owner(session, table));

        var indexes = await GetIndexesAsync(session, table, cancellationToken);
        var byIndex = indexes.ToDictionary(index => index.Name, StringComparer.OrdinalIgnoreCase);

        IReadOnlyList<string> ColumnsOf(string? indexName) =>
            indexName is not null && byIndex.TryGetValue(indexName, out var index)
                ? [.. index.Columns.Select(column => column.Name)]
                : [];

        var primaryRow = rows.FirstOrDefault(row => row.Type == "P");

        var primary = primaryRow.Name is null
            ? null
            : new DatabasePrimaryKey
            {
                // El nombre que se enseña es el del índice que la sostiene, que es
                // el que hay que nombrar para soltarla.
                Name = primaryRow.IndexName ?? primaryRow.Name,
                Columns = ColumnsOf(primaryRow.IndexName),
            };

        var unique = rows
            .Where(row => row.Type == "U")
            .Select(row => new DatabaseUniqueConstraint
            {
                Name = row.IndexName ?? row.Name,
                Columns = ColumnsOf(row.IndexName),
            })
            .ToList();

        var foreignKeys = rows
            .Where(row => row.Type == "R" && row.ReferencedTable is not null)
            .Select(row => new DatabaseForeignKey
            {
                Name = row.Name,
                Columns = ColumnsOf(row.IndexName),
                ReferencedSchema = row.ReferencedOwner,
                ReferencedTable = row.ReferencedTable!,
                // Las columnas referenciadas son la clave primaria de la otra
                // tabla; leerlas exigiría otra consulta por cada clave foránea, y
                // la conexión no admite dos a la vez. Se dejan vacías: quien las
                // necesite abre esa tabla, que es un clic en el mismo árbol.
                ReferencedColumns = [],
                OnDelete = row.DeleteRule == "C"
                    ? ForeignKeyAction.Cascade
                    : ForeignKeyAction.NoAction,
            })
            .ToList();

        var checks = new List<DatabaseCheckConstraint>();

        foreach (var row in rows.Where(row => row.Type == "C"))
        {
            checks.Add(new DatabaseCheckConstraint
            {
                Name = row.Name,
                Expression = await GetCheckTextAsync(session, row.ConstraintId, cancellationToken),
            });
        }

        return (primary, unique, foreignKeys, checks);
    }

    /// <summary>
    /// El texto de una condición, que Informix guarda troceado.
    ///
    /// `syschecks` parte la expresión en filas de 32 caracteres numeradas por
    /// `seqno`, y guarda dos versiones: la compilada (`type = 'B'`) y la que
    /// escribió el usuario (`type = 'T'`). Se toma la segunda, que es la única
    /// legible.
    /// </summary>
    private static async Task<string> GetCheckTextAsync(
        IDatabaseSession session,
        int constraintId,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT checktext
            FROM syschecks
            WHERE constrid = ? AND type = 'T'
            ORDER BY seqno
            """;

        var parts = await QueryAsync(
            session,
            Sql,
            reader => reader.GetString(0),
            cancellationToken,
            constraintId);

        var text = new StringBuilder();

        foreach (var part in parts)
        {
            text.Append(part);
        }

        return text.ToString().Trim();
    }

    private static async Task<IReadOnlyList<string>> GetPrimaryKeyColumnsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        var (primary, _, _, _) = await GetConstraintsAsync(session, table, cancellationToken);

        return primary?.Columns ?? [];
    }

    /// <summary>Número de columna a nombre, para resolver las partes de un índice.</summary>
    private static async Task<Dictionary<int, string>> GetColumnNumbersAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT c.colno, c.colname
            FROM syscolumns c
            JOIN systables t ON t.tabid = c.tabid
            WHERE t.tabname = ? AND t.owner = ?
            """;

        var rows = await QueryAsync(
            session,
            Sql,
            reader => (Number: (int)reader.GetInt16(0), Name: reader.GetString(1).Trim()),
            cancellationToken,
            table.Name,
            Owner(session, table));

        return rows.ToDictionary(row => row.Number, row => row.Name);
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetSchemasAsync(
        IDatabaseSession session,
        DatabaseObject database,
        CancellationToken cancellationToken)
    {
        // En Informix el propietario de la tabla hace de esquema, así que la lista
        // de esquemas es la de propietarios que tienen algo.
        var sql = $"""
            SELECT DISTINCT t.owner
            FROM systables t
            WHERE {UserTables}
            ORDER BY t.owner
            """;

        return await QueryAsync(session, sql, reader => new DatabaseObject
        {
            Id = $"schema:{reader.GetString(0).Trim()}",
            Name = reader.GetString(0).Trim(),
            Kind = DatabaseObjectKind.Schema,
            Database = database.Database ?? database.Name,
            Schema = reader.GetString(0).Trim(),
            HasChildren = true,
        }, cancellationToken);
    }

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

    private static Task<IReadOnlyList<DatabaseObject>> GetFolderContentAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        CancellationToken cancellationToken)
    {
        var kind = folder.Id.Split(':').Last();

        return kind switch
        {
            "tables" => GetRelationsAsync(session, folder, 'T', DatabaseObjectKind.Table, cancellationToken),
            "views" => GetRelationsAsync(session, folder, 'V', DatabaseObjectKind.View, cancellationToken),
            "functions" => GetRoutinesAsync(session, folder, isProcedure: false, cancellationToken),
            "procedures" => GetRoutinesAsync(session, folder, isProcedure: true, cancellationToken),
            _ => Task.FromResult<IReadOnlyList<DatabaseObject>>([]),
        };
    }

    /// <summary>
    /// Tablas o vistas de un esquema.
    ///
    /// `nrows` es el recuento que dejó el último `UPDATE STATISTICS`: puede estar
    /// muy desfasado y por eso se ofrece como aproximado, igual que en los otros
    /// motores.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetRelationsAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        char tabtype,
        DatabaseObjectKind kind,
        CancellationToken cancellationToken)
    {
        var sql = $"""
            SELECT t.tabname, t.nrows
            FROM systables t
            WHERE t.owner = ? AND t.tabtype = ? AND {UserTables}
            ORDER BY t.tabname
            """;

        return await QueryAsync(
            session,
            sql,
            reader => new DatabaseObject
            {
                Id = $"{kind}:{folder.Schema}.{reader.GetString(0).Trim()}",
                Name = reader.GetString(0).Trim(),
                Kind = kind,
                Database = folder.Database,
                Schema = folder.Schema,
                HasChildren = true,
                ApproximateRowCount = reader.IsDBNull(1) ? null : (long)reader.GetFloat(1),
            },
            cancellationToken,
            folder.Schema ?? string.Empty,
            tabtype.ToString());
    }

    /// <summary>
    /// Funciones y procedimientos.
    ///
    /// Informix los guarda juntos en `sysprocedures` y los separa con `isproc`,
    /// que es 't' para un procedimiento y 'f' para una función.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseObject>> GetRoutinesAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        bool isProcedure,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT p.procname
            FROM sysprocedures p
            WHERE p.owner = ? AND p.isproc = ?
            ORDER BY p.procname
            """;

        var kind = isProcedure ? DatabaseObjectKind.Procedure : DatabaseObjectKind.Function;

        return await QueryAsync(
            session,
            Sql,
            reader => new DatabaseObject
            {
                Id = $"{kind}:{folder.Schema}.{reader.GetString(0).Trim()}",
                Name = reader.GetString(0).Trim(),
                Kind = kind,
                Database = folder.Database,
                Schema = folder.Schema,
                HasChildren = false,
            },
            cancellationToken,
            folder.Schema ?? string.Empty,
            isProcedure ? "t" : "f");
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetColumnsAsObjectsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        var reader = new InformixMetadataReader();
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
    /// El texto de una vista, que Informix también guarda troceado.
    ///
    /// `sysviews` parte la definición en filas de 64 caracteres numeradas por
    /// `seqno`. Unirlas en orden es lo único que hay que hacer: lo que devuelve ya
    /// es el `CREATE VIEW` completo.
    /// </summary>
    private static async Task<string> GetViewDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject view,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(view);

        const string Sql = """
            SELECT v.viewtext
            FROM sysviews v
            JOIN systables t ON t.tabid = v.tabid
            WHERE t.tabname = ? AND t.owner = ?
            ORDER BY v.seqno
            """;

        var parts = await QueryAsync(
            session,
            Sql,
            reader => reader.GetString(0),
            cancellationToken,
            view.Name,
            Owner(session, view));

        if (parts.Count == 0)
        {
            throw new DatabaseOperationException(new QueryError
            {
                Message = $"No se encontró la definición de la vista «{view.Name}».",
            });
        }

        return string.Concat(parts).Trim();
    }

    /// <summary>
    /// El cuerpo de un procedimiento.
    ///
    /// `sysprocbody` guarda varias representaciones y `datakey` dice cuál: 'T' es
    /// el texto que escribió el usuario. Las demás son formas compiladas que no
    /// sirven para leer.
    /// </summary>
    private static async Task<string> GetProcedureDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject procedure,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(procedure);

        const string Sql = """
            SELECT b.data
            FROM sysprocbody b
            JOIN sysprocedures p ON p.procid = b.procid
            WHERE p.procname = ? AND p.owner = ? AND b.datakey = 'T'
            ORDER BY b.seqno
            """;

        var parts = await QueryAsync(
            session,
            Sql,
            reader => reader.GetString(0),
            cancellationToken,
            procedure.Name,
            Owner(session, procedure));

        if (parts.Count == 0)
        {
            throw new DatabaseOperationException(new QueryError
            {
                Message = $"No se encontró el cuerpo de «{procedure.Name}». " +
                          "Puede estar compilado sin conservar su texto.",
            });
        }

        return string.Concat(parts).Trim();
    }

    /// <summary>
    /// Propietario al que pertenece un nodo, que es lo que Informix usa de esquema.
    ///
    /// Si el nodo no lo trae, se usa el usuario de la conexión: es el propietario
    /// con el que se crea todo lo que no se califica.
    /// </summary>
    private static string Owner(IDatabaseSession session, DatabaseObject node) =>
        node.Schema ?? session.Profile.Username;

    /// <summary>
    /// Ejecuta una consulta de catálogo y proyecta cada fila.
    ///
    /// Los valores van como parámetros posicionales: el proveedor de IBM usa `?`
    /// en lugar de parámetros con nombre, así que el orden de los argumentos es el
    /// orden en que aparecen en el SQL.
    /// </summary>
    private static async Task<IReadOnlyList<T>> QueryAsync<T>(
        IDatabaseSession session,
        string sql,
        Func<DbDataReader, T> project,
        CancellationToken cancellationToken,
        params object[] parameters)
    {
        if (session is not InformixSession informix)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor Informix.",
                nameof(session));
        }

        await using var command = informix.Connection.CreateCommand();
        command.CommandText = sql;

        foreach (var value in parameters)
        {
            var parameter = command.CreateParameter();
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
            throw new DatabaseOperationException(InformixErrorNormalizer.Normalize(exception));
        }
    }
}
