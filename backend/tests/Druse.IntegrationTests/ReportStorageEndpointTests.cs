using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>Hito 5.2 de Reportes BI: el espacio usado y borrar los datos guardados de un conjunto.</summary>
public sealed class ReportStorageEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    [Fact]
    public async Task CuentaElEspacioYBorraLosDatosSinBorrarElConjunto()
    {
        using var client = factory.CreateAuthenticatedClient();
        var id = Guid.NewGuid();
        var saved = await client.PutAsJsonAsync($"/api/reports/datasets/{id}", new
        {
            name = "Espacio",
            sources = new object[]
            {
                new { alias = "Ventas", connectionId = Guid.NewGuid(), database = "ventas", mode = "Sql", sql = "SELECT 1 AS uno" },
            },
        });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        var storage = await client.GetFromJsonAsync<JsonElement>("/api/reports/storage");
        Assert.Equal(512L * 1024 * 1024, storage.GetProperty("quotaBytes").GetInt64());
        Assert.True(storage.GetProperty("fileBytes").GetInt64() > 0);
        var entry = storage.GetProperty("datasets").EnumerateArray()
            .Single(item => item.GetProperty("datasetId").GetGuid() == id);
        Assert.Equal("Espacio", entry.GetProperty("name").GetString());
        Assert.Equal(0, entry.GetProperty("snapshotBytes").GetInt64());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("capturedAtUtc").ValueKind);

        // Sin resultado que borrar también es 204: el estado final es el pedido.
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/reports/datasets/{id}/snapshot")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/reports/datasets/{id}")).StatusCode);

        await client.DeleteAsync($"/api/reports/datasets/{id}");
    }
}
