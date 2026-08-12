using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// El token protege la API frente a otros procesos de la misma máquina.
///
/// Escuchar solo en loopback impide el acceso desde la red, pero no desde el
/// propio equipo: sin token, cualquier proceso del usuario podría abrir sesiones
/// contra sus bases de datos (plan §12).
/// </summary>
public sealed class TokenAuthenticationTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;

    public TokenAuthenticationTests(DruseApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task SinToken_LaApiRechazaLaPeticion()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/connections");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ConTokenIncorrecto_LaApiRechazaLaPeticion()
    {
        using var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Druse-Token", "token-inventado");

        var response = await client.GetAsync("/api/connections");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ConElTokenCorrecto_LaApiResponde()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.GetAsync("/api/connections");

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task LaComprobacionDeSaludNoNecesitaToken()
    {
        // Debe poder consultarse antes de tener nada, para saber si el proceso ya
        // arrancó. No expone ningún dato del usuario.
        using var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task LosEndpointsDeDatosTambienExigenToken()
    {
        using var client = _factory.CreateClient();

        foreach (var path in new[] { "/api/engines", "/api/history", "/api/preferences" })
        {
            var response = await client.GetAsync(path);

            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }

    [Fact]
    public void ElTokenNoEsAdivinable()
    {
        var token = _factory.Token;

        // 32 bytes en base64: no puede derivarse del momento de arranque.
        Assert.True(token.Length >= 40, $"El token es demasiado corto: {token.Length} caracteres.");
    }
}

/// <summary>Conexiones guardadas, historial y preferencias por HTTP.</summary>
public sealed class StorageEndpointsTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;

    public StorageEndpointsTests(DruseApiFactory factory)
    {
        _factory = factory;
    }

    private static object SaveRequest(string name, bool storePassword = true) => new
    {
        profile = new
        {
            name,
            engine = "postgresql",
            host = "127.0.0.1",
            port = 5432,
            database = "druse_test",
            username = "postgres",
            environment = "production",
            readOnly = false,
        },
        password = "contraseña-de-prueba",
        storePassword,
    };

    [Fact]
    public async Task GuardaUnaConexionYLaDevuelveSinContrasena()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var created = await client.PostAsJsonAsync("/api/connections", SaveRequest($"Guardada {Guid.NewGuid():N}"));
        created.EnsureSuccessStatusCode();

        var raw = await created.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(raw).RootElement;

        Assert.True(body.GetProperty("hasStoredPassword").GetBoolean());

        // La contraseña entra en la petición pero jamás vuelve en la respuesta.
        Assert.DoesNotContain("contraseña-de-prueba", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("\"password\"", raw, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task LaConexionGuardadaSobreviveYSeListaSinSecretos()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var name = $"Persistente {Guid.NewGuid():N}";
        await client.PostAsJsonAsync("/api/connections", SaveRequest(name));

        var raw = await client.GetStringAsync("/api/connections");
        var list = JsonDocument.Parse(raw).RootElement;

        Assert.Contains(
            list.EnumerateArray(),
            item => item.GetProperty("name").GetString() == name);

        Assert.DoesNotContain("contraseña-de-prueba", raw, StringComparison.Ordinal);
    }

    [Fact]
    public async Task PuedeGuardarseSinRecordarLaContrasena()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/connections",
            SaveRequest($"Sin recordar {Guid.NewGuid():N}", storePassword: false));

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.False(body.GetProperty("hasStoredPassword").GetBoolean());
    }

    [Fact]
    public async Task ActualizaYBorraUnaConexion()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var created = await client.PostAsJsonAsync("/api/connections", SaveRequest($"Editable {Guid.NewGuid():N}"));
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var updated = await client.PutAsJsonAsync($"/api/connections/{id}", SaveRequest("Renombrada"));
        updated.EnsureSuccessStatusCode();

        Assert.Equal("Renombrada", (await updated.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("name").GetString());

        var deleted = await client.DeleteAsync($"/api/connections/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);

        var deletedAgain = await client.DeleteAsync($"/api/connections/{id}");
        Assert.Equal(HttpStatusCode.NotFound, deletedAgain.StatusCode);
    }

    [Fact]
    public async Task InformaDondeSeGuardanLasContrasenas()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var status = await client.GetFromJsonAsync<JsonElement>("/api/connections/secret-store");

        Assert.True(status.GetProperty("available").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(status.GetProperty("description").GetString()));
    }

    [Fact]
    public async Task GuardaYRecuperaPreferencias()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PutAsJsonAsync("/api/preferences/editor.fontSize", new { value = "14" });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var preferences = await client.GetFromJsonAsync<JsonElement>("/api/preferences");

        Assert.Equal("14", preferences.GetProperty("editor.fontSize").GetString());
    }

    [Fact]
    public async Task ElHistorialEmpiezaVacioYSePuedeVaciar()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var cleared = await client.DeleteAsync("/api/history");
        cleared.EnsureSuccessStatusCode();

        var history = await client.GetFromJsonAsync<JsonElement>("/api/history");

        Assert.Equal(0, history.GetArrayLength());
    }

    [RequiresPostgreSqlFact]
    public async Task EjecutarUnaConsultaLaAnotaEnElHistorial()
    {
        using var client = _factory.CreateAuthenticatedClient();

        await client.DeleteAsync("/api/history");

        var session = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest());
        var sessionId = (await session.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("sessionId").GetGuid();

        await client.PostAsJsonAsync("/api/queries", new
        {
            sessionId,
            sql = "SELECT 'historial' AS marca",
        });

        var history = await client.GetFromJsonAsync<JsonElement>("/api/history");

        var entry = history.EnumerateArray().First();

        Assert.Contains("historial", entry.GetProperty("sql").GetString(), StringComparison.Ordinal);
        Assert.True(entry.GetProperty("succeeded").GetBoolean());
        Assert.Equal(1, entry.GetProperty("rowCount").GetInt64());

        await client.DeleteAsync($"/api/sessions/{sessionId}");
    }

    [RequiresPostgreSqlFact]
    public async Task ElHistorialTambienGuardaLosFallos()
    {
        using var client = _factory.CreateAuthenticatedClient();

        await client.DeleteAsync("/api/history");

        var session = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest());
        var sessionId = (await session.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("sessionId").GetGuid();

        await client.PostAsJsonAsync("/api/queries", new { sessionId, sql = "SELECT * FROM" });

        var history = await client.GetFromJsonAsync<JsonElement>("/api/history");
        var entry = history.EnumerateArray().First();

        Assert.False(entry.GetProperty("succeeded").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(entry.GetProperty("errorMessage").GetString()));

        await client.DeleteAsync($"/api/sessions/{sessionId}");
    }

    [RequiresPostgreSqlFact]
    public async Task AbreSesionConUnaConexionGuardadaSinPedirLaContrasena()
    {
        using var client = _factory.CreateAuthenticatedClient();

        // Se guarda con la contraseña real del servidor de pruebas.
        var created = await client.PostAsJsonAsync("/api/connections", new
        {
            profile = new
            {
                name = $"Reutilizable {Guid.NewGuid():N}",
                engine = "postgresql",
                host = TestDatabase.Host,
                port = TestDatabase.Port,
                database = TestDatabase.Database,
                username = TestDatabase.Username,
            },
            password = TestDatabase.Password,
            storePassword = true,
        });

        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Y se abre sesión sin volver a enviarla: es el objetivo de la fase.
        var session = await client.PostAsJsonAsync($"/api/connections/{id}/sessions", new { });
        session.EnsureSuccessStatusCode();

        var body = await session.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = body.GetProperty("sessionId").GetGuid();

        Assert.NotEqual(Guid.Empty, sessionId);
        Assert.Equal(TestDatabase.Database, body.GetProperty("database").GetString());

        await client.DeleteAsync($"/api/sessions/{sessionId}");
        await client.DeleteAsync($"/api/connections/{id}");
    }

    [Fact]
    public async Task SinContrasenaGuardada_LaApiLaPide()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var created = await client.PostAsJsonAsync(
            "/api/connections",
            SaveRequest($"Sin clave {Guid.NewGuid():N}", storePassword: false));

        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var response = await client.PostAsJsonAsync($"/api/connections/{id}/sessions", new { });

        // 428: falta una condición previa, en este caso la contraseña.
        Assert.Equal(HttpStatusCode.PreconditionRequired, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("requiresPassword").GetBoolean());
    }
}
