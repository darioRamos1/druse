using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Druse.Application.Abstractions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Druse.IntegrationTests;

/// <summary>
/// Recorre por HTTP el mismo camino que hará el usuario: conectar, explorar,
/// ejecutar y cancelar. Es el criterio de salida de la Fase 2.
/// </summary>
public sealed class QueryFlowTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;

    public QueryFlowTests(DruseApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<(HttpClient Client, Guid SessionId)> ConnectAsync(bool readOnly = false)
    {
        var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest(readOnly));
        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        return (client, body.GetProperty("sessionId").GetGuid());
    }

    [Fact]
    public async Task ListaLosMotoresDisponibles()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var engines = await client.GetFromJsonAsync<JsonElement>("/api/engines");

        Assert.Equal(JsonValueKind.Array, engines.ValueKind);
        Assert.Contains(
            engines.EnumerateArray(),
            engine => engine.GetProperty("id").GetString() == "postgresql");
    }

    [Theory]
    [InlineData("postgresql", 5432)]
    [InlineData("sqlserver", 1433)]
    [InlineData("mysql", 3306)]
    public async Task CadaMotorDeclaraSuPuertoHabitual(string id, int defaultPort)
    {
        using var client = _factory.CreateAuthenticatedClient();

        var engines = await client.GetFromJsonAsync<JsonElement>("/api/engines");

        var engine = engines.EnumerateArray()
            .Single(item => item.GetProperty("id").GetString() == id);

        Assert.Equal(defaultPort, engine.GetProperty("defaultPort").GetInt32());
    }

    /// <summary>
    /// Cada motor aporta tres piezas y el registro las busca por separado. Si
    /// alguien añade un proveedor y olvida registrar su lector de metadatos o su
    /// ejecutor, nada falla al arrancar: el motor aparece en la lista y revienta
    /// más tarde, al abrir el árbol o al ejecutar. Esto lo detecta antes.
    /// </summary>
    [Fact]
    public void TodoMotorAnunciadoTieneSusTresPiezas()
    {
        var registry = _factory.Services.GetRequiredService<IProviderRegistry>();

        Assert.NotEmpty(registry.SupportedEngines);

        foreach (var engine in registry.SupportedEngines)
        {
            Assert.Equal(engine, registry.GetProvider(engine).Engine);
            Assert.Equal(engine, registry.GetMetadataReader(engine).Engine);
            Assert.Equal(engine, registry.GetQueryExecutor(engine).Engine);
        }
    }

    [Fact]
    public async Task UnaSesionInexistente_DevuelveNoEncontrado()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.GetAsync($"/api/sessions/{Guid.NewGuid()}/metadata/databases");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UnPerfilInvalido_NoLlegaAIntentarConectarse()
    {
        using var client = _factory.CreateAuthenticatedClient();

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
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/connections/test", TestDatabase.ConnectRequest());
        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        Assert.True(body.GetProperty("succeeded").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("serverVersion").GetString()));
    }

    [RequiresPostgreSqlFact]
    public async Task NingunaRespuestaDevuelveLaContrasena()
    {
        using var client = _factory.CreateAuthenticatedClient();

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
    public async Task DefinicionDeVista_DevuelveSqlEditable()
    {
        var (client, sessionId) = await ConnectAsync();
        var viewName = $"druse_view_{Guid.NewGuid():N}";

        using (client)
        {
            try
            {
                var create = await client.PostAsJsonAsync("/api/queries", new
                {
                    sessionId,
                    sql = $"CREATE VIEW {viewName} AS SELECT 7 AS valor",
                    maxRows = 100,
                    timeoutSeconds = 30,
                    confirmDestructive = true,
                });
                create.EnsureSuccessStatusCode();

                var response = await client.PostAsJsonAsync(
                    $"/api/sessions/{sessionId}/metadata/definition",
                    new
                    {
                        id = $"View:public.{viewName}",
                        name = viewName,
                        kind = "view",
                        database = TestDatabase.Database,
                        schema = "public",
                        hasChildren = true,
                    });

                response.EnsureSuccessStatusCode();
                var body = await response.ReadJsonAsync();
                var sql = body.GetProperty("sql").GetString();

                Assert.Contains("CREATE VIEW", sql, StringComparison.OrdinalIgnoreCase);
                Assert.Contains(viewName, sql, StringComparison.OrdinalIgnoreCase);
                Assert.Contains("valor", sql, StringComparison.OrdinalIgnoreCase);
            }
            finally
            {
                await client.PostAsJsonAsync("/api/queries", new
                {
                    sessionId,
                    sql = $"DROP VIEW IF EXISTS {viewName}",
                    maxRows = 100,
                    timeoutSeconds = 30,
                    confirmDestructive = true,
                });
            }
        }
    }

    [RequiresPostgreSqlFact]
    public async Task DefinicionDeProcedimiento_DevuelveSqlEditable()
    {
        var (client, sessionId) = await ConnectAsync();
        var procedureName = $"druse_procedure_{Guid.NewGuid():N}";

        using (client)
        {
            try
            {
                var create = await client.PostAsJsonAsync("/api/queries", new
                {
                    sessionId,
                    sql = $"""
                        CREATE PROCEDURE {procedureName}(integer)
                        LANGUAGE plpgsql
                        AS $$ BEGIN RAISE NOTICE 'marca_procedimiento'; END $$
                        """,
                    maxRows = 100,
                    timeoutSeconds = 30,
                    confirmDestructive = true,
                });
                create.EnsureSuccessStatusCode();

                var childrenResponse = await client.PostAsJsonAsync(
                    $"/api/sessions/{sessionId}/metadata/children",
                    new
                    {
                        id = "folder:public:procedures",
                        name = "Procedures",
                        kind = "folder",
                        database = TestDatabase.Database,
                        schema = "public",
                        hasChildren = true,
                    });
                childrenResponse.EnsureSuccessStatusCode();
                var children = await childrenResponse.ReadJsonAsync();
                var procedure = children.EnumerateArray().Single(
                    item => item.GetProperty("name").GetString() == $"{procedureName}(integer)");

                var response = await client.PostAsJsonAsync(
                    $"/api/sessions/{sessionId}/metadata/definition",
                    procedure);

                response.EnsureSuccessStatusCode();
                var body = await response.ReadJsonAsync();
                var sql = body.GetProperty("sql").GetString();

                Assert.Contains("CREATE PROCEDURE", sql, StringComparison.OrdinalIgnoreCase);
                Assert.Contains(procedureName, sql, StringComparison.OrdinalIgnoreCase);
                Assert.Contains("marca_procedimiento", sql, StringComparison.OrdinalIgnoreCase);
            }
            finally
            {
                await client.PostAsJsonAsync("/api/queries", new
                {
                    sessionId,
                    sql = $"DROP PROCEDURE IF EXISTS {procedureName}(integer)",
                    maxRows = 100,
                    timeoutSeconds = 30,
                    confirmDestructive = true,
                });
            }
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
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.DeleteAsync($"/api/queries/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>
    /// Cancelar una consulta **en curso**, que es el caso que le importa al
    /// usuario.
    ///
    /// El cliente manda el identificador con la petición: si lo generara el
    /// servidor, solo lo conocería al recibir la respuesta —cuando ya no queda
    /// nada que cancelar— y el botón «Cancelar» no serviría de nada.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task CancelarUnaConsultaEnCurso_LaDetiene()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var executionId = Guid.NewGuid();

            var running = client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                executionId,
                sql = "SELECT pg_sleep(30)",
                timeoutSeconds = 60,
            });

            // Espera a que la ejecución esté registrada antes de cancelarla.
            HttpResponseMessage? cancel = null;

            for (var attempt = 0; attempt < 40; attempt++)
            {
                await Task.Delay(100);

                cancel = await client.DeleteAsync($"/api/queries/{executionId}");

                if (cancel.StatusCode == HttpStatusCode.Accepted)
                {
                    break;
                }
            }

            Assert.NotNull(cancel);
            Assert.Equal(HttpStatusCode.Accepted, cancel.StatusCode);

            var response = await running;
            response.EnsureSuccessStatusCode();

            var body = await response.ReadJsonAsync();

            Assert.Equal("canceled", body.GetProperty("state").GetString());
            // Cancelar debe cortar de verdad, no esperar los 30 segundos.
            Assert.True(body.GetProperty("durationMs").GetInt64() < 15_000);

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task ElIdentificadorDeEjecucionEsElQueMandaElCliente()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var executionId = Guid.NewGuid();

            var response = await client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                executionId,
                sql = "SELECT 1",
            });

            response.EnsureSuccessStatusCode();
            var body = await response.ReadJsonAsync();

            Assert.Equal(executionId, body.GetProperty("executionId").GetGuid());

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }
}
