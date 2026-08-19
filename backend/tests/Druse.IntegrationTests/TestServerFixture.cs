using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Datos del servidor de pruebas, leídos del entorno.
///
/// Se duplican respecto a las pruebas contractuales a propósito: los proyectos de
/// prueba no se referencian entre sí, para que ninguno herede dependencias del
/// otro.
/// </summary>
internal static class TestDatabase
{
    public static string Host =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_HOST") ?? "127.0.0.1";

    public static int Port =>
        int.TryParse(Environment.GetEnvironmentVariable("DRUSE_TEST_PG_PORT"), out var port)
            ? port
            : 55440;

    public static string Database =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_DB") ?? "druse_test";

    public static string SecondaryDatabase =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_SECOND_DB") ?? "druse_test_secondary";

    public static string Username =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_USER") ?? "postgres";

    public static string Password =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_PASSWORD") ?? "druse_dev_only";

    /// <summary>Cuerpo de conexión listo para enviar a la API.</summary>
    public static object ConnectRequest(bool readOnly = false, string? database = null) => new
    {
        profile = new
        {
            name = "PostgreSQL de pruebas",
            engine = "postgresql",
            host = Host,
            port = Port,
            database = database ?? Database,
            username = Username,
            readOnly,
            connectTimeoutSeconds = 5,
        },
        password = Password,
    };
}

/// <summary>Omite la prueba si no hay servidor de pruebas disponible.</summary>
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

internal static class PostgreSqlAvailability
{
    public static readonly Lazy<bool> IsAvailable = new(Probe);

    /// <summary>Abre un socket TCP: basta para saber si merece la pena intentarlo.</summary>
    private static bool Probe()
    {
        try
        {
            using var client = new System.Net.Sockets.TcpClient();

            return client.ConnectAsync(TestDatabase.Host, TestDatabase.Port)
                .Wait(TimeSpan.FromSeconds(3)) && client.Connected;
        }
        catch
        {
            return false;
        }
    }
}

/// <summary>
/// El SQL Server de pruebas, para lo que necesita **dos motores a la vez**.
///
/// Existe solo por el traslado entre motores distintos: hasta ahora las pruebas
/// de integración se bastaban con PostgreSQL, porque lo que comprobaban no
/// dependía del dialecto. Traducir tipos sí, y no se puede comprobar de verdad
/// con un motor solo.
/// </summary>
internal static class TestSqlServer
{
    public static string Host =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_HOST") ?? "127.0.0.1";

    public static int Port =>
        int.TryParse(Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_PORT"), out var port)
            ? port
            : 14433;

    public static string Database =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_DB") ?? "druse_test";

    public static string Username =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_USER") ?? "sa";

    public static string Password =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_MSSQL_PASSWORD") ?? "Druse_dev_only_1";

    /// <summary>Cuerpo de conexión listo para enviar a la API.</summary>
    public static object ConnectRequest() => new
    {
        profile = new
        {
            name = "SQL Server de pruebas",
            engine = "sqlserver",
            host = Host,
            port = Port,
            database = Database,
            username = Username,
            readOnly = false,
            connectTimeoutSeconds = 5,

            // El contenedor usa un certificado autofirmado, como cualquier
            // instalación recién hecha.
            trustServerCertificate = true,
        },
        password = Password,
    };
}

/// <summary>Omite la prueba si falta alguno de los dos motores que necesita.</summary>
public sealed class RequiresTwoEnginesFactAttribute : FactAttribute
{
    public RequiresTwoEnginesFactAttribute()
    {
        if (!PostgreSqlAvailability.IsAvailable.Value)
        {
            Skip = $"No hay un PostgreSQL de pruebas en {TestDatabase.Host}:{TestDatabase.Port}.";
        }
        else if (!SqlServerAvailability.IsAvailable.Value)
        {
            Skip = $"No hay un SQL Server de pruebas en {TestSqlServer.Host}:{TestSqlServer.Port}.";
        }
    }
}

internal static class SqlServerAvailability
{
    public static readonly Lazy<bool> IsAvailable = new(Probe);

    /// <summary>Abre un socket TCP: basta para saber si merece la pena intentarlo.</summary>
    private static bool Probe()
    {
        try
        {
            using var client = new System.Net.Sockets.TcpClient();

            return client.ConnectAsync(TestSqlServer.Host, TestSqlServer.Port)
                .Wait(TimeSpan.FromSeconds(3)) && client.Connected;
        }
        catch
        {
            return false;
        }
    }
}

internal static class HttpExtensions
{
    /// <summary>Lee el cuerpo como <see cref="JsonElement"/> sin tipar la respuesta.</summary>
    public static async Task<JsonElement> ReadJsonAsync(this HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<JsonElement>();
}
