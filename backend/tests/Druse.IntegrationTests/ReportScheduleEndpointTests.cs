using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Hito 5.1 de Reportes BI: programar, pausar y quitar la actualización de un
/// conjunto. El despacho en sí se prueba con el reloj en la mano en las
/// unitarias; aquí, el contrato y sus validaciones.
/// </summary>
public sealed class ReportScheduleEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private static readonly string[] ViernesYLunes = ["Friday", "Monday", "Monday"];

    [Fact]
    public async Task ProgramaPausaYQuitaLaActualizacion()
    {
        using var client = factory.CreateAuthenticatedClient();
        var id = await CrearConjuntoAsync(client);

        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync($"/api/reports/datasets/{id}/schedule")).StatusCode);

        var saved = await client.PutAsJsonAsync($"/api/reports/datasets/{id}/schedule", new
        {
            frequency = "Weekly",
            time = "07:30",
            days = ViernesYLunes,
            timeZone = "America/Bogota",
        });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var body = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Weekly", body.GetProperty("frequency").GetString());
        Assert.Equal("07:30", body.GetProperty("time").GetString());
        Assert.Equal(["Friday", "Monday"], body.GetProperty("days").EnumerateArray().Select(day => day.GetString()));
        Assert.False(body.GetProperty("running").GetBoolean());

        // 7:30 de Bogotá (UTC-5) es 12:30 UTC, un lunes o un viernes, y en el futuro.
        var next = body.GetProperty("nextRunUtc").GetDateTimeOffset();
        Assert.True(next > DateTimeOffset.UtcNow);
        Assert.Equal(new TimeSpan(12, 30, 0), next.UtcDateTime.TimeOfDay);
        Assert.True(next.UtcDateTime.DayOfWeek is DayOfWeek.Monday or DayOfWeek.Friday);

        var paused = await client.PutAsJsonAsync($"/api/reports/datasets/{id}/schedule", new
        {
            frequency = "Daily",
            time = "07:30",
            timeZone = "America/Bogota",
            paused = true,
        });
        var pausedBody = await paused.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(pausedBody.GetProperty("paused").GetBoolean());
        Assert.Equal(JsonValueKind.Null, pausedBody.GetProperty("nextRunUtc").ValueKind);
        Assert.Empty(pausedBody.GetProperty("days").EnumerateArray());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/reports/datasets/{id}/schedule")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync($"/api/reports/datasets/{id}/schedule")).StatusCode);
        await client.DeleteAsync($"/api/reports/datasets/{id}");
    }

    [Theory]
    [InlineData("Hourly", "07:00", "UTC", null)]
    [InlineData("1", "07:00", "UTC", null)]
    [InlineData("Daily", "7am", "UTC", null)]
    [InlineData("Daily", "25:00", "UTC", null)]
    [InlineData("Daily", "07:00", "Marte/Olympus", null)]
    [InlineData("Weekly", "07:00", "UTC", null)]
    [InlineData("Weekly", "07:00", "UTC", "Funday")]
    public async Task RechazaFrecuenciasHorasZonasYDiasNoValidos(string frequency, string time, string zone, string? day)
    {
        using var client = factory.CreateAuthenticatedClient();
        var id = await CrearConjuntoAsync(client);

        var response = await client.PutAsJsonAsync($"/api/reports/datasets/{id}/schedule", new
        {
            frequency,
            time,
            timeZone = zone,
            days = day is null ? Array.Empty<string>() : [day],
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await client.DeleteAsync($"/api/reports/datasets/{id}");
    }

    [Fact]
    public async Task NoSeProgramaUnConjuntoQueNoExiste()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PutAsJsonAsync($"/api/reports/datasets/{Guid.NewGuid()}/schedule",
            new { frequency = "Daily", time = "07:00", timeZone = "UTC" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private static async Task<Guid> CrearConjuntoAsync(HttpClient client)
    {
        var id = Guid.NewGuid();
        var response = await client.PutAsJsonAsync($"/api/reports/datasets/{id}", new
        {
            name = "Programado",
            sources = new object[]
            {
                new { alias = "Ventas", connectionId = Guid.NewGuid(), database = "ventas", mode = "Sql", sql = "SELECT municipio, venta FROM ventas" },
                new { alias = "Metas", connectionId = Guid.NewGuid(), database = "metas", mode = "Sql", sql = "SELECT municipio, meta FROM metas" },
            },
            join = new
            {
                keys = new[] { new { left = "municipio", right = "municipio" } },
                kind = "Left",
                cardinality = "ManyToOne",
            },
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return id;
    }
}
