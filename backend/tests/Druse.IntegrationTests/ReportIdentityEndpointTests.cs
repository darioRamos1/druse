using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Identidades de empresa para los tableros: se guardan, se les pone y quita el
/// logo, y la API rechaza un logo que no sea una imagen de verdad o que no quepa.
/// </summary>
public sealed class ReportIdentityEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private static readonly string[] Datos = ["NIT 900.123.456-7", "Bogotá"];

    /// <summary>La cabecera de un PNG: firma e IHDR con ancho y alto.</summary>
    private static byte[] Png(int width, int height)
    {
        var data = new byte[33];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(data, 0);
        BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(8), 13);
        "IHDR"u8.CopyTo(data.AsSpan(12));
        BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(16), (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(20), (uint)height);
        return data;
    }

    [Fact]
    public async Task GuardaUnaIdentidadConLogoYLaBorra()
    {
        using var client = factory.CreateAuthenticatedClient();
        var id = Guid.NewGuid();

        var saved = await client.PutAsJsonAsync($"/api/reports/identities/{id}", new
        {
            name = " Comercial Andina ",
            subtitle = "Informe mensual",
            details = Datos,
            footer = "Confidencial",
            brandColor = "#0a6cbf",
            logoOnWhite = true,
        });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var body = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Comercial Andina", body.GetProperty("name").GetString());
        Assert.Equal("#0A6CBF", body.GetProperty("brandColor").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("logoUpdatedAtUtc").ValueKind);

        // El tipo que diga la petición no cuenta: lo deciden los bytes.
        var logo = await client.PutAsJsonAsync($"/api/reports/identities/{id}/logo",
            new { contentType = "image/gif", data = Convert.ToBase64String(Png(600, 200)) });
        Assert.Equal(HttpStatusCode.NoContent, logo.StatusCode);

        var read = await client.GetFromJsonAsync<JsonElement>($"/api/reports/identities/{id}/logo");
        Assert.Equal("image/png", read.GetProperty("contentType").GetString());
        Assert.Equal(Png(600, 200), Convert.FromBase64String(read.GetProperty("data").GetString()!));

        var listed = (await client.GetFromJsonAsync<JsonElement>("/api/reports/identities"))
            .EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == id);
        Assert.Equal(Datos, listed.GetProperty("details").EnumerateArray().Select(line => line.GetString()));
        Assert.NotEqual(JsonValueKind.Null, listed.GetProperty("logoUpdatedAtUtc").ValueKind);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/reports/identities/{id}/logo")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/reports/identities/{id}/logo")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/reports/identities/{id}")).StatusCode);
        Assert.DoesNotContain((await client.GetFromJsonAsync<JsonElement>("/api/reports/identities")).EnumerateArray(),
            item => item.GetProperty("id").GetGuid() == id);
    }

    [Theory]
    [InlineData("", null)]
    [InlineData("Empresa", "azul")]
    public async Task RechazaNombreVacioOColorInvalido(string name, string? color)
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PutAsJsonAsync($"/api/reports/identities/{Guid.NewGuid()}",
            new { name, brandColor = color });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith("server.reports.identity",
            body.GetProperty("messages")[0].GetProperty("key").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task RechazaUnLogoQueNoEsImagenONoCabe()
    {
        using var client = factory.CreateAuthenticatedClient();
        var id = Guid.NewGuid();
        await client.PutAsJsonAsync($"/api/reports/identities/{id}", new { name = "Empresa" });

        foreach (var data in new[]
        {
            Convert.ToBase64String(Encoding.UTF8.GetBytes("<svg><script>alert(1)</script></svg>")),
            Convert.ToBase64String(Png(1600, 200)),
            "esto no es base64",
        })
        {
            var response = await client.PutAsJsonAsync($"/api/reports/identities/{id}/logo", new { data });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        // Sin identidad, el logo no tiene dónde ir.
        var missing = await client.PutAsJsonAsync($"/api/reports/identities/{Guid.NewGuid()}/logo",
            new { data = Convert.ToBase64String(Png(10, 10)) });
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }
}
