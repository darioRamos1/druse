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
    /// **Las condiciones de comprobación sí se ofrecen**, y eso es nuevo. El motor
    /// siempre las admitió; lo que faltaba era poder leerlas, porque no hay
    /// `PRAGMA` que las enseñe y ofrecer un campo que se guarda y desaparece al
    /// releer la tabla habría sido peor que no tenerlo. Se sacan del `CREATE TABLE`
    /// que el motor guarda literal —ver `SqliteCheckConstraints`—, así que lo que
    /// se escribe se vuelve a ver, y lo que ya estaba **sobrevive a reconstruir la
    /// tabla** en vez de irse sin avisar.
    /// </summary>
    public override IndexCapabilities IndexCapabilities => new()
    {
        SupportsIncludedColumns = false,
        SupportsFilter = true,
        SupportsSortDirection = true,
        SupportsCheckConstraints = true,
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
    /// 5. Volver a crear sus índices y sus disparadores, que se fueron con ella.
    ///
    /// Va entero dentro de una transacción —aquí el DDL sí se deshace— así que o
    /// se hace todo o no se hace nada.
    ///
    /// **Los disparadores hay que leerlos antes de tirar la tabla**, porque el
    /// `DROP TABLE` se los lleva y después ya no queda dónde mirarlos. Se leen
    /// aquí, que es donde todavía existen, y se vuelven a escribir tal cual al
    /// final.
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

        var disparadores = await DisparadoresAsync(
            session,
            alteration.Table.Name,
            cancellationToken);

        return Rebuild(alteration, columnas, estructura, disparadores);
    }

    /// <summary>
    /// Los `CREATE TRIGGER` de la tabla, **tal como SQLite los guarda**.
    ///
    /// Se piden literales y no por partes porque un disparador es un programa: su
    /// cuerpo lleva instrucciones, puede llevar una condición y puede tocar otras
    /// tablas, y eso no se reconstruye desde un catálogo. El texto original es lo
    /// único que lo reproduce.
    ///
    /// `sql` es nulo en los objetos que el motor se crea para sí, así que esos se
    /// descartan: ejecutar un nulo rompería la reconstrucción entera.
    /// </summary>
    private async Task<IReadOnlyList<string>> DisparadoresAsync(
        IDatabaseSession session,
        string table,
        CancellationToken cancellationToken)
    {
        var connection = Connection(session);

        await using var command = connection.CreateCommand();

        command.Transaction = session.Transaction.Current;
        command.CommandText =
            "SELECT sql FROM sqlite_master " +
            "WHERE type = 'trigger' AND tbl_name = $tabla AND sql IS NOT NULL";

        var parameter = command.CreateParameter();
        parameter.ParameterName = "$tabla";
        parameter.Value = table;
        command.Parameters.Add(parameter);

        var disparadores = new List<string>();

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            disparadores.Add(reader.GetString(0));
        }

        return disparadores;
    }

    /// <summary>
    /// Deja la conexión lista para reconstruir, y apunta cómo devolverla.
    ///
    /// Lo principal que hace es **apagar las claves foráneas, fuera de la
    /// transacción**.
    ///
    /// Es el paso 1 del procedimiento que documenta SQLite, y no es una precaución
    /// teórica: con las claves foráneas encendidas, el `DROP TABLE` de la tabla
    /// vieja ejecuta un borrado implícito que **dispara las cascadas de quien la
    /// referencia**. Cambiarle el tipo a una columna de la tabla de clientes
    /// borraría todos sus pedidos, sin aviso y dentro de la misma transacción que
    /// se confirma sola.
    ///
    /// El pragma **no hace nada dentro de una transacción** —así lo documenta el
    /// motor— y ahí está el peligro: puesto entre las instrucciones del cambio se
    /// ejecutaría sin efecto y nadie lo notaría. Por eso va por este camino, antes
    /// de abrirla; y por eso, con una transacción manual del usuario ya abierta, la
    /// reconstrucción **se para** en lugar de seguir con la cascada armada.
    ///
    /// `defer_foreign_keys`, que sí se puede dentro, no sirve: retrasa la
    /// *comprobación* de las restricciones, y una cascada no es una comprobación
    /// sino una acción. Se ejecuta igual.
    ///
    /// Y lo otro que hace es **prometer que los dos ajustes vuelven a su sitio**
    /// pase lo que pase. Los pragmas no son parte de la transacción: si una
    /// instrucción de la reconstrucción falla, lo escrito se deshace pero
    /// `legacy_alter_table` se quedaría encendido en esa conexión, y el siguiente
    /// renombrado —de cualquier tabla— dejaría de arrastrar las vistas sin que
    /// nadie hubiera pedido eso.
    /// </summary>
    protected override async Task<IAsyncDisposable?> PrepareChangeAsync(
        IDatabaseSession session,
        TableAlteration? alteration,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);

        if (alteration is null || !NecesitaReconstruir(alteration))
        {
            return null;
        }

        var connection = Connection(session);
        var manual = session.Transaction.Current;
        var apagadas = false;

        if (manual is not null)
        {
            // Aquí no se pueden apagar. Si nadie referencia la tabla no hay
            // cascada que temer y el cambio sigue su camino; si alguien la
            // referencia, se dice por qué no se puede en vez de borrarle las filas.
            if (await TieneHijasAsync(connection, manual, alteration.Table.Name, cancellationToken))
            {
                throw new DatabaseOperationException(new QueryError
                {
                    Message =
                        $"Reconstruir «{alteration.Table.Name}» exige apagar las claves foráneas, " +
                        "y SQLite no deja hacerlo con una transacción abierta. Hay tablas que " +
                        "referencian a esta, y sus filas se borrarían por la cascada. Confirma o " +
                        "deshaz la transacción y vuelve a aplicar el cambio.",
                });
            }
        }
        else if (await ForeignKeysAsync(connection, cancellationToken))
        {
            await PragmaAsync(connection, "PRAGMA foreign_keys = OFF;", cancellationToken);
            apagadas = true;
        }

        // Si ya estaban apagadas no se tocan ni se encienden al salir: encenderlas
        // le cambiaría la sesión a quien la abrió así.
        return new Restaurar(connection, apagadas);
    }

    /// <summary>Si las claves foráneas están encendidas en esta conexión.</summary>
    private static async Task<bool> ForeignKeysAsync(
        DbConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();

        command.CommandText = "PRAGMA foreign_keys;";

        var value = await command.ExecuteScalarAsync(cancellationToken);

        return value is not null
            && value is not DBNull
            && Convert.ToInt64(value, CultureInfo.InvariantCulture) != 0;
    }

    /// <summary>
    /// Si alguna otra tabla la referencia.
    ///
    /// Se pregunta tabla por tabla porque SQLite **no tiene catálogo de claves
    /// foráneas**: cada una se lee con `pragma_foreign_key_list` de la tabla que la
    /// declara, así que hay que recorrerlas todas. La consulta para en la primera
    /// que aparezca, que es lo único que hace falta saber.
    ///
    /// La comparación va sin distinguir mayúsculas porque el motor tampoco las
    /// distingue al resolver el nombre de una tabla.
    /// </summary>
    private static async Task<bool> TieneHijasAsync(
        DbConnection connection,
        DbTransaction? transaction,
        string table,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();

        command.Transaction = transaction;

        // `table` es palabra reservada y va entre corchetes, que SQLite admite
        // para citar identificadores igual que las comillas dobles.
        command.CommandText =
            "SELECT 1 FROM sqlite_master AS m " +
            "JOIN pragma_foreign_key_list(m.name) AS f " +
            "WHERE m.type = 'table' AND m.name <> $tabla " +
            "AND f.[table] = $tabla COLLATE NOCASE LIMIT 1";

        var parameter = command.CreateParameter();
        parameter.ParameterName = "$tabla";
        parameter.Value = table;
        command.Parameters.Add(parameter);

        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    private static async Task PragmaAsync(
        DbConnection connection,
        string pragma,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();

        command.CommandText = pragma;

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>
    /// Devuelve la conexión a como estaba cuando el cambio termina, salga bien o
    /// salga mal.
    ///
    /// `legacy_alter_table` se apaga siempre porque siempre se encendió: lo pide
    /// la primera instrucción de la reconstrucción y lo apaga la última, pero esa
    /// última no se ejecuta si algo falla antes. Es su valor de fábrica, así que
    /// apagarlo dos veces no le quita nada a nadie.
    ///
    /// Sin cancelación a propósito: lo que restaura son ajustes de la conexión, y
    /// dejarlos a medias la devolvería al resto de la aplicación en un estado que
    /// nadie pidió. Eso es peor que esperar una instrucción más.
    /// </summary>
    private sealed class Restaurar(DbConnection connection, bool foreignKeys) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            await PragmaAsync(
                connection,
                "PRAGMA legacy_alter_table = OFF;",
                CancellationToken.None);

            if (foreignKeys)
            {
                await PragmaAsync(connection, "PRAGMA foreign_keys = ON;", CancellationToken.None);
            }
        }
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
    /// Las instrucciones de la reconstrucción.
    ///
    /// La tabla nueva se llama como la vieja con un sufijo que nadie escribiría a
    /// mano. Si algo fallara a mitad, la transacción lo deshace y ese nombre no
    /// llega a quedarse.
    ///
    /// **El orden importa, y no es el obvio.** La tabla nueva recupera siempre el
    /// nombre de la vieja, y el renombrado que pidiera el usuario va al final, como
    /// una instrucción aparte. Parece un paso de más y es justo lo contrario: los
    /// índices y los disparadores se vuelven a escribir con el texto original, que
    /// nombra la tabla de antes, así que tienen que encontrarla con ese nombre. Una
    /// vez están puestos, **el renombrado final lo hace el motor y arrastra con él
    /// las vistas y los disparadores**, que es precisamente lo que no se sabe hacer
    /// a mano sin ponerse a interpretar su texto.
    /// </summary>
    private List<string> Rebuild(
        TableAlteration alteration,
        IReadOnlyList<DatabaseColumn> current,
        TableStructure structure,
        IReadOnlyList<string> triggers)
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
            CheckConstraints = Comprobaciones(alteration, structure),
            ForeignKeys = Foraneas(alteration, structure),
            // Los índices se crean después, ya con el nombre definitivo: creados
            // aquí se llamarían igual que los que la tabla vieja todavía tiene.
            Indexes = [],
        };

        var statements = new List<string>
        {
            // **Sin esto la reconstrucción ni empieza** cuando hay una vista que
            // mira la tabla. Desde la versión 3.25 el motor valida todas las vistas
            // y disparadores de la base al renombrar una tabla, y a mitad de la
            // reconstrucción esas vistas apuntan a algo que ya se borró: el
            // renombrado falla y se cae el cambio entero. Con el modo antiguo, el
            // renombrado solo renombra, que es lo que aquí hace falta.
            //
            // Se apaga en cuanto deja de hacer falta, unas líneas más abajo: es un
            // ajuste de la conexión y no debe sobrevivir a esta operación.
            "PRAGMA legacy_alter_table = ON;",
        };

        statements.AddRange(DescribeCreate(definicion));

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
        statements.Add($"ALTER TABLE {Quote(temporal)} RENAME TO {Quote(original)};");
        statements.Add("PRAGMA legacy_alter_table = OFF;");

        // Los índices se fueron con la tabla vieja. Se rehacen los que había,
        // menos los que el cambio pedía borrar, y se añaden los que pedía crear.
        var destinoObjeto = alteration.Table;
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

            statements.Add(Recrear(index, original));
        }

        foreach (var index in alteration.AddedIndexes)
        {
            statements.Add(CreateIndex(Quote(original), destinoObjeto, index));
        }

        foreach (var change in alteration.AlteredIndexes)
        {
            statements.Add(CreateIndex(Quote(original), destinoObjeto, change.Index));
        }

        // Los disparadores, con su texto tal cual. Se ponen después de los índices
        // por ningún motivo técnico —no se estorban— y antes del renombrado por uno
        // que sí lo es: su texto nombra la tabla de antes.
        foreach (var trigger in triggers)
        {
            statements.Add(trigger.TrimEnd().TrimEnd(';') + ";");
        }

        // Y si además se pedía renombrar la tabla, ahora: aquí `legacy_alter_table`
        // ya está apagado, así que este renombrado es el bueno y el motor reescribe
        // con él las vistas y los disparadores que la nombran.
        if (alteration.NewName is { Length: > 0 } nuevo
            && !string.Equals(nuevo, original, StringComparison.Ordinal))
        {
            statements.Add($"ALTER TABLE {Quote(original)} RENAME TO {Quote(nuevo)};");
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

    /// <summary>
    /// Las condiciones de comprobación que quedan, con las que se añaden.
    ///
    /// Las que ya estaban hay que volver a escribirlas **o se pierden**: la tabla
    /// nueva solo tiene lo que se le ponga. Las que no tienen nombre se quedan sin
    /// nombre, que es como estaban; y por lo mismo, soltar una exige que lo tenga,
    /// que es cosa de quien escribió la tabla.
    /// </summary>
    private static IReadOnlyList<CheckConstraintDefinition> Comprobaciones(
        TableAlteration alteration,
        TableStructure structure)
    {
        var borradas = new HashSet<string>(
            alteration.DroppedCheckConstraints,
            StringComparer.OrdinalIgnoreCase);

        return
        [
            .. structure.CheckConstraints
                .Where(check => check.Name.Length == 0 || !borradas.Contains(check.Name))
                .Select(check => new CheckConstraintDefinition
                {
                    Name = check.Name,
                    Expression = check.Expression,
                }),
            .. alteration.AddedCheckConstraints,
        ];
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
