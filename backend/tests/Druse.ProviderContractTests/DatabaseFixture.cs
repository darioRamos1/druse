using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.ProviderContractTests;

/// <summary>
/// Datos de conexión al servidor de pruebas.
///
/// Se leen de variables de entorno y **nunca** se escriben credenciales reales en
/// el repositorio (plan §11). Los valores por defecto apuntan al contenedor
/// desechable documentado en el README de pruebas.
/// </summary>
public static class TestDatabase
{
    public static string Host =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_HOST") ?? "127.0.0.1";

    public static int Port =>
        int.TryParse(Environment.GetEnvironmentVariable("DRUSE_TEST_PG_PORT"), out var port)
            ? port
            : 55440;

    public static string Database =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_DB") ?? "druse_test";

    public static string Username =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_USER") ?? "postgres";

    public static string? Password =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_PASSWORD") ?? "druse_dev_only";

    public static ConnectionProfile Profile(bool readOnly = false) => new()
    {
        Id = Guid.NewGuid(),
        Name = "PostgreSQL de pruebas",
        Engine = DatabaseEngine.PostgreSql,
        Host = Host,
        Port = Port,
        Database = Database,
        Username = Username,
        ReadOnly = readOnly,
        ConnectTimeoutSeconds = 5,
    };

    public static DatabaseCredentials Credentials => new(Password);
}

/// <summary>
/// Marca las pruebas que necesitan un servidor real.
///
/// Si no hay servidor disponible, se omiten en lugar de fallar: una máquina sin
/// Docker no debería dar por rota la suite entera.
/// </summary>
public sealed class RequiresPostgreSqlFactAttribute : FactAttribute
{
    public RequiresPostgreSqlFactAttribute()
    {
        if (!PostgreSqlAvailability.IsAvailable.Value)
        {
            Skip = $"No hay un PostgreSQL de pruebas en {TestDatabase.Host}:{TestDatabase.Port}.";
        }
    }
}

/// <inheritdoc cref="RequiresPostgreSqlFactAttribute"/>
public sealed class RequiresPostgreSqlTheoryAttribute : TheoryAttribute
{
    public RequiresPostgreSqlTheoryAttribute()
    {
        if (!PostgreSqlAvailability.IsAvailable.Value)
        {
            Skip = $"No hay un PostgreSQL de pruebas en {TestDatabase.Host}:{TestDatabase.Port}.";
        }
    }
}

/// <summary>Comprueba una sola vez si el servidor de pruebas responde.</summary>
internal static class PostgreSqlAvailability
{
    public static readonly Lazy<bool> IsAvailable = new(Probe);

    private static bool Probe()
    {
        try
        {
            var provider = new Provider.PostgreSql.PostgreSqlDatabaseProvider();

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));

            var result = provider
                .TestConnectionAsync(TestDatabase.Profile(), TestDatabase.Credentials, timeout.Token)
                .GetAwaiter()
                .GetResult();

            return result.Succeeded;
        }
        catch
        {
            return false;
        }
    }
}
