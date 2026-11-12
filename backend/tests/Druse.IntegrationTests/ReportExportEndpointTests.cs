using System.Net;
using System.Net.Http.Json;
using ClosedXML.Excel;

namespace Druse.IntegrationTests;

/// <summary>
/// Hito 4.4: la interfaz manda el tablero ya filtrado y la API devuelve el
/// libro. No hace falta ningún motor: el libro sale de lo que llega.
/// </summary>
public sealed class ReportExportEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private static object Labels() => new
    {
        summary = "Resumen",
        generated = "Generado",
        filters = "Filtros",
        noFilters = "Sin filtros",
        panel = "Panel",
        page = "Página",
        dataset = "Conjunto",
        capturedAt = "Datos del",
        value = "Cifra",
        target = "Meta",
        ratio = "Cumplimiento",
        data = "Datos",
    };

    private static object Document(int dataset = 0) => new
    {
        title = "Comercial",
        generatedAtUtc = "2026-11-11T18:00:00Z",
        filters = new[] { new { label = "Mes", value = "2026-01-01 – 2026-01-31" } },
        labels = Labels(),
        datasets = new[]
        {
            new
            {
                name = "Ventas",
                capturedAtUtc = "2026-11-11T15:00:02Z",
                table = new
                {
                    columns = new[] { new { name = "mes", type = "Date" }, new { name = "municipio", type = "Text" }, new { name = "venta", type = "Number" } },
                    rows = new[] { new object?[] { "2026-01-01", "05001", 80.5 }, new object?[] { "2026-01-01", "08001", null } },
                },
            },
        },
        panels = new[]
        {
            new
            {
                title = "Por municipio",
                page = "Página 1",
                dataset,
                chart = "Bar",
                color = "#2a78d6",
                figures = new
                {
                    columns = new[] { new { name = "municipio", type = "Text" }, new { name = "Suma · venta", type = "Number" } },
                    rows = new[] { new object?[] { "05001", 80.5 }, new object?[] { "08001", 0 } },
                },
            },
        },
    };

    [Fact]
    public async Task DevuelveElLibroConLasCeldasTipadas()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/reports/exports/xlsx", Document());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", response.Content.Headers.ContentType?.MediaType);

        using var workbook = new XLWorkbook(await response.Content.ReadAsStreamAsync());
        var datos = workbook.Worksheet("Datos · Ventas");
        Assert.Equal(new DateTime(2026, 1, 1), datos.Cell(5, 1).GetDateTime());
        Assert.Equal("05001", datos.Cell(5, 2).GetString());
        Assert.Equal(80.5, datos.Cell(5, 3).GetDouble());
        Assert.True(datos.Cell(6, 3).IsEmpty());
    }

    [Fact]
    public async Task RechazaUnPanelQueApuntaAUnConjuntoQueNoViene()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/reports/exports/xlsx", Document(dataset: 4));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
