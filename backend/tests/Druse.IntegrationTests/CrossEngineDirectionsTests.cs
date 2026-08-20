using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// El mismo traslado, en varias direcciones entre motores distintos.
///
/// `CrossEngineTransferTests` mira **a fondo** una dirección —PostgreSQL a SQL
/// Server, con los tipos que peor viajan—. Esto mira **a lo ancho**: que crear la
/// tabla al otro lado y copiar dentro funciona salga de donde salga y vaya a donde
/// vaya, porque cada par tiene su dialecto y el que no se prueba es el que se
/// rompe.
///
/// Por eso las tablas son deliberadamente sosas: un entero, un texto y un decimal.
/// Lo que se comprueba aquí no es la traducción de tipos raros, es que el camino
/// entero existe en las cuatro esquinas.
/// </summary>
public sealed class CrossEngineDirectionsTests(DruseApiFactory factory)
    : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    /// <summary>Se exigen los motores cuando la variable lo pide, igual que el resto.</summary>
    private static bool Required =>
        Environment.GetEnvironmentVariable("DRUSE_REQUIRE_ENGINES") == "1";

    [Theory]
    [InlineData(RestoreEngines.PostgreSql, RestoreEngines.MySql)]
    [InlineData(RestoreEngines.MySql, RestoreEngines.SqlServer)]
    [InlineData(RestoreEngines.SqlServer, RestoreEngines.PostgreSql)]
    [InlineData(RestoreEngines.PostgreSql, RestoreEngines.Informix)]
    public async Task CruzaDeUnMotorAOtroYLosValoresLleganIgual(string desde, string hacia)
    {
        var origen = RestoreEngines.Of(desde);
        var destino = RestoreEngines.Of(hacia);

        using var client = _factory.CreateAuthenticatedClient();

        var sourceSession = await OpenAsync(client, origen);
        var targetSession = await OpenAsync(client, destino);

        if (sourceSession is null || targetSession is null)
        {
            return;
        }

        var tabla = $"druse_dir_{Guid.NewGuid().ToString("N")[..8]}";
        var request = Request(sourceSession.Value, origen, targetSession.Value, destino, tabla);

        try
        {
            await RunAsync(
                client,
                sourceSession.Value,
                $"CREATE TABLE {tabla} (" +
                $"id {origen.NumberType} PRIMARY KEY, " +
                $"nombre {origen.TextType}, " +
                "saldo decimal(12,3))");

            await RunAsync(
                client,
                sourceSession.Value,
                $"INSERT INTO {tabla} VALUES (1, 'Ana', 12.345)");

            await RunAsync(
                client,
                sourceSession.Value,
                $"INSERT INTO {tabla} VALUES (2, 'Bea', -7.500)");

            // 1. Cada columna tiene dónde ir. Que el nombre del tipo sea el
            //    esperado se prueba sin servidor; aquí basta con que exista, que es
            //    lo que impediría crear la tabla.
            var translations = await TranslateAsync(client, request);

            Assert.Equal(3, translations.Count);

            foreach (var (columna, translation) in translations)
            {
                Assert.False(
                    string.IsNullOrWhiteSpace(translation.GetProperty("targetType").GetString()),
                    $"«{columna}» se quedó sin tipo al pasar de {origen.Name} a {destino.Name}.");

                Assert.NotEqual("None", translation.GetProperty("fidelity").GetString());
            }

            // 2. La tabla se crea al otro lado con esos tipos.
            var created = await client.PostAsJsonAsync("/api/transfers/target", request);

            Assert.True(
                created.IsSuccessStatusCode,
                $"No se pudo crear la tabla en {destino.Name}: {await created.Content.ReadAsStringAsync()}");

            // 3. Y las filas llegan, con lo que llevaban dentro.
            var progress = await TransferAsync(client, request);

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(2, progress.GetProperty("rowsCopied").GetInt64());

            var nombres = await LeerAsync(
                client,
                targetSession.Value,
                $"SELECT nombre FROM {tabla} ORDER BY id");

            Assert.Equal(["Ana", "Bea"], nombres);
        }
        finally
        {
            await RunAsync(client, sourceSession.Value, $"DROP TABLE {tabla}");
            await RunAsync(client, targetSession.Value, $"DROP TABLE {tabla}");
        }
    }

    // -----------------------------------------------------------------------
    // Andamiaje
    // -----------------------------------------------------------------------

    /// <summary>
    /// Abre una sesión, o devuelve nulo si ese motor no está levantado.
    ///
    /// Con `DRUSE_REQUIRE_ENGINES=1` no se salta: se falla, que es lo que hace que
    /// esta suite signifique algo en la máquina donde sí están los cuatro.
    /// </summary>
    private static async Task<Guid?> OpenAsync(HttpClient client, RestoreEngine engine)
    {
        using var response = await client.PostAsJsonAsync("/api/sessions", new
        {
            profile = new
            {
                name = $"Cruce {engine.Name}",
                engine = engine.Id,
                host = engine.Host,
                port = engine.Port,
                database = engine.Database,
                username = engine.Username,
                connectTimeoutSeconds = 5,
            },
            password = engine.Password,
        });

        if (!response.IsSuccessStatusCode)
        {
            Assert.False(Required, $"Se exigían los motores y {engine.Name} no respondió.");

            return null;
        }

        return (await response.ReadJsonAsync()).GetProperty("sessionId").GetGuid();
    }

    private static object Request(
        Guid sourceSession,
        RestoreEngine origen,
        Guid targetSession,
        RestoreEngine destino,
        string tabla) => new
        {
            sourceSessionId = sourceSession,
            source = new
            {
                id = $"Table:{origen.Schema}.{tabla}",
                name = tabla,
                database = origen.Database,
                schema = origen.Schema,
            },
            targetSessionId = targetSession,
            target = new
            {
                id = $"Table:{destino.Schema}.{tabla}",
                name = tabla,
                database = destino.Database,
                schema = destino.Schema,
            },
            mode = "Insert",
            atomic = false,
            batchSize = 1000,
            keepIdentity = true,
            confirmed = true,
        };

    /// <summary>Qué tipo tendría cada columna al otro lado, por nombre de columna.</summary>
    private static async Task<Dictionary<string, JsonElement>> TranslateAsync(
        HttpClient client,
        object request)
    {
        var response = await client.PostAsJsonAsync("/api/transfers/translation", request);

        response.EnsureSuccessStatusCode();

        return (await response.ReadJsonAsync())
            .GetProperty("translations")
            .EnumerateArray()
            .ToDictionary(item => item.GetProperty("column").GetString()!);
    }

    private static async Task<JsonElement> TransferAsync(HttpClient client, object request)
    {
        var response = await client.PostAsJsonAsync("/api/transfers", request);

        response.EnsureSuccessStatusCode();

        var id = (await response.ReadJsonAsync()).GetProperty("id").GetGuid();

        for (var intento = 0; intento < 400; intento++)
        {
            var status = await client.GetAsync($"/api/transfers/{id}/status");

            status.EnsureSuccessStatusCode();

            var body = await status.ReadJsonAsync();

            if (body.GetProperty("outcome").GetString() != "Running")
            {
                return body;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"El traslado {id} no terminó en veinte segundos.");
    }

    /// <summary>Ejecuta SQL sin mirar el resultado. La limpieza se traga sus errores.</summary>
    private static async Task RunAsync(HttpClient client, Guid sessionId, string sql)
    {
        using var response = await client.PostAsJsonAsync("/api/queries", new
        {
            sessionId,
            executionId = Guid.NewGuid(),
            sql,
            maxRows = 1,
            timeoutSeconds = 30,
            confirmDestructive = true,
        });
    }

    private static async Task<List<string>> LeerAsync(HttpClient client, Guid sessionId, string sql)
    {
        var response = await client.PostAsJsonAsync("/api/queries", new
        {
            sessionId,
            executionId = Guid.NewGuid(),
            sql,
            maxRows = 100,
            timeoutSeconds = 30,
        });

        response.EnsureSuccessStatusCode();

        return
        [
            .. (await response.ReadJsonAsync())
                .GetProperty("resultSets")[0]
                .GetProperty("rows")
                .EnumerateArray()
                .Select(row => row[0].GetString() ?? string.Empty),
        ];
    }
}
