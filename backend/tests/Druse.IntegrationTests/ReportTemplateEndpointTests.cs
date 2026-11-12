using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Hito 4.3 de Reportes BI: las plantillas se guardan, se listan y se borran,
/// y el servidor rechaza cualquiera que intente llevar SQL o filas.
/// </summary>
public sealed class ReportTemplateEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private const string Model = """{"format":"druse.report-template","version":1,"scope":"dashboard","fields":[]}""";

    [Fact]
    public async Task GuardaListaYBorraUnaPlantilla()
    {
        using var client = factory.CreateAuthenticatedClient();
        var id = Guid.NewGuid();

        var saved = await client.PutAsJsonAsync($"/api/reports/templates/{id}",
            new { name = " Ventas contra meta ", description = "Dos páginas", scope = "Dashboard", model = Model });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var body = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Ventas contra meta", body.GetProperty("name").GetString());
        Assert.Equal("Dashboard", body.GetProperty("scope").GetString());

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/reports/templates");
        var template = listed.EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == id);
        Assert.Equal(Model, template.GetProperty("model").GetString());
        Assert.Equal("Dos páginas", template.GetProperty("description").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/reports/templates/{id}")).StatusCode);
        Assert.DoesNotContain((await client.GetFromJsonAsync<JsonElement>("/api/reports/templates")).EnumerateArray(),
            item => item.GetProperty("id").GetGuid() == id);
    }

    [Theory]
    [InlineData("Dashboard", """{"reports":[{"sql":"SELECT * FROM ventas"}]}""")]
    [InlineData("Dashboard", "{roto")]
    [InlineData("Informe", Model)]
    [InlineData("1", Model)]
    public async Task RechazaSqlDiseñosRotosYAmbitosDesconocidos(string scope, string model)
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PutAsJsonAsync($"/api/reports/templates/{Guid.NewGuid()}",
            new { name = "Plantilla", scope, model });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
