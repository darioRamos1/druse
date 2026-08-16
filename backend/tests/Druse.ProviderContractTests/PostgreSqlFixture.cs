using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.PostgreSql;

namespace Druse.ProviderContractTests;

/// <summary>Conexión y dialecto de PostgreSQL para el contrato común.</summary>
public sealed class PostgreSqlFixture : IProviderFixture
{
    private static readonly Lazy<(bool Available, string? Reason)> Probed = new(Probe);

    public string EngineName => "PostgreSQL";

    public bool IsAvailable => Probed.Value.Available;

    public string? UnavailableReason => Probed.Value.Reason;

    public IDatabaseProvider Provider { get; } = new PostgreSqlDatabaseProvider();

    public IQueryExecutor Executor { get; } = new PostgreSqlQueryExecutor();

    public IDatabaseMetadataReader Metadata { get; } = new PostgreSqlMetadataReader();

    public IRowEditor RowEditor { get; } = new PostgreSqlRowEditor();

    public ITableDesigner Designer { get; } = new PostgreSqlTableDesigner();

    public string DatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_DB") ?? "druse_test";

    public string SecondaryDatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_SECOND_DB") ?? "druse_test_secondary";

    public string DefaultSchema => "public";

    public string DefaultSchemaFor(string database) => "public";

    public ConnectionProfile Profile(bool onlyRead = false) => new()
    {
        Id = Guid.NewGuid(),
        Name = "PostgreSQL de pruebas",
        Engine = DatabaseEngine.PostgreSql,
        Host = Environment.GetEnvironmentVariable("DRUSE_TEST_PG_HOST") ?? "127.0.0.1",
        Port = int.TryParse(Environment.GetEnvironmentVariable("DRUSE_TEST_PG_PORT"), out var port)
            ? port
            : 55440,
        Database = DatabaseName,
        Username = Environment.GetEnvironmentVariable("DRUSE_TEST_PG_USER") ?? "postgres",
        ReadOnly = onlyRead,
        ConnectTimeoutSeconds = 5,
    };

    public ConnectionProfile ProfileForDatabase(string database, bool onlyRead = false) =>
        Profile(onlyRead) with { Id = Guid.NewGuid(), Database = database };

    public DatabaseCredentials Credentials =>
        new(Environment.GetEnvironmentVariable("DRUSE_TEST_PG_PASSWORD") ?? "druse_dev_only");

    // --- Dialecto -----------------------------------------------------------

    public string Sleep(int seconds) => $"SELECT pg_sleep({seconds})";

    public string GenerateRows(int count) => $"SELECT generate_series(1, {count}) AS n";

    public string RaiseNotice(string text) =>
        $"DO $$ BEGIN RAISE NOTICE '{text}'; END $$;";

    public string SelectBasicTypes => """
        SELECT
            42::int8          AS entero,
            3.5::numeric      AS decimalito,
            true              AS booleano,
            DATE '2026-08-11' AS fecha
        """;

    public string SelectNullAndEmpty => "SELECT NULL::text AS vacio, '' AS cadena_vacia";

    public string InvalidSyntax => "SELECT * FROM";

    public string SyntaxErrorCode => "42601";

    public string MissingTableCode => "42P01";

    public string ThreeResultSets => "SELECT 1 AS a; SELECT 2 AS b; SELECT 3 AS c;";

    public string CreateTable(string name) => $"CREATE TABLE {name} (id int)";

    public string DropTable(string name) => $"DROP TABLE IF EXISTS {name}";

    public string InsertThreeRows(string name) => $"INSERT INTO {name} (id) VALUES (1), (2), (3)";

    public string InsertNamedRows(string name) => $"""
        INSERT INTO {name} (id, nombre) VALUES (1, 'Ana'), (2, 'Bea'), (3, 'Cris')
        """;

    public string CreateTableWithColumns(string name) => $"""
        CREATE TABLE {name} (
            id        bigserial PRIMARY KEY,
            nombre    text NOT NULL,
            email     text,
            creado_en timestamptz DEFAULT now()
        )
        """;

    public string CreateView(string name) => $"CREATE VIEW {name} AS SELECT 7 AS valor";

    public string DropView(string name) => $"DROP VIEW IF EXISTS {name}";

    public string CreateProcedure(string name) => $"""
        CREATE PROCEDURE {name}()
        LANGUAGE plpgsql
        AS $$ BEGIN RAISE NOTICE 'marca_procedimiento'; END $$
        """;

    public string CreateProcedureWithParameters(string name) => $"""
        CREATE PROCEDURE {name}(entrada INT, OUT salida VARCHAR)
        LANGUAGE plpgsql
        AS $$ BEGIN salida := 'hecho'; END $$
        """;

    public string DropProcedure(string name) => $"DROP PROCEDURE IF EXISTS {name}()";

    public string TimestampTypeName => "timestamp with time zone";

    private static (bool, string?) Probe()
    {
        try
        {
            var fixture = new PostgreSqlFixture();

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));

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

/// <summary>Ejecuta el contrato común contra PostgreSQL.</summary>
public sealed class PostgreSqlContractTests : DatabaseProviderContractTests<PostgreSqlFixture>
{
    [Fact]
    public async Task ProcedimientosSobrecargados_ConservanSuIdentidad()
    {
        if (!Fixture.IsAvailable) { return; }

        await using var session = await Fixture.Provider.OpenSessionAsync(
            Fixture.Profile(),
            Fixture.Credentials,
            CancellationToken.None);
        var procedureName = $"druse_overload_{Guid.NewGuid():N}";

        async Task<QueryResult> ExecuteAsync(string sql) =>
            await Fixture.Executor.ExecuteAsync(
                session,
                new QueryRequest
                {
                    SessionId = session.Id,
                    Sql = sql,
                    MaxRows = 100,
                    TimeoutSeconds = 30,
                    DestructiveConfirmed = true,
                },
                CancellationToken.None);

        try
        {
            var creation = await ExecuteAsync($"""
                CREATE PROCEDURE {procedureName}(integer)
                LANGUAGE plpgsql
                AS $$ BEGIN RAISE NOTICE 'marca_entero'; END $$;

                CREATE PROCEDURE {procedureName}(text)
                LANGUAGE plpgsql
                AS $$ BEGIN RAISE NOTICE 'marca_texto'; END $$;
                """);
            Assert.Equal(QueryExecutionState.Succeeded, creation.State);

            var folder = new DatabaseObject
            {
                Id = $"folder:{Fixture.DefaultSchema}:procedures",
                Name = "Procedures",
                Kind = DatabaseObjectKind.Folder,
                Database = Fixture.DatabaseName,
                Schema = Fixture.DefaultSchema,
            };
            var procedures = await Fixture.Metadata.GetChildrenAsync(
                session,
                folder,
                CancellationToken.None);
            var overloads = procedures
                .Where(item => item.Name.StartsWith($"{procedureName}(", StringComparison.Ordinal))
                .ToArray();

            Assert.Equal(2, overloads.Length);
            Assert.Equal(2, overloads.Select(item => item.Id).Distinct().Count());
            Assert.All(overloads, item => Assert.StartsWith("Procedure:oid:", item.Id, StringComparison.Ordinal));

            var integerProcedure = Assert.Single(
                overloads,
                item => item.Name.Contains("integer", StringComparison.OrdinalIgnoreCase));
            var textProcedure = Assert.Single(
                overloads,
                item => item.Name.Contains("text", StringComparison.OrdinalIgnoreCase));
            var integerDefinition = await Fixture.Metadata.GetDefinitionAsync(
                session,
                integerProcedure,
                CancellationToken.None);
            var textDefinition = await Fixture.Metadata.GetDefinitionAsync(
                session,
                textProcedure,
                CancellationToken.None);

            Assert.Contains("marca_entero", integerDefinition, StringComparison.Ordinal);
            Assert.DoesNotContain("marca_texto", integerDefinition, StringComparison.Ordinal);
            Assert.Contains("marca_texto", textDefinition, StringComparison.Ordinal);
            Assert.DoesNotContain("marca_entero", textDefinition, StringComparison.Ordinal);

            var forgedProcedure = integerProcedure with { Name = textProcedure.Name };
            await Assert.ThrowsAsync<DatabaseOperationException>(() =>
                Fixture.Metadata.GetDefinitionAsync(session, forgedProcedure, CancellationToken.None));
        }
        finally
        {
            await ExecuteAsync($"""
                DROP PROCEDURE IF EXISTS {procedureName}(integer);
                DROP PROCEDURE IF EXISTS {procedureName}(text);
                """);
        }
    }
}
