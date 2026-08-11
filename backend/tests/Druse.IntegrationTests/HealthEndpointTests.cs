using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Druse.IntegrationTests;

/// <summary>
/// Criterio de salida de la Fase 0: la API local responde en /api/health.
/// Ver PLAN_TRABAJO_DRUSE.md §7 (API local propuesta).
/// </summary>
public sealed class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HealthEndpointTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task GetHealth_DevuelveOk()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task GetHealth_IdentificaAlProducto()
    {
        using var client = _factory.CreateClient();

        var payload = await client.GetFromJsonAsync<JsonElement>("/api/health");

        Assert.Equal("ok", payload.GetProperty("status").GetString());
        Assert.Equal("Druse", payload.GetProperty("product").GetString());
        Assert.False(string.IsNullOrWhiteSpace(payload.GetProperty("version").GetString()));
    }

    [Fact]
    public async Task GetHealth_NoFiltraSecretos()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync("/api/health");
        var body = await response.Content.ReadAsStringAsync();

        // Plan §12: ninguna respuesta puede exponer credenciales ni cadenas de conexión.
        Assert.DoesNotContain("password", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("connectionstring", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("pwd=", body, StringComparison.OrdinalIgnoreCase);
    }
}
