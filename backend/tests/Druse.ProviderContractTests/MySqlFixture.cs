using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.MySql;

namespace Druse.ProviderContractTests;

/// <summary>Conexión y dialecto de MySQL para el contrato común.</summary>
public sealed class MySqlFixture : IProviderFixture
{
    private static readonly Lazy<(bool Available, string? Reason)> Probed = new(Probe);

    public string EngineName => "MySQL";

    public bool IsAvailable => Probed.Value.Available;

    public string? UnavailableReason => Probed.Value.Reason;

    public IDatabaseProvider Provider { get; } = new MySqlDatabaseProvider();

    public IQueryExecutor Executor { get; } = new MySqlQueryExecutor();

    public IDatabaseMetadataReader Metadata { get; } = new MySqlMetadataReader();

    public IRowEditor RowEditor { get; } = new MySqlRowEditor();

    private readonly MySqlTableDesigner _designer = new();

    public ITableDesigner Designer => _designer;

    public IDatabaseScripter Scripter => _designer;

    public IReadOnlyDictionary<ColumnFamily, string> TypesByFamily { get; } =
        new Dictionary<ColumnFamily, string>
        {
            [ColumnFamily.Text] = "VARCHAR(100)",
            [ColumnFamily.Integral] = "INT",
            [ColumnFamily.Fractional] = "DECIMAL(12,2)",
            [ColumnFamily.Boolean] = "TINYINT(1)",
            [ColumnFamily.Date] = "DATE",
            [ColumnFamily.Timestamp] = "DATETIME",
            [ColumnFamily.Binary] = "VARBINARY(50)",
        };

    public string DatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_MYSQL_DB") ?? "druse_test";

    public string SecondaryDatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_MYSQL_SECOND_DB") ?? "druse_test_secondary";

    /// <summary>
    /// En MySQL, `SCHEMA` es un sinónimo de `DATABASE`: el esquema por omisión es
    /// la propia base, no un `public` ni un `dbo`.
    /// </summary>
    public string DefaultSchema => DatabaseName;

    public string DefaultSchemaFor(string database) => database;

    public ConnectionProfile Profile(bool onlyRead = false) => new()
    {
        Id = Guid.NewGuid(),
        Name = "MySQL de pruebas",
        Engine = DatabaseEngine.MySql,
        Host = Environment.GetEnvironmentVariable("DRUSE_TEST_MYSQL_HOST") ?? "127.0.0.1",
        Port = int.TryParse(Environment.GetEnvironmentVariable("DRUSE_TEST_MYSQL_PORT"), out var port)
            ? port
            : 33306,
        Database = DatabaseName,
        Username = Environment.GetEnvironmentVariable("DRUSE_TEST_MYSQL_USER") ?? "root",
        ReadOnly = onlyRead,
        ConnectTimeoutSeconds = 5,
    };

    public ConnectionProfile ProfileForDatabase(string database, bool onlyRead = false) =>
        Profile(onlyRead) with { Id = Guid.NewGuid(), Database = database };

    public DatabaseCredentials Credentials =>
        new(Environment.GetEnvironmentVariable("DRUSE_TEST_MYSQL_PASSWORD") ?? "druse_dev_only");

    // --- Dialecto -----------------------------------------------------------

    /// <summary>`SLEEP` se interrumpe con `KILL QUERY`, que es como cancela MySQL.</summary>
    public string Sleep(int seconds) => $"SELECT SLEEP({seconds})";

    /// <summary>
    /// MySQL 8 admite CTE recursivas, pero `cte_max_recursion_depth` vale 1000 por
    /// omisión: pedir muchas más filas que eso aquí abortaría la consulta.
    /// </summary>
    public string GenerateRows(int count) => $"""
        WITH RECURSIVE numeros AS (
            SELECT 1 AS n
            UNION ALL
            SELECT n + 1 FROM numeros WHERE n < {count}
        )
        SELECT n FROM numeros
        """;

    /// <summary>
    /// MySQL no tiene `PRINT` ni `RAISE NOTICE`. Lo más parecido es `SIGNAL` con
    /// un SQLSTATE de clase 01, que el servidor trata como aviso y devuelve por el
    /// mismo canal que el resto de advertencias.
    /// </summary>
    public string RaiseNotice(string text) =>
        $"SIGNAL SQLSTATE '01000' SET MESSAGE_TEXT = '{text}'";

    /// <summary>
    /// MySQL no tiene tipo booleano ni permite convertir a uno: `BOOL` es un
    /// sinónimo de `TINYINT(1)` y solo se distingue mirando la columna declarada.
    /// Por eso hace falta una tabla, aunque sea temporal; con `SELECT TRUE` el
    /// servidor devolvería un entero de 64 bits y no habría nada que normalizar.
    /// </summary>
    public string SelectBasicTypes => """
        DROP TEMPORARY TABLE IF EXISTS druse_tipos;
        CREATE TEMPORARY TABLE druse_tipos (
            entero     BIGINT,
            decimalito DECIMAL(10, 1),
            booleano   BOOL,
            fecha      DATE
        );
        INSERT INTO druse_tipos VALUES (42, 3.5, TRUE, '2026-08-11');
        SELECT entero, decimalito, booleano, fecha FROM druse_tipos;
        """;

    public string SelectNullAndEmpty =>
        "SELECT CAST(NULL AS CHAR(10)) AS vacio, '' AS cadena_vacia";

    public string InvalidSyntax => "SELECT * FROM";

    /// <summary>1064: error de sintaxis.</summary>
    public string SyntaxErrorCode => "1064";

    /// <summary>
    /// Da la línea, pero **solo dentro del texto** del mensaje: «…at line 3». El
    /// normalizador la extrae de ahí; no hay campo donde leerla.
    /// </summary>
    public SyntaxErrorPlace SyntaxErrorPlace => SyntaxErrorPlace.Line;

    /// <summary>1146: la tabla no existe.</summary>
    public string MissingTableCode => "1146";

    public string ThreeResultSets => "SELECT 1 AS a; SELECT 2 AS b; SELECT 3 AS c;";

    public string CreateTable(string name) => $"CREATE TABLE {name} (id INT)";

    public string DropTable(string name) => $"DROP TABLE IF EXISTS {name}";

    public string InsertThreeRows(string name) => $"INSERT INTO {name} (id) VALUES (1), (2), (3)";

    public string InsertNamedRows(string name) => $"""
        INSERT INTO {name} (id, nombre) VALUES (1, 'Ana'), (2, 'Bea'), (3, 'Cris')
        """;

    public string CreateTableWithColumns(string name) => $"""
        CREATE TABLE {name} (
            id        BIGINT AUTO_INCREMENT PRIMARY KEY,
            nombre    VARCHAR(200) NOT NULL,
            email     VARCHAR(200) NULL,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """;

    public string CreateView(string name) => $"CREATE VIEW {name} AS SELECT 7 AS valor";

    public string DropView(string name) => $"DROP VIEW IF EXISTS {name}";

    public string CreateProcedure(string name) => $"""
        CREATE PROCEDURE {name}()
        BEGIN
            SELECT 'marca_procedimiento';
        END
        """;

    public string CreateProcedureWithParameters(string name) => $"""
        CREATE PROCEDURE {name}(IN entrada INT, OUT salida VARCHAR(30))
        BEGIN
            SET salida = 'hecho';
        END
        """;

    public string DropProcedure(string name) => $"DROP PROCEDURE IF EXISTS {name}";

    /// <summary>
    /// `TIMESTAMP` es el tipo de MySQL con semántica de zona horaria: se guarda en
    /// UTC y se convierte a la zona de la sesión al leerlo.
    /// </summary>
    public string TimestampTypeName => "timestamp";

    private static (bool, string?) Probe()
    {
        try
        {
            var fixture = new MySqlFixture();

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));

            var result = fixture.Provider
                .TestConnectionAsync(fixture.Profile(), fixture.Credentials, timeout.Token)
                .GetAwaiter()
                .GetResult();

            return (result.Succeeded, result.Error?.Message);
        }
        catch (Exception exception)
        {
            return (false, exception.Message);
        }
    }
}

/// <summary>Ejecuta el contrato común contra MySQL.</summary>
public sealed class MySqlContractTests : DatabaseProviderContractTests<MySqlFixture>;
