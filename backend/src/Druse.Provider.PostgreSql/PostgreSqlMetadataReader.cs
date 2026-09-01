using System.Collections.ObjectModel;
using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;
using static Druse.Database.Abstractions.MetadataBatch;

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
    /// <summary>Esquema al que pertenece una tabla cuando nadie dice otro.</summary>
    private const string DefaultSchema = "public";

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
            WHERE d.datistemplate = false
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
    /// Es la misma consulta de siempre con el filtro cambiado: donde antes había
    /// un esquema y un nombre, ahora hay dos arreglos que se recorren juntos con
    /// <c>unnest</c>. Emparejar por posición es lo que permite pedir
    /// `ventas.factura` y `compras.factura` en la misma lectura sin traerse el
    /// producto cruzado de esquemas por nombres.
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
                                                    AS is_generated,
                n.nspname                            AS owner_schema,
                c.relname                            AS owner_table
            FROM pg_attribute a
            JOIN pg_class c     ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN unnest(@schemas::text[], @names::text[]) AS want(schema_name, table_name)
                ON want.schema_name = n.nspname AND want.table_name = c.relname
            LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
            LEFT JOIN LATERAL (
                SELECT true AS is_primary
                FROM pg_index i
                WHERE i.indrelid = c.oid
                  AND i.indisprimary
                  AND a.attnum = ANY (i.indkey)
                LIMIT 1
            ) pk ON true
            WHERE a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY n.nspname, c.relname, a.attnum
            """;

        var (schemas, names) = Wanted(tables);

        var rows = await QueryAsync(
            session,
            Sql,
            reader => (
                Owner: Owner(reader, 7),
                Column: new DatabaseColumn
                {
                    Name = reader.GetString(0),
                    DataType = reader.GetString(1),
                    IsNullable = reader.GetBoolean(2),
                    IsPrimaryKey = reader.GetBoolean(3),
                    DefaultValue = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Ordinal = reader.GetInt16(5),
                    IsGenerated = reader.GetBoolean(6),
                }),
            cancellationToken,
            ("schemas", schemas),
            ("names", names));

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
    /// Columnas y estructura de varias tablas en cuatro consultas, sean dos
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

        return Compose(tables, Key, columns, structures);
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
        var constraints = await GetConstraintsAsync(session, tables, cancellationToken);

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
                UniqueConstraints = constraints.Unique.TryGetValue(key, out var uniques) ? uniques : [],
                CheckConstraints = constraints.Check.TryGetValue(key, out var checks) ? checks : [],
            };
        }

        return structures;
    }

    /// <summary>
    /// Índices con sus columnas en orden.
    ///
    /// Las columnas salen de <c>pg_index.indkey</c>, que es la lista ordenada de
    /// posiciones: unirse a <c>pg_attribute</c> sin conservar ese orden daría las
    /// columnas correctas en el orden equivocado, y en un índice el orden es
    /// justamente lo que decide para qué sirve. Las primeras
    /// <c>indnkeyatts</c> son la clave y el resto es el `INCLUDE`.
    ///
    /// <c>from_constraint</c> lleva <c>COALESCE</c> porque el <c>LEFT JOIN</c>
    /// con <c>pg_constraint</c> no encuentra nada para un índice suelto, y
    /// <c>false OR NULL</c> vale <c>NULL</c>, no <c>false</c>: sin él, leer la
    /// estructura de cualquier tabla con un índice normal fallaba.
    /// </summary>
    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseIndex>>> GetIndexesAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT
                ic.relname AS index_name,
                i.indisunique,
                i.indisprimary,
                COALESCE(i.indisexclusion OR con.contype IN ('p', 'u'), false) AS from_constraint,
                am.amname,
                pg_get_expr(i.indpred, i.indrelid) AS filter,
                (
                    SELECT array_agg(a.attname ORDER BY k.ord)
                    FROM unnest(i.indkey[0:i.indnkeyatts - 1]) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                ) AS key_columns,
                (
                    SELECT array_agg(
                        CASE WHEN o.option & 1 = 1 THEN 'DESC' ELSE 'ASC' END
                        ORDER BY o.ord)
                    FROM unnest(i.indoption[0:i.indnkeyatts - 1]) WITH ORDINALITY AS o(option, ord)
                ) AS directions,
                (
                    SELECT array_agg(a.attname ORDER BY k.ord)
                    FROM unnest(i.indkey[i.indnkeyatts:array_length(i.indkey, 1) - 1]) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                ) AS included_columns,
                -- Solo para los índices con expresión: los demás se reproducen
                -- desde sus columnas, que es lo que la interfaz sabe editar.
                CASE WHEN i.indexprs IS NOT NULL
                     THEN pg_get_indexdef(i.indexrelid)
                END AS definition,
                n.nspname AS owner_schema,
                c.relname AS owner_table
            FROM pg_index i
            JOIN pg_class c      ON c.oid = i.indrelid
            JOIN pg_class ic     ON ic.oid = i.indexrelid
            JOIN pg_namespace n  ON n.oid = c.relnamespace
            JOIN pg_am am        ON am.oid = ic.relam
            JOIN unnest(@schemas::text[], @names::text[]) AS want(schema_name, table_name)
                ON want.schema_name = n.nspname AND want.table_name = c.relname
            LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
            WHERE i.indislive
            ORDER BY n.nspname, c.relname, ic.relname
            """;

        var (schemas, names) = Wanted(tables);

        var rows = await QueryAsync(
            session,
            Sql,
            reader =>
            {
                var columns = reader.IsDBNull(6) ? [] : reader.GetFieldValue<string[]>(6);
                var directions = reader.IsDBNull(7) ? [] : reader.GetFieldValue<string[]>(7);

                return (Owner: Owner(reader, 10), Index: new DatabaseIndex
                {
                    Name = reader.GetString(0),
                    IsUnique = reader.GetBoolean(1),
                    IsPrimaryKey = reader.GetBoolean(2),
                    IsConstraintIndex = reader.GetBoolean(3),
                    Method = reader.GetString(4),
                    Filter = reader.IsDBNull(5) ? null : reader.GetString(5),
                    Columns =
                    [
                        .. columns.Select((name, position) => new IndexColumn
                        {
                            Name = name,
                            Direction = position < directions.Length && directions[position] == "DESC"
                                ? IndexSortDirection.Descending
                                : IndexSortDirection.Ascending,
                        }),
                    ],
                    IncludedColumns = reader.IsDBNull(8) ? [] : reader.GetFieldValue<string[]>(8),
                    Definition = reader.IsDBNull(9) ? null : reader.GetString(9),
                });
            },
            cancellationToken,
            ("schemas", schemas),
            ("names", names));

        return GroupByTable(rows);
    }

    /// <summary>
    /// Claves foráneas con sus columnas emparejadas.
    ///
    /// <c>conkey</c> y <c>confkey</c> son dos listas que emparejan por posición,
    /// así que se recorren con <c>WITH ORDINALITY</c>: emparejarlas por nombre
    /// las descolocaría en cuanto una clave apunte a columnas de nombre distinto.
    /// </summary>
    private static async Task<IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseForeignKey>>> GetForeignKeysAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT
                con.conname,
                fn.nspname AS referenced_schema,
                fc.relname AS referenced_table,
                con.confdeltype::text,
                con.confupdtype::text,
                (
                    SELECT array_agg(a.attname ORDER BY k.ord)
                    FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
                ) AS columns,
                (
                    SELECT array_agg(a.attname ORDER BY k.ord)
                    FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
                ) AS referenced_columns,
                n.nspname AS owner_schema,
                c.relname AS owner_table
            FROM pg_constraint con
            JOIN pg_class c       ON c.oid = con.conrelid
            JOIN pg_namespace n   ON n.oid = c.relnamespace
            JOIN pg_class fc      ON fc.oid = con.confrelid
            JOIN pg_namespace fn  ON fn.oid = fc.relnamespace
            JOIN unnest(@schemas::text[], @names::text[]) AS want(schema_name, table_name)
                ON want.schema_name = n.nspname AND want.table_name = c.relname
            WHERE con.contype = 'f'
            ORDER BY n.nspname, c.relname, con.conname
            """;

        var (schemas, names) = Wanted(tables);

        var rows = await QueryAsync(
            session,
            Sql,
            reader => (Owner: Owner(reader, 7), Key: new DatabaseForeignKey
            {
                Name = reader.GetString(0),
                ReferencedSchema = reader.GetString(1),
                ReferencedTable = reader.GetString(2),
                OnDelete = ParseAction(reader.GetString(3)),
                OnUpdate = ParseAction(reader.GetString(4)),
                Columns = reader.IsDBNull(5) ? [] : reader.GetFieldValue<string[]>(5),
                ReferencedColumns = reader.IsDBNull(6) ? [] : reader.GetFieldValue<string[]>(6),
            }),
            cancellationToken,
            ("schemas", schemas),
            ("names", names));

        return GroupByTable(rows);
    }

    private static async Task<(
        IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseUniqueConstraint>> Unique,
        IReadOnlyDictionary<TableRef, IReadOnlyList<DatabaseCheckConstraint>> Check)>
        GetConstraintsAsync(
            IDatabaseSession session,
            IReadOnlyList<DatabaseObject> tables,
            CancellationToken cancellationToken)
    {
        // Las restricciones que respaldan una columna `NOT NULL` se descartan:
        // PostgreSQL las materializa como CHECK y enseñarlas llenaría la lista de
        // condiciones que el usuario no escribió y no puede quitar desde aquí.
        //
        // `contype` va con `::text` porque su tipo es el `"char"` interno de un
        // byte, y Npgsql se niega a entregarlo como cadena. Lo mismo vale para
        // `confdeltype` y `confupdtype` en las claves foráneas.
        const string Sql = """
            SELECT
                con.contype::text,
                con.conname,
                pg_get_constraintdef(con.oid) AS definition,
                (
                    SELECT array_agg(a.attname ORDER BY k.ord)
                    FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
                ) AS columns,
                n.nspname AS owner_schema,
                c.relname AS owner_table
            FROM pg_constraint con
            JOIN pg_class c     ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN unnest(@schemas::text[], @names::text[]) AS want(schema_name, table_name)
                ON want.schema_name = n.nspname AND want.table_name = c.relname
            WHERE con.contype IN ('u', 'c')
              AND NOT con.conname LIKE '%_not_null'
            ORDER BY n.nspname, c.relname, con.conname
            """;

        var (schemas, names) = Wanted(tables);

        var rows = await QueryAsync(
            session,
            Sql,
            reader => (
                Owner: Owner(reader, 4),
                Type: reader.GetString(0),
                Name: reader.GetString(1),
                Definition: reader.GetString(2),
                Columns: reader.IsDBNull(3) ? [] : reader.GetFieldValue<string[]>(3)),
            cancellationToken,
            ("schemas", schemas),
            ("names", names));

        var unique = GroupByTable(rows
            .Where(row => row.Type == "u")
            .Select(row => (row.Owner, new DatabaseUniqueConstraint { Name = row.Name, Columns = row.Columns })));

        var check = GroupByTable(rows
            .Where(row => row.Type == "c")
            .Select(row => (row.Owner, new DatabaseCheckConstraint
            {
                Name = row.Name,
                Expression = Unwrap(row.Definition),
            })));

        return (unique, check);
    }

    /// <summary>
    /// Deja la condición sin el `CHECK (…)` que la envuelve.
    ///
    /// <c>pg_get_constraintdef</c> devuelve la restricción entera y lo que se
    /// enseña —y se vuelve a escribir— es solo la expresión de dentro.
    /// </summary>
    private static string Unwrap(string definition)
    {
        const string Prefix = "CHECK (";

        if (!definition.StartsWith(Prefix, StringComparison.Ordinal) ||
            !definition.EndsWith(')'))
        {
            return definition;
        }

        return definition[Prefix.Length..^1].Trim();
    }

    /// <summary>Traduce el código de una acción referencial de PostgreSQL.</summary>
    private static ForeignKeyAction ParseAction(string code) => code switch
    {
        "c" => ForeignKeyAction.Cascade,
        "n" => ForeignKeyAction.SetNull,
        "d" => ForeignKeyAction.SetDefault,
        _ => ForeignKeyAction.NoAction,
    };

    private static async Task<string> GetViewDefinitionAsync(
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

    private static async Task<string> GetProcedureDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject procedure,
        CancellationToken cancellationToken)
    {
        var oid = RequireOid(procedure);

        const string Sql = """
            SELECT pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.oid::bigint = @oid
              AND p.prokind = 'p'
              AND n.nspname = @schema
              AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = @name
            """;

        var definitions = await QueryAsync(
            session,
            Sql,
            reader => reader.GetString(0),
            cancellationToken,
            ("oid", oid),
            ("schema", procedure.Schema ?? "public"),
            ("name", procedure.Name));

        return RequireDefinition(definitions, procedure);
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
            "procedures" => await GetProceduresAsync(session, folder, cancellationToken),
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

    /// <summary>
    /// El OID que el nodo lleva en su identificador.
    ///
    /// Solo los procedimientos se listan con OID, porque son los únicos donde una
    /// sobrecarga cambia de qué objeto se habla. Una función llega sin él y por
    /// eso no se le puede pedir ni el DDL ni la firma.
    /// </summary>
    private static long RequireOid(DatabaseObject routine)
    {
        const string IdPrefix = "Procedure:oid:";

        if (!routine.Id.StartsWith(IdPrefix, StringComparison.Ordinal)
            || !long.TryParse(routine.Id[IdPrefix.Length..], out var oid)
            || oid <= 0
            || oid > uint.MaxValue)
        {
            throw new ArgumentException(
                "El identificador del procedimiento PostgreSQL no contiene un OID válido.",
                nameof(routine));
        }

        return oid;
    }

    /// <summary>
    /// Firma de una rutina, resuelta por OID.
    ///
    /// Aquí el nombre **no identifica** nada: PostgreSQL admite sobrecargas, así
    /// que `procesar(integer)` y `procesar(text)` conviven y solo el OID que ya
    /// lleva el nodo dice de cuál se habla. Es la misma razón por la que el DDL
    /// se pide igual.
    ///
    /// Los tipos salen de `proallargtypes` cuando la rutina tiene salidas y de
    /// `proargtypes` cuando no: PostgreSQL solo rellena el primero si hay algún
    /// `OUT`, y el segundo deja fuera precisamente esos.
    /// </summary>
    public async Task<RoutineSignature> GetRoutineSignatureAsync(
        IDatabaseSession session,
        DatabaseObject routine,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(routine);

        var oid = RequireOid(routine);

        const string Sql = """
            SELECT
                COALESCE(names.name, '') AS parameter_name,
                format_type(types.type, NULL) AS data_type,
                -- `::text` por lo mismo que en los índices: `proargmodes` y
                -- `prokind` son el `"char"` interno de un byte, y Npgsql no lo
                -- entrega como cadena.
                COALESCE(modes.mode::text, 'i') AS parameter_mode,
                types.ord AS ordinal,
                p.prokind::text,
                pg_get_function_result(p.oid) AS result_type,
                p.pronargs,
                p.pronargdefaults
            FROM pg_proc p
            LEFT JOIN LATERAL unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[]))
                WITH ORDINALITY AS types(type, ord) ON true
            LEFT JOIN LATERAL unnest(p.proargnames)
                WITH ORDINALITY AS names(name, ord) ON names.ord = types.ord
            LEFT JOIN LATERAL unnest(p.proargmodes)
                WITH ORDINALITY AS modes(mode, ord) ON modes.ord = types.ord
            WHERE p.oid::bigint = @oid
            ORDER BY types.ord
            """;

        var rows = await QueryAsync(
            session,
            Sql,
            reader => new
            {
                Name = reader.GetString(0),
                DataType = reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                Mode = reader.GetString(2),
                Ordinal = reader.IsDBNull(3) ? 0 : (int)reader.GetInt64(3),
                Kind = reader.GetString(4),
                ResultType = reader.IsDBNull(5) ? null : reader.GetString(5),
                ArgumentCount = reader.GetInt16(6),
                DefaultCount = reader.GetInt16(7),
            },
            cancellationToken,
            ("oid", oid));

        if (rows.Count == 0)
        {
            throw new DatabaseOperationException(new QueryError
            {
                Message = $"No se encontró {routine.Name} o no es visible para este usuario.",
            });
        }

        var withArguments = rows.Where(row => row.Ordinal > 0).ToList();

        // Los valores por omisión se aplican a los últimos parámetros de entrada,
        // y el catálogo solo dice cuántos son. De ahí el recuento en vez de una
        // marca por parámetro.
        var firstWithDefault = rows[0].ArgumentCount - rows[0].DefaultCount;

        var parameters = withArguments
            .Select(row => new RoutineParameter
            {
                Name = row.Name,
                DataType = row.DataType,
                Direction = row.Mode switch
                {
                    "o" or "t" => RoutineParameterDirection.Output,
                    "b" => RoutineParameterDirection.InputOutput,
                    _ => RoutineParameterDirection.Input,
                },
                Ordinal = row.Ordinal,
                HasDefault = row.Mode is "i" or "b" && row.Ordinal > firstWithDefault,
            })
            .ToList();

        return new RoutineSignature
        {
            Name = routine.Name,
            Schema = routine.Schema ?? "public",
            IsFunction = rows[0].Kind is "f" or "a" or "w",
            Parameters = parameters,
            ReturnType = rows[0].Kind == "p" ? null : rows[0].ResultType,
        };
    }

    private static async Task<IReadOnlyList<DatabaseObject>> GetProceduresAsync(
        IDatabaseSession session,
        DatabaseObject folder,
        CancellationToken cancellationToken)
    {
        const string Sql = """
            SELECT
                p.oid::bigint,
                p.proname,
                pg_get_function_identity_arguments(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = @schema
              AND p.prokind = 'p'
            ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
            """;

        return await QueryAsync(
            session,
            Sql,
            reader => new DatabaseObject
            {
                Id = $"Procedure:oid:{reader.GetInt64(0)}",
                Name = $"{reader.GetString(1)}({reader.GetString(2)})",
                Kind = DatabaseObjectKind.Procedure,
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
    /// <summary>
    /// Las tablas pedidas como dos arreglos que emparejan por posición, que es
    /// lo que <c>unnest</c> sabe recorrer.
    /// </summary>
    private static (string[] Schemas, string[] Names) Wanted(IReadOnlyList<DatabaseObject> tables)
    {
        var wanted = Unique(tables, Key);

        return ([.. wanted.Select(table => table.Schema ?? DefaultSchema)], [.. wanted.Select(table => table.Name)]);
    }

    /// <summary>
    /// La tabla a la que pertenece la fila que se está leyendo.
    ///
    /// Las dos columnas van siempre al final de cada consulta, de modo que
    /// añadirlas no descoloca los índices de lo que ya se leía.
    /// </summary>
    private static TableRef Owner(DbDataReader reader, int index) =>
        new(reader.GetString(index), reader.GetString(index + 1));

    /// <summary>
    /// Clave con la que se busca una tabla en lo leído.
    ///
    /// Aplica el esquema por omisión igual que lo hace la consulta: sin esto, una
    /// tabla pedida sin esquema se buscaría como <c>(null, factura)</c> y el
    /// catálogo la habría devuelto como <c>(public, factura)</c>.
    /// </summary>
    private static TableRef Key(DatabaseObject table) => new(table.Schema ?? DefaultSchema, table.Name);

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

        // Con una transacción manual abierta, leer el catálogo va dentro de ella
        // como todo lo demás que pase por esta conexión.
        ((DbCommand)command).Transaction = postgres.Transaction.Current;

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
        DatabaseObject databaseObject)
    {
        if (definitions.Count == 1 && !string.IsNullOrWhiteSpace(definitions[0]))
        {
            return definitions[0];
        }

        throw new DatabaseOperationException(new QueryError
        {
            Message = databaseObject.Kind == DatabaseObjectKind.View
                ? $"No se pudo obtener la definición de la vista {databaseObject.Schema}.{databaseObject.Name}."
                : $"No se pudo obtener la definición del procedimiento {databaseObject.Schema}.{databaseObject.Name}.",
        });
    }
}
