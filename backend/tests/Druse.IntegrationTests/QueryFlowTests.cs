using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Druse.IntegrationTests;

/// <summary>
/// Recorre por HTTP el mismo camino que hará el usuario: conectar, explorar,
/// ejecutar y cancelar. Es el criterio de salida de la Fase 2.
/// </summary>
public sealed class QueryFlowTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public QueryFlowTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    private async Task<(HttpClient Client, Guid SessionId)> ConnectAsync(bool readOnly = false)
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest(readOnly));
        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        return (client, body.GetProperty("sessionId").GetGuid());
    }

    [Fact]
    public async Task ListaLosMotoresDisponibles()
    {
        using var client = _factory.CreateClient();

        var engines = await client.GetFromJsonAsync<JsonElement>("/api/engines");

        Assert.Equal(JsonValueKind.Array, engines.ValueKind);
        Assert.Contains(
            engines.EnumerateArray(),
            engine => engine.GetProperty("id").GetString() == "postgresql");
    }

    [Fact]
    public async Task ElMotorPostgreSqlDeclaraSuPuertoHabitual()
    {
        using var client = _factory.CreateClient();

        var engines = await client.GetFromJsonAsync<JsonElement>("/api/engines");

        var postgres = engines.EnumerateArray()
            .Single(engine => engine.GetProperty("id").GetString() == "postgresql");

        Assert.Equal(5432, postgres.GetProperty("defaultPort").GetInt32());
    }

    [Fact]
    public async Task UnaSesionInexistente_DevuelveNoEncontrado()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync($"/api/sessions/{Guid.NewGuid()}/metadata/databases");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UnPerfilInvalido_NoLlegaAIntentarConectarse()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/connections/test", new
        {
            profile = new
            {
                name = "",
                engine = "postgresql",
                host = "",
                port = 0,
                database = "",
                username = "",
            },
            password = "irrelevante",
        });

        response.EnsureSuccessStatusCode();
        var body = await response.ReadJsonAsync();

        Assert.False(body.GetProperty("succeeded").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("errorMessage").GetString()));
    }

    [RequiresPostgreSqlFact]
    public async Task ProbarConexion_ConCredencialesCorrectas()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/connections/test", TestDatabase.ConnectRequest());
        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        Assert.True(body.GetProperty("succeeded").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("serverVersion").GetString()));
    }

    [RequiresPostgreSqlFact]
    public async Task NingunaRespuestaDevuelveLaContrasena()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest());
        var raw = await response.Content.ReadAsStringAsync();

        // La contraseña entra en la petición pero no puede salir en la respuesta
        // (plan §12).
        Assert.DoesNotContain(TestDatabase.Password, raw, StringComparison.Ordinal);
        Assert.DoesNotContain("password", raw, StringComparison.OrdinalIgnoreCase);
    }

    [RequiresPostgreSqlFact]
    public async Task FlujoCompleto_ConectarExplorarEjecutarYCerrar()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            // 1. El explorador ve la base.
            var databases = await client.GetFromJsonAsync<JsonElement>(
                $"/api/sessions/{sessionId}/metadata/databases");

            Assert.Contains(
                databases.EnumerateArray(),
                database => database.GetProperty("name").GetString() == TestDatabase.Database);

            // 2. Baja hasta los esquemas.
            var schemasResponse = await client.PostAsJsonAsync(
                $"/api/sessions/{sessionId}/metadata/children",
                new
                {
                    id = $"db:{TestDatabase.Database}",
                    name = TestDatabase.Database,
                    kind = "database",
                    database = TestDatabase.Database,
                    hasChildren = true,
                });

            schemasResponse.EnsureSuccessStatusCode();
            var schemas = await schemasResponse.ReadJsonAsync();

            Assert.Contains(
                schemas.EnumerateArray(),
                schema => schema.GetProperty("name").GetString() == "public");

            // 3. Ejecuta un SELECT.
            var queryResponse = await client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                sql = "SELECT 7 AS respuesta, NULL::text AS vacio",
                maxRows = 100,
                timeoutSeconds = 30,
            });

            queryResponse.EnsureSuccessStatusCode();
            var result = await queryResponse.ReadJsonAsync();

            Assert.Equal("succeeded", result.GetProperty("state").GetString());

            var resultSet = result.GetProperty("resultSets")[0];
            Assert.Equal("respuesta", resultSet.GetProperty("columns")[0].GetProperty("name").GetString());

            var firstRow = resultSet.GetProperty("rows")[0];
            Assert.Equal("7", firstRow[0].GetString());
            Assert.Equal(JsonValueKind.Null, firstRow[1].ValueKind);

            // 4. Cierra la sesión.
            var closeResponse = await client.DeleteAsync($"/api/sessions/{sessionId}");
            Assert.Equal(HttpStatusCode.NoContent, closeResponse.StatusCode);

            // 5. Ya no existe.
            var afterClose = await client.GetAsync($"/api/sessions/{sessionId}/metadata/databases");
            Assert.Equal(HttpStatusCode.NotFound, afterClose.StatusCode);
        }
    }

    [RequiresPostgreSqlFact]
    public async Task InstruccionDestructiva_SeRechazaHastaQueElUsuarioConfirma()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                sql = "DROP TABLE IF EXISTS tabla_inventada_para_la_prueba",
            });

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.ReadJsonAsync();
            Assert.Equal("unconfirmeddestructive", body.GetProperty("reason").GetString());
            Assert.NotEmpty(body.GetProperty("risks").EnumerateArray().ToList());

            // Con la confirmación, la misma instrucción sale adelante.
            var confirmed = await client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                sql = "DROP TABLE IF EXISTS tabla_inventada_para_la_prueba",
                confirmDestructive = true,
            });

            confirmed.EnsureSuccessStatusCode();
            var result = await confirmed.ReadJsonAsync();
            Assert.Equal("succeeded", result.GetProperty("state").GetString());

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task ConexionDeSoloLectura_RechazaEscrituras()
    {
        var (client, sessionId) = await ConnectAsync(readOnly: true);

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                sql = "CREATE TABLE no_deberia_crearse (id int)",
                confirmDestructive = true,
            });

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.ReadJsonAsync();
            Assert.Equal("readonlyconnection", body.GetProperty("reason").GetString());

            // Y las lecturas siguen funcionando.
            var read = await client.PostAsJsonAsync("/api/queries", new { sessionId, sql = "SELECT 1" });
            read.EnsureSuccessStatusCode();

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task ErrorDeSintaxis_LlegaConSuCodigoYSinTraza()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                sql = "SELECT * FROM",
            });

            response.EnsureSuccessStatusCode();
            var body = await response.ReadJsonAsync();

            Assert.Equal("failed", body.GetProperty("state").GetString());

            var error = body.GetProperty("error");
            Assert.Equal("42601", error.GetProperty("code").GetString());

            // Un error de SQL no debe traer la traza de .NET a la interfaz.
            var raw = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("at Npgsql", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("StackTrace", raw, StringComparison.OrdinalIgnoreCase);

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task LimiteDeFilas_SeAplicaYSeAvisa()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                sql = "SELECT generate_series(1, 500) AS n",
                maxRows = 25,
            });

            response.EnsureSuccessStatusCode();
            var resultSet = (await response.ReadJsonAsync()).GetProperty("resultSets")[0];

            Assert.Equal(25, resultSet.GetProperty("rows").GetArrayLength());
            Assert.True(resultSet.GetProperty("truncated").GetBoolean());

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task CancelarUnaEjecucionQueNoExiste_DevuelveNoEncontrado()
    {
        using var client = _factory.CreateClient();

        var response = await client.DeleteAsync($"/api/queries/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
