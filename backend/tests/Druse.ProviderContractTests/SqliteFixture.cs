using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Sqlite;

namespace Druse.ProviderContractTests;

/// <summary>
/// Conexión y dialecto de SQLite para el contrato común.
///
/// **Es la única fixture que no necesita Docker**, y eso la convierte en la que
/// siempre corre: en cualquier máquina, en cualquier rama y en la integración
/// continua. Un archivo temporal por ejecución, que se borra al terminar.
///
/// El archivo se crea a propósito antes de nada. El proveedor **no lo crea**
/// —abrir es abrir, y una ruta mal escrita tiene que decirlo en vez de dejar una
/// base vacía en el disco— así que crearlo es cosa de quien lo quiere.
/// </summary>
public sealed class SqliteFixture : IProviderFixture
{
    private static readonly Lazy<(bool Available, string? Reason, string Path)> Archivo =
        new(Preparar);

    public string EngineName => "SQLite";

    public bool IsAvailable => Archivo.Value.Available;

    public string? UnavailableReason => Archivo.Value.Reason;

    public IDatabaseProvider Provider { get; } = new SqliteDatabaseProvider();

    public IQueryExecutor Executor { get; } = new SqliteQueryExecutor();

    public IDatabaseMetadataReader Metadata { get; } = new SqliteMetadataReader();

    public IRowEditor RowEditor { get; } = new SqliteRowEditor();

    private readonly SqliteTableDesigner _designer = new();

    public ITableDesigner Designer => _designer;

    public IDatabaseScripter Scripter => _designer;

    /// <summary>
    /// Cuatro familias, que son las cinco clases de almacenamiento de SQLite
    /// menos el nulo.
    ///
    /// **No hay fecha, ni hora, ni marca de tiempo, ni booleano.** No es que
    /// falten tipos: es que aquí un tipo no obliga a nada, y lo que se guarda en
    /// una columna `DATE` es el texto o el número que alguien puso. Declararlas
    /// diría que se pueden volver a leer como lo que eran, y no se puede.
    /// </summary>
    public IReadOnlyDictionary<ColumnFamily, string> TypesByFamily { get; } =
        new Dictionary<ColumnFamily, string>
        {
            [ColumnFamily.Text] = "TEXT",
            [ColumnFamily.Integral] = "INTEGER",
            [ColumnFamily.Fractional] = "REAL",
            [ColumnFamily.Binary] = "BLOB",
        };

    /// <summary>El archivo abierto, que SQLite siempre llama así.</summary>
    public string DatabaseName => "main";

    /// <summary>
    /// La misma: aquí no hay una segunda.
    ///
    /// La prueba que la usa se salta —ver <see cref="HasMultipleDatabases"/>— pero
    /// la propiedad tiene que contestar algo, y `main` es lo único cierto.
    /// </summary>
    public string SecondaryDatabaseName => "main";

    public string DefaultSchema => "main";

    /// <summary>
    /// No: la clave primaria de estas pruebas es de enteros, y en SQLite eso **es**
    /// el `rowid`. No hay índice aparte porque la tabla ya está ordenada por él.
    /// </summary>
    public bool PublishesPrimaryKeyIndex => false;

    /// <summary>
    /// Un archivo que no está, que es lo que aquí significa apuntar a ninguna
    /// parte: el host no se mira siquiera.
    ///
    /// Tiene que fallar, y es justo la decisión que este motor tomó: abrir no
    /// crea, así que una ruta mal escrita se dice en vez de dejar una base vacía
    /// en el disco.
    /// </summary>
    public ConnectionProfile ProfileToNowhere() =>
        PerfilPara(Path.Combine(
            Path.GetTempPath(),
            $"druse-no-existe-{Guid.NewGuid():N}.db"));

    public string DefaultSchemaFor(string database) => database;

    public ConnectionProfile Profile(bool onlyRead = false) => PerfilPara(Archivo.Value.Path, onlyRead);

    /// <summary>
    /// El perfil de un archivo concreto, sin preguntar cuál es el de la fixture.
    ///
    /// Existe por una reentrada que dejaba a este motor sin probar: la
    /// comprobación de disponibilidad **es** la fábrica de `Archivo`, y si para
    /// armar su perfil preguntaba por `Archivo.Value` se preguntaba a sí misma. El
    /// `Lazy` contesta a eso con una excepción, la comprobación la recogía como
    /// «SQLite no responde», y las cincuenta y cuatro pruebas del contrato se
    /// saltaban en silencio. Verde y sin comprobar nada, que es justo lo que
    /// `DRUSE_REQUIRE_ENGINES=1` existe para descubrir.
    /// </summary>
    private static ConnectionProfile PerfilPara(string path, bool onlyRead = false) => new()
    {
        Id = Guid.NewGuid(),
        Name = "SQLite de pruebas",
        Engine = DatabaseEngine.Sqlite,
        // Sin servidor, sin puerto y sin usuario: el motor lo declara y el
        // validador lo respeta.
        Host = string.Empty,
        Port = 0,
        Database = path,
        Username = string.Empty,
        ReadOnly = onlyRead,
        ConnectTimeoutSeconds = 5,
    };

    public ConnectionProfile ProfileForDatabase(string database, bool onlyRead = false) =>
        Profile(onlyRead) with { Id = Guid.NewGuid() };

    /// <summary>No hay contraseña que dar: el archivo se abre o no se abre.</summary>
    public DatabaseCredentials Credentials => default;

    // --- Dialecto -----------------------------------------------------------

    /// <summary>
    /// Una consulta que tarda, porque **SQLite no tiene forma de dormir**: no hay
    /// `SLEEP`, ni `pg_sleep`, ni `WAITFOR`. Se le hace contar filas de una serie
    /// recursiva, que es trabajo de verdad y se puede interrumpir.
    /// </summary>
    public string Sleep(int seconds) => $"""
        WITH RECURSIVE numeros(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM numeros WHERE n < {seconds * 20_000_000}
        )
        SELECT COUNT(*) AS lento FROM numeros
        """;

    public string GenerateRows(int count) => $"""
        WITH RECURSIVE numeros(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM numeros WHERE n < {count}
        )
        SELECT n FROM numeros
        """;

    /// <summary>
    /// **No hay mensajes del servidor.** No hay servidor: la biblioteca corre
    /// dentro del proceso y lo único que devuelve son filas y errores.
    /// </summary>
    public bool EmitsServerNotices => false;

    public string RaiseNotice(string text) => "SELECT 1";

    /// <summary>
    /// **No hay booleano.** `TRUE` existe como palabra desde la 3.23 y vale 1: lo
    /// que llega al cliente es un entero, y no hay nada que lo distinga de
    /// cualquier otro.
    /// </summary>
    public bool TransportsBooleans => false;

    /// <summary>SQLite no tiene procedimientos ni funciones almacenadas.</summary>
    public bool HasRoutines => false;

    /// <summary>El archivo es la base: no hay una segunda a la que ir.</summary>
    public bool HasMultipleDatabases => false;

    public string SelectBasicTypes =>
        "SELECT 42 AS entero, 3.5 AS decimalito, 1 AS booleano, '2026-08-11' AS fecha";

    public string SelectNullAndEmpty => "SELECT NULL AS nulo, '' AS cadena_vacia";

    public string InvalidSyntax => "SELECT FROM WHERE";

    /// <summary>1: error de SQL. SQLite tiene un solo código para todos.</summary>
    public string SyntaxErrorCode => "1";

    /// <summary>
    /// No dice dónde.
    ///
    /// Su mensaje trae la palabra que le sorprendió —«near "FROM": syntax error»—
    /// pero no la línea ni la posición, y buscar esa palabra en el texto señalaría
    /// la primera vez que aparece, que rara vez es la que falla.
    /// </summary>
    public SyntaxErrorPlace SyntaxErrorPlace => SyntaxErrorPlace.Nothing;

    /// <summary>El mismo 1: aquí una tabla que no existe también es un error de SQL.</summary>
    public string MissingTableCode => "1";

    public string ThreeResultSets => "SELECT 1 AS a; SELECT 2 AS b; SELECT 3 AS c;";

    public string CreateTable(string name) => $"CREATE TABLE \"{name}\" (id INTEGER)";

    public string DropTable(string name) => $"DROP TABLE IF EXISTS \"{name}\"";

    public string InsertThreeRows(string name) =>
        $"INSERT INTO \"{name}\" (id) VALUES (1), (2), (3)";

    public string InsertNamedRows(string name) => $"""
        INSERT INTO "{name}" (id, nombre) VALUES (1, 'Ana'), (2, 'Bea'), (3, 'Cris')
        """;

    /// <summary>
    /// `INTEGER PRIMARY KEY` **es** el autoincremento de SQLite: la columna es un
    /// alias del `rowid` y el motor la rellena si se omite.
    /// </summary>
    public string CreateTableWithColumns(string name) => $"""
        CREATE TABLE "{name}" (
            id        INTEGER PRIMARY KEY,
            nombre    TEXT NOT NULL,
            email     TEXT NULL,
            creado_en TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """;

    public string CreateView(string name) => $"CREATE VIEW \"{name}\" AS SELECT 7 AS valor";

    public string DropView(string name) => $"DROP VIEW IF EXISTS \"{name}\"";

    /// <summary>No hay procedimientos. Estas dos nunca se llaman.</summary>
    public string CreateProcedure(string name) =>
        throw new NotSupportedException("SQLite no tiene procedimientos.");

    public string CreateProcedureWithParameters(string name) =>
        throw new NotSupportedException("SQLite no tiene procedimientos.");

    public string DropProcedure(string name) =>
        throw new NotSupportedException("SQLite no tiene procedimientos.");

    /// <summary>
    /// El tipo con el que se declaró, que es lo que SQLite devuelve tal cual.
    ///
    /// No hay marca de tiempo con zona ni sin ella: hay `TEXT`, y dentro va lo que
    /// alguien escribiera.
    /// </summary>
    public string TimestampTypeName => "TEXT";

    /// <summary>
    /// Crea el archivo de pruebas y comprueba que se puede abrir.
    ///
    /// Se crea **aquí y no en el proveedor** a propósito: abrir un archivo que no
    /// está tiene que fallar, y por eso el proveedor no lo crea nunca. Quien
    /// quiere una base nueva la pide.
    /// </summary>
    private static (bool, string?, string) Preparar()
    {
        var path = Path.Combine(
            Path.GetTempPath(),
            $"druse-contrato-{Guid.NewGuid():N}.db");

        try
        {
            var fixture = new SqliteFixture();

            using (var connection = new Microsoft.Data.Sqlite.SqliteConnection(
                new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder
                {
                    DataSource = path,
                    Mode = Microsoft.Data.Sqlite.SqliteOpenMode.ReadWriteCreate,
                }.ConnectionString))
            {
                connection.Open();
            }

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));

            // Con el perfil del archivo que se acaba de crear, y no con el de la
            // fixture: pedírselo a ella sería preguntar por lo que esta misma
            // función está calculando.
            var result = fixture.Provider
                .TestConnectionAsync(
                    PerfilPara(path),
                    default,
                    timeout.Token)
                .GetAwaiter()
                .GetResult();

            return (result.Succeeded, result.Error?.Message, path);
        }
        catch (Exception exception)
        {
            return (false, exception.Message, path);
        }
    }
}

/// <summary>Ejecuta el contrato común contra SQLite.</summary>
public sealed class SqliteContractTests : DatabaseProviderContractTests<SqliteFixture>;
