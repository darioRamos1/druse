using System.Data.Common;
using System.Globalization;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.Sqlite;

/// <summary>DDL de SQLite. Solo aporta su dialecto… y su reconstrucción.</summary>
public sealed class SqliteTableDesigner : TableDesignerBase
{
    public override DatabaseEngine Engine => DatabaseEngine.Sqlite;

    /// <summary>
    /// Los tipos que se ofrecen son los **nombres**, no los tipos.
    ///
    /// En SQLite lo que se declara no obliga a nada: una columna `INTEGER` acepta
    /// el texto `hola` y lo guarda tal cual. Lo que el nombre decide es la
    /// *afinidad*: hacia dónde intenta convertir el motor lo que se le da. Los de
    /// aquí abajo son los cinco que cubren las cinco afinidades, más los alias que
    /// todo el mundo escribe porque vienen de otros motores.
    /// </summary>
    public override IReadOnlyList<string> CommonDataTypes =>
    [
        "INTEGER", "REAL", "NUMERIC", "TEXT", "BLOB",
        "VARCHAR(255)", "DECIMAL(18,2)", "BOOLEAN",
        "DATE", "DATETIME",
    ];

    /// <summary>
    /// Adónde va cada familia, sabiendo que aquí nada se comprueba.
    ///
    /// Las fechas van a `TEXT` y no a `DATE` a propósito: SQLite trata `DATE`
    /// como afinidad numérica, así que un `2026-08-11` guardado ahí se queda como
    /// texto igualmente pero con un nombre que promete otra cosa. En `TEXT` se
    /// ordena bien, se compara bien y se lee igual que se escribió, que es todo
    /// lo que se puede pedir.
    ///
    /// El booleano va a `INTEGER`, que es lo que SQLite usa: `TRUE` y `FALSE` son
    /// literalmente 1 y 0.
    /// </summary>
    public override string TypeFor(TypeFacets facets) => facets.Family switch
    {
        ColumnFamily.Integral => "INTEGER",
        ColumnFamily.Boolean => "INTEGER",
        ColumnFamily.Fractional => facets.Precision is { } precision
            ? $"NUMERIC({precision},{facets.Scale ?? 0})"
            : "REAL",
        ColumnFamily.Binary => "BLOB",
        // Todo lo demás —texto, fechas, horas, marcas de tiempo, identificadores
        // únicos y JSON— se guarda como texto, que es lo único que lo devuelve
        // igual que entró.
        _ => "TEXT",
    };

    /// <summary>
    /// SQLite tiene índices parciales —los inventó antes que MySQL— pero no
    /// columnas incluidas ni estructuras que elegir: todos son árboles B.
    ///
    /// **Las condiciones de comprobación no se ofrecen**, y no porque el motor no
    /// las admita: las admite. Es que no las devuelve. No hay `PRAGMA` que las
    /// enseñe y lo único que queda es el `CREATE TABLE` original en texto, así que
    /// una condición escrita desde el diseñador se guardaría y desaparecería de la
    /// pantalla al releer la tabla. Ofrecer un campo que se traga lo que se
    /// escribe es peor que no tenerlo.
    /// </summary>
    public override IndexCapabilities IndexCapabilities => new()
    {
        SupportsIncludedColumns = false,
        SupportsFilter = true,
        SupportsSortDirection = true,
        SupportsCheckConstraints = false,
        Methods = [],
        ForeignKeyActions =
        [
            ForeignKeyAction.NoAction,
            ForeignKeyAction.Cascade,
            ForeignKeyAction.SetNull,
            ForeignKeyAction.SetDefault,
        ],
    };

    /// <summary>
    /// Aquí el respaldo se lee dentro de una transacción normal y basta.
    ///
    /// SQLite en modo WAL da lecturas consistentes a quien lee: la transacción ve
    /// el archivo como estaba al empezar y no bloquea a quien escriba. No hay
    /// nivel que pedir ni opción que encender.
    ///
    /// Y **no hay esquemas que crear**: el archivo es la base.
    /// </summary>
    public override ScripterCapabilities Capabilities { get; } = new()
    {
        Isolation = BackupIsolation.RepeatableRead,
        SupportsSchemas = false,
    };

    /// <summary>
    /// **El DDL sí se deshace.** Es de los pocos motores donde un `CREATE TABLE` a
    /// medias vuelve atrás con la transacción, y por eso la reconstrucción de una
    /// tabla —que son seis instrucciones— es segura: o se hacen todas o ninguna.
    /// </summary>
    public override bool SupportsTransactionalDdl => true;

    /// <summary>Comillas dobles. Citar aquí no cambia la caja, al revés que en Oracle.</summary>
    protected override string Quote(string identifier) =>
        $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    protected override string BinaryLiteral(byte[] value)
    {
        ArgumentNullException.ThrowIfNull(value);

        return $"X'{Convert.ToHexString(value)}'";
    }

    /// <summary>No hay booleano: `TRUE` y `FALSE` son 1 y 0.</summary>
    protected override string BooleanLiteral(bool value) => value ? "1" : "0";

    protected override QueryError Normalize(Exception exception) =>
        SqliteErrorNormalizer.Normalize(exception);

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is SqliteSession sqlite
            ? sqlite.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor SQLite.",
                nameof(session));

    /// <summary>
    /// El autoincremento de SQLite **no se escribe**: es lo que hace una columna
    /// `INTEGER PRIMARY KEY` por ser un alias del `rowid`.
    ///
    /// La palabra `AUTOINCREMENT` existe, pero hace otra cosa: obliga al motor a
    /// no reutilizar nunca un número ya usado, a costa de una tabla más y de una
    /// escritura por fila. Casi nadie la necesita y quien la escribe suele creer
    /// que sin ella no hay autoincremento.
    /// </summary>
    protected override string IdentityClause(TableColumnDefinition column) => string.Empty;

    /// <summary>
    /// El nombre de la tabla, sin base ni esquema delante.
    ///
    /// Los dos niveles que el árbol enseña son sintéticos: aquí solo hay un
    /// archivo. Calificar produciría `"main"."main"."clientes"`, que no es nada.
    /// </summary>
    protected override string Qualify(string? database, string? schema, string name) =>
        Quote(name);

    /// <summary>No hay esquemas que crear: el archivo es la base.</summary>
    public override IReadOnlyList<string> ScriptSchema(string schema) => [];

    protected override string RenameTable(
        string qualifiedTable,
        DatabaseObject table,
        string newName) =>
        $"ALTER TABLE {qualifiedTable} RENAME TO {Quote(newName)};";

    /// <summary>
    /// El índice tiene nombre propio dentro de la base y **no se nombra la
    /// tabla** al borrarlo.
    /// </summary>
    protected override string DropIndex(
        string qualifiedTable,
        DatabaseObject table,
        string indexName) =>
        $"DROP INDEX IF EXISTS {Quote(indexName)};";

    /// <summary>No hay `USING`: todos los índices son árboles B.</summary>
    protected override string IndexMethodClause(IndexDefinition index) => string.Empty;

    /// <summary>
    /// Cambiar una columna es **reconstruir la tabla**, así que aquí no hay
    /// instrucción que escribir.
    ///
    /// Nunca se llega: <see cref="DescribeAlterAsync"/> desvía a la reconstrucción
    /// cualquier cambio que SQLite no sepa hacer de una pieza. Si alguien llamara
    /// a la versión sin sesión, esto lo dice en vez de escribir un `ALTER` que el
    /// motor rechazaría.
    /// </summary>
    protected override IReadOnlyList<string> AlterColumn(
        string qualifiedTable,
        ColumnAlteration change)
    {
        ArgumentNullException.ThrowIfNull(change);

        // Renombrar sí sabe, y es lo único.
        if (change.IsRename && !TocaLaForma(change))
        {
            return
            [
                $"ALTER TABLE {qualifiedTable} RENAME COLUMN {Quote(change.CurrentName)} " +
                $"TO {Quote(change.Column.Name)};",
            ];
        }

        throw new NotSupportedException(
            "SQLite no puede cambiar el tipo, la nulabilidad ni el valor por omisión de una " +
            "columna con un ALTER TABLE: hay que reconstruir la tabla. Usa la versión que " +
            "recibe la sesión.");
    }

    /// <summary>
    /// Soltar una restricción tampoco existe aquí. Igual que arriba: se desvía
    /// antes de llegar.
    /// </summary>
    protected override string DropConstraint(
        string qualifiedTable,
        string name,
        ConstraintKind kind) =>
        throw new NotSupportedException(
            "SQLite no puede soltar una restricción con un ALTER TABLE: hay que reconstruir " +
            "la tabla.");

    // -----------------------------------------------------------------------
    // La reconstrucción
    // -----------------------------------------------------------------------

    /// <summary>
    /// Las instrucciones del cambio, reconstruyendo la tabla cuando hace falta.
    ///
    /// **`ALTER TABLE` en SQLite hace cuatro cosas y ninguna más**: renombrar la
    /// tabla, renombrar una columna, añadir una y quitarla. Cambiarle el tipo a
    /// una columna, tocar la clave primaria, añadir una restricción o quitarla no
    /// están, y no es un descuido: la tabla se guarda como el texto de su
    /// `CREATE`, y cambiar ese texto es escribir otra tabla.
    ///
    /// Así que eso es lo que se hace, y es el procedimiento que documenta el
    /// propio SQLite:
    ///
    /// 1. Crear una tabla nueva con la forma que se quiere, con un nombre que no
    ///    choque.
    /// 2. Copiar en ella las columnas que sobreviven, **por nombre**.
    /// 3. Borrar la vieja.
    /// 4. Ponerle a la nueva el nombre de la vieja.
    /// 5. Volver a crear sus índices, que se fueron con la tabla.
    ///
    /// Va entero dentro de una transacción —aquí el DDL sí se deshace— así que o
    /// se hace todo o no se hace nada.
    ///
    /// **Lo que esto no conserva**, y hay que saberlo: los disparadores y las
    /// vistas que apuntaban a la tabla se van con ella. SQLite tampoco avisa. Se
    /// deja escrito aquí y en el plan porque recuperarlos exigiría leerlos y
    /// volver a escribirlos, y hacerlo a medias sería peor.
    /// </summary>
    public override async Task<IReadOnlyList<string>> DescribeAlterAsync(
        IDatabaseSession session,
        TableAlteration alteration,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(alteration);

        if (!NecesitaReconstruir(alteration))
        {
            return DescribeAlter(alteration);
        }

        var reader = new SqliteMetadataReader();
        var columnas = await reader.GetColumnsAsync(session, alteration.Table, cancellationToken);
        var estructura = await reader.GetTableStructureAsync(
            session,
            alteration.Table,
            cancellationToken);

        return Rebuild(alteration, columnas, estructura);
    }

    /// <summary>
    /// Si el cambio pide algo que `ALTER TABLE` no sabe hacer.
    ///
    /// Renombrar la tabla, añadir columnas, quitarlas, renombrarlas y tocar
    /// índices sí se pueden de una pieza, y se prefieren: reconstruir copia la
    /// tabla entera, y en una de un millón de filas eso se nota.
    /// </summary>
    private static bool NecesitaReconstruir(TableAlteration alteration) =>
        alteration.AlteredColumns.Any(TocaLaForma)
        || alteration.NewPrimaryKey is not null
        || alteration.DroppedPrimaryKeyName is not null
        || alteration.AddedUniqueConstraints.Count > 0
        || alteration.DroppedUniqueConstraints.Count > 0
        || alteration.AddedCheckConstraints.Count > 0
        || alteration.DroppedCheckConstraints.Count > 0
        || alteration.AddedForeignKeys.Count > 0
        || alteration.DroppedForeignKeys.Count > 0;

    /// <summary>
    /// Si el cambio de una columna toca algo más que su nombre.
    ///
    /// Renombrar es lo único que SQLite hace sin reconstruir. Todo lo demás —el
    /// tipo, si admite nulos, su valor por omisión— vive dentro del texto del
    /// `CREATE TABLE`.
    /// </summary>
    private static bool TocaLaForma(ColumnAlteration change) =>
        change.Column.DataType.Length > 0 || !change.Column.IsNullable
            || change.Column.DefaultValue is not null;

    /// <summary>
    /// Las seis instrucciones de la reconstrucción.
    ///
    /// La tabla nueva se llama como la vieja con un sufijo que nadie escribiría a
    /// mano. Si algo fallara a mitad, la transacción lo deshace y ese nombre no
    /// llega a quedarse.
    /// </summary>
    private List<string> Rebuild(
        TableAlteration alteration,
        IReadOnlyList<DatabaseColumn> current,
        TableStructure structure)
    {
        var original = alteration.Table.Name;
        var temporal = $"{original}_druse_nueva";

        var columnas = Resultantes(alteration, current);

        var definicion = new TableDefinition
        {
            Name = temporal,
            Columns = columnas.Nuevas,
            PrimaryKey = ClavePrimaria(alteration, structure, columnas.Nuevas),
            UniqueConstraints = Unicas(alteration, structure),
            CheckConstraints = alteration.AddedCheckConstraints,
            ForeignKeys = Foraneas(alteration, structure),
            // Los índices se crean después, ya con el nombre definitivo: creados
            // aquí se llamarían igual que los que la tabla vieja todavía tiene.
            Indexes = [],
        };

        var statements = new List<string>(DescribeCreate(definicion));

        // La copia va **por nombre y en el mismo orden en las dos listas**, que es
        // lo que impide que un cambio de orden mueva los datos de una columna a
        // otra. Las columnas nuevas no se nombran: se quedan con su valor por
        // omisión.
        var destino = string.Join(", ", columnas.Copiadas.Select(par => Quote(par.Nueva)));
        var origen = string.Join(", ", columnas.Copiadas.Select(par => Quote(par.Vieja)));

        if (columnas.Copiadas.Count > 0)
        {
            statements.Add(
                $"INSERT INTO {Quote(temporal)} ({destino}) SELECT {origen} FROM {Quote(original)};");
        }

        statements.Add($"DROP TABLE {Quote(original)};");

        var definitivo = alteration.NewName ?? original;

        statements.Add($"ALTER TABLE {Quote(temporal)} RENAME TO {Quote(definitivo)};");

        // Los índices se fueron con la tabla vieja. Se rehacen los que había,
        // menos los que el cambio pedía borrar, y se añaden los que pedía crear.
        var destinoObjeto = alteration.Table with { Name = definitivo };
        var borrados = new HashSet<string>(
            alteration.DroppedIndexes.Concat(
                alteration.AlteredIndexes.Select(change => change.CurrentName)),
            StringComparer.OrdinalIgnoreCase);

        foreach (var index in structure.Indexes)
        {
            // Los que sostienen una restricción los vuelve a crear el propio
            // `CREATE TABLE`, y volver a escribirlos sería un nombre repetido.
            if (index.IsConstraintIndex || borrados.Contains(index.Name))
            {
                continue;
            }

            statements.Add(Recrear(index, definitivo));
        }

        foreach (var index in alteration.AddedIndexes)
        {
            statements.Add(CreateIndex(Quote(definitivo), destinoObjeto, index));
        }

        foreach (var change in alteration.AlteredIndexes)
        {
            statements.Add(CreateIndex(Quote(definitivo), destinoObjeto, change.Index));
        }

        return statements;
    }

    /// <summary>
    /// Vuelve a escribir un índice que ya existía.
    ///
    /// Se prefiere **su propio `CREATE INDEX`**, que SQLite guarda literal: es lo
    /// único que reproduce un índice sobre una expresión o con una condición, que
    /// desde la lista de columnas no se pueden escribir. Solo se cambia el nombre
    /// de la tabla si además se renombró.
    /// </summary>
    private string Recrear(DatabaseIndex index, string table)
    {
        if (index.Definition is { Length: > 0 } definition)
        {
            return definition.TrimEnd().TrimEnd(';') + ";";
        }

        var columnas = string.Join(
            ", ",
            index.Columns.Select(column => column.Direction == IndexSortDirection.Descending
                ? $"{Quote(column.Name)} DESC"
                : Quote(column.Name)));

        var unico = index.IsUnique ? "UNIQUE " : string.Empty;

        return $"CREATE {unico}INDEX {Quote(index.Name)} ON {Quote(table)} ({columnas});";
    }

    /// <summary>Cómo quedan las columnas y cuáles se copian de la tabla vieja.</summary>
    private static (IReadOnlyList<TableColumnDefinition> Nuevas,
        IReadOnlyList<(string Vieja, string Nueva)> Copiadas) Resultantes(
        TableAlteration alteration,
        IReadOnlyList<DatabaseColumn> current)
    {
        var cambiadas = alteration.AlteredColumns.ToDictionary(
            change => change.CurrentName,
            change => change.Column,
            StringComparer.OrdinalIgnoreCase);

        var borradas = new HashSet<string>(alteration.DroppedColumns, StringComparer.OrdinalIgnoreCase);

        var nuevas = new List<TableColumnDefinition>();
        var copiadas = new List<(string, string)>();

        foreach (var column in current.OrderBy(column => column.Ordinal))
        {
            if (borradas.Contains(column.Name))
            {
                continue;
            }

            if (cambiadas.TryGetValue(column.Name, out var cambio))
            {
                nuevas.Add(cambio);
                copiadas.Add((column.Name, cambio.Name));
                continue;
            }

            // Las que no cambian se vuelven a declarar como estaban. El tipo, la
            // nulabilidad y el valor por omisión salen del catálogo, que es lo que
            // el motor tiene de verdad.
            nuevas.Add(new TableColumnDefinition
            {
                Name = column.Name,
                DataType = column.DataType,
                IsNullable = column.IsNullable,
                DefaultValue = column.DefaultValue,
                // La clave primaria se declara aparte, no en la columna: una
                // compuesta no cabe en la columna y así las dos formas se
                // escriben igual.
                IsPrimaryKey = false,
            });

            copiadas.Add((column.Name, column.Name));
        }

        foreach (var añadida in alteration.AddedColumns)
        {
            nuevas.Add(añadida);
        }

        return (nuevas, copiadas);
    }

    /// <summary>
    /// La clave primaria que queda: la nueva si el cambio trae una, ninguna si
    /// pedía quitarla, y la de antes si no se toca.
    /// </summary>
    private static PrimaryKeyDefinition? ClavePrimaria(
        TableAlteration alteration,
        TableStructure structure,
        IReadOnlyList<TableColumnDefinition> columnas)
    {
        if (alteration.NewPrimaryKey is { Columns.Count: > 0 } nueva)
        {
            return nueva;
        }

        if (alteration.DroppedPrimaryKeyName is not null)
        {
            return null;
        }

        if (structure.PrimaryKey is not { Columns.Count: > 0 } vieja)
        {
            return null;
        }

        // Una clave sobre una columna que el cambio borró se va con ella: dejarla
        // escrita produciría un `CREATE TABLE` que el motor rechaza.
        var presentes = vieja.Columns
            .Where(column => columnas.Any(nuevaColumna =>
                string.Equals(nuevaColumna.Name, column, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        return presentes.Count == vieja.Columns.Count
            ? new PrimaryKeyDefinition { Name = null, Columns = presentes }
            : null;
    }

    /// <summary>Las restricciones de unicidad que quedan, con las que se añaden.</summary>
    private static IReadOnlyList<UniqueConstraintDefinition> Unicas(
        TableAlteration alteration,
        TableStructure structure)
    {
        var borradas = new HashSet<string>(
            alteration.DroppedUniqueConstraints,
            StringComparer.OrdinalIgnoreCase);

        return
        [
            .. structure.UniqueConstraints
                .Where(unique => !borradas.Contains(unique.Name))
                .Select(unique => new UniqueConstraintDefinition
                {
                    Name = unique.Name,
                    Columns = unique.Columns,
                }),
            .. alteration.AddedUniqueConstraints,
        ];
    }

    /// <summary>Las claves foráneas que quedan, con las que se añaden.</summary>
    private static IReadOnlyList<ForeignKeyDefinition> Foraneas(
        TableAlteration alteration,
        TableStructure structure)
    {
        var borradas = new HashSet<string>(
            alteration.DroppedForeignKeys,
            StringComparer.OrdinalIgnoreCase);

        return
        [
            .. structure.ForeignKeys
                .Where(key => !borradas.Contains(key.Name))
                .Select(key => new ForeignKeyDefinition
                {
                    Name = key.Name,
                    Columns = key.Columns,
                    ReferencedTable = key.ReferencedTable,
                    ReferencedColumns = key.ReferencedColumns,
                    OnDelete = key.OnDelete,
                    OnUpdate = key.OnUpdate,
                }),
            .. alteration.AddedForeignKeys,
        ];
    }
}
