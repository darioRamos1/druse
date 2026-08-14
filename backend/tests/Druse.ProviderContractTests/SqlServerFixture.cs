using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.SqlServer;

namespace Druse.ProviderContractTests;

/// <summary>Conexión y dialecto de SQL Server para el contrato común.</summary>
public sealed class SqlServerFixture : IProviderFixture
{
    private static readonly Lazy<(bool Available, string? Reason)> Probed = new(Probe);

    public string EngineName => "SQL Server";

    public bool IsAvailable => Probed.Value.Available;

    public string? UnavailableReason => Probed.Value.Reason;

    public IDatabaseProvider Provider { get; } = new SqlServerDatabaseProvider();

    public IQueryExecutor Executor { get; } = new SqlServerQueryExecutor();

    public IDatabaseMetadataReader Metadata { get; } = new SqlServerMetadataReader();

    public IRowEditor RowEditor { get; } = new SqlServerRowEditor();

    public ITableDesigner Designer { get; } = new SqlServerTableDesigner();

    public string DatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_DB") ?? "druse_test";

    public string SecondaryDatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_SECOND_DB") ?? "druse_test_secondary";

    public string DefaultSchema => "dbo";

    public string DefaultSchemaFor(string database) => "dbo";

    public ConnectionProfile Profile(bool onlyRead = false) => new()
    {
        Id = Guid.NewGuid(),
        Name = "SQL Server de pruebas",
        Engine = DatabaseEngine.SqlServer,
        Host = Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_HOST") ?? "127.0.0.1",
        Port = int.TryParse(Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_PORT"), out var port)
            ? port
            : 14433,
        Database = DatabaseName,
        Username = Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_USER") ?? "sa",
        ReadOnly = onlyRead,
        ConnectTimeoutSeconds = 5,
    };

    public ConnectionProfile ProfileForDatabase(string database, bool onlyRead = false) =>
        Profile(onlyRead) with { Id = Guid.NewGuid(), Database = database };

    public DatabaseCredentials Credentials =>
        new(Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_PASSWORD") ?? "Druse_dev_only_1");

    // --- Dialecto -----------------------------------------------------------

    public string Sleep(int seconds) =>
        $"WAITFOR DELAY '{TimeSpan.FromSeconds(seconds):hh\\:mm\\:ss}'";

    /// <summary>
    /// SQL Server no tiene `generate_series` hasta la versión 2022, y aun así con
    /// otra firma. Una CTE recursiva funciona en todas las versiones soportadas.
    /// </summary>
    public string GenerateRows(int count) => $"""
        WITH numeros AS (
            SELECT 1 AS n
            UNION ALL
            SELECT n + 1 FROM numeros WHERE n < {count}
        )
        SELECT n FROM numeros OPTION (MAXRECURSION 0)
        """;

    public string RaiseNotice(string text) => $"PRINT '{text}'";

    public string SelectBasicTypes => """
        SELECT
            CAST(42 AS bigint)          AS entero,
            CAST(3.5 AS decimal(10, 1)) AS decimalito,
            CAST(1 AS bit)              AS booleano,
            CAST('2026-08-11' AS date)  AS fecha
        """;

    public string SelectNullAndEmpty =>
        "SELECT CAST(NULL AS nvarchar(10)) AS vacio, '' AS cadena_vacia";

    public string InvalidSyntax => "SELECT * FROM";

    /// <summary>102: sintaxis incorrecta cerca de…</summary>
    public string SyntaxErrorCode => "102";

    /// <summary>208: nombre de objeto no válido.</summary>
    public string MissingTableCode => "208";

    public string ThreeResultSets => "SELECT 1 AS a; SELECT 2 AS b; SELECT 3 AS c;";

    public string CreateTable(string name) => $"CREATE TABLE {name} (id int)";

    /// <summary>`DROP TABLE IF EXISTS` existe desde SQL Server 2016.</summary>
    public string DropTable(string name) => $"DROP TABLE IF EXISTS {name}";

    public string InsertThreeRows(string name) => $"INSERT INTO {name} (id) VALUES (1), (2), (3)";

    public string InsertNamedRows(string name) => $"""
        SET IDENTITY_INSERT {name} ON;
        INSERT INTO {name} (id, nombre) VALUES (1, 'Ana'), (2, 'Bea'), (3, 'Cris');
        SET IDENTITY_INSERT {name} OFF;
        """;

    public string CreateTableWithColumns(string name) => $"""
        CREATE TABLE {name} (
            id        bigint IDENTITY(1,1) PRIMARY KEY,
            nombre    nvarchar(200) NOT NULL,
            email     nvarchar(200) NULL,
            creado_en datetimeoffset DEFAULT SYSDATETIMEOFFSET()
        )
        """;

    public string CreateView(string name) => $"CREATE VIEW {name} AS SELECT 7 AS valor";

    public string DropView(string name) => $"DROP VIEW IF EXISTS {name}";

    public string CreateProcedure(string name) => $"""
        CREATE PROCEDURE {name}
        AS BEGIN
            PRINT 'marca_procedimiento';
        END
        """;

    public string DropProcedure(string name) => $"DROP PROCEDURE IF EXISTS {name}";

    public string TimestampTypeName => "datetimeoffset(7)";

    private static (bool, string?) Probe()
    {
        try
        {
            var fixture = new SqlServerFixture();

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

/// <summary>Ejecuta el contrato común contra SQL Server.</summary>
public sealed class SqlServerContractTests : DatabaseProviderContractTests<SqlServerFixture>;
