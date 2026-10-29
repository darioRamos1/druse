using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Druse.Application.Abstractions;
using Microsoft.Extensions.DependencyInjection;

namespace Druse.IntegrationTests;

public sealed class HistoryEndpointTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;
    public HistoryEndpointTests(DruseApiFactory factory) => _factory = factory;

    [Theory]
    [InlineData("?before=2026-10-02T00:00:00Z")]
    [InlineData("?beforeId=00000000-0000-0000-0000-000000000001")]
    [InlineData("?from=2026-10-03T00:00:00Z&until=2026-10-02T00:00:00Z")]
    public async Task RechazaCursoresEIntervalosIncompletos(string query)
    {
        using var client = _factory.CreateAuthenticatedClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/history" + query)).StatusCode);
    }

    [Fact]
    public async Task FiltraYPaginaConservandoElContratoDeLista()
    {
        using var client = _factory.CreateAuthenticatedClient();
        using var scope = _factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IQueryHistoryStore>();
        await store.ClearAsync(CancellationToken.None);
        var date = DateTimeOffset.Parse("2026-10-02T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture);
        for (var i = 0; i < 3; i++)
        {
            await store.AddAsync(new QueryHistoryEntry { Id = Guid.NewGuid(), ConnectionName = "Local 100%", Database = "ventas_2026", Sql = $"SELECT {i}", ExecutedAtUtc = date, DurationMs = 1, Succeeded = false, ErrorMessage = "fallo" }, CancellationToken.None);
        }
        const string filters = "?limit=2&connection=100%25&database=ventas_&succeeded=false&from=2026-10-02T00:00:00Z&until=2026-10-03T00:00:00Z";
        var first = await client.GetFromJsonAsync<JsonElement>("/api/history" + filters);
        Assert.Equal(2, first.GetArrayLength());
        var last = first[1];
        var second = await client.GetFromJsonAsync<JsonElement>("/api/history" + filters + "&before=" + Uri.EscapeDataString(last.GetProperty("executedAtUtc").GetString()!) + "&beforeId=" + last.GetProperty("id").GetString());
        Assert.Equal(1, second.GetArrayLength());
        Assert.DoesNotContain(second[0].GetProperty("id").GetString(), first.EnumerateArray().Select(entry => entry.GetProperty("id").GetString()));
        Assert.Equal("ventas_2026", second[0].GetProperty("database").GetString());
    }
}
