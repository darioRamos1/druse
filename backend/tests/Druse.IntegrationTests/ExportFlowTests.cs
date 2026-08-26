using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>Exportación por HTTP contra un motor real.</summary>
public sealed class ExportFlowTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;

    public ExportFlowTests(DruseApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<(HttpClient Client, Guid SessionId)> ConnectAsync()
    {
        var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest());
        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        return (client, body.GetProperty("sessionId").GetGuid());
    }

    [RequiresPostgreSqlFact]
    public async Task ExportaCsvConCabecerasYDatos()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/exports/csv", new
            {
                sessionId,
                sql = "SELECT 1 AS id, 'Ana' AS nombre UNION ALL SELECT 2, 'Luis' ORDER BY id",
            });

            response.EnsureSuccessStatusCode();

            var csv = await response.Content.ReadAsStringAsync();

            Assert.Contains("id,nombre", csv, StringComparison.Ordinal);
            Assert.Contains("1,Ana", csv, StringComparison.Ordinal);
            Assert.Contains("2,Luis", csv, StringComparison.Ordinal);

            Assert.Equal("text/csv", response.Content.Headers.ContentType?.MediaType);
            Assert.Contains("attachment", response.Content.Headers.ContentDisposition?.ToString() ?? "", StringComparison.Ordinal);

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task ExportaMasFilasDeLasQueMuestraLaCuadricula()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            // La cuadrícula se queda en 500 filas; exportar debe traerlas todas,
            // que es lo que el usuario espera al pulsar «Exportar».
            var response = await client.PostAsJsonAsync("/api/exports/csv", new
            {
                sessionId,
                sql = "SELECT generate_series(1, 2000) AS n",
            });

            response.EnsureSuccessStatusCode();

            var lines = (await response.Content.ReadAsStringAsync())
                .Split('\n', StringSplitOptions.RemoveEmptyEntries);

            // 2000 filas más la cabecera.
            Assert.Equal(2001, lines.Length);

            Assert.Equal("2000", response.TrailingHeaders.GetValues("X-Druse-Row-Count").Single());
            Assert.Equal("false", response.TrailingHeaders.GetValues("X-Druse-Truncated").Single());

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task ElCsvLlevaMarcaBomYConservaLosAcentos()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/exports/csv", new
            {
                sessionId,
                sql = "SELECT 'Lucía Gómez' AS nombre",
            });

            response.EnsureSuccessStatusCode();

            var bytes = await response.Content.ReadAsByteArrayAsync();

            // Sin BOM, Excel en Windows rompe los acentos.
            Assert.Equal([0xEF, 0xBB, 0xBF], bytes[..3]);
            Assert.Contains("Lucía Gómez", Encoding.UTF8.GetString(bytes), StringComparison.Ordinal);

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task ExportaXlsx()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/exports/xlsx", new
            {
                sessionId,
                sql = "SELECT 1 AS id, 'Ana' AS nombre",
                fileName = "usuarios",
            });

            response.EnsureSuccessStatusCode();

            var bytes = await response.Content.ReadAsByteArrayAsync();

            // Un XLSX es un ZIP: debe empezar por «PK».
            Assert.Equal([0x50, 0x4B], bytes[..2]);
            Assert.Contains("usuarios.xlsx", response.Content.Headers.ContentDisposition?.ToString() ?? "", StringComparison.Ordinal);

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task RespetaElLimiteDeFilasYLoAvisaEnLaCabecera()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/exports/csv", new
            {
                sessionId,
                sql = "SELECT generate_series(1, 500) AS n",
                maxRows = 50,
            });

            response.EnsureSuccessStatusCode();

            Assert.Equal("50", response.TrailingHeaders.GetValues("X-Druse-Row-Count").Single());
            Assert.Equal("true", response.TrailingHeaders.GetValues("X-Druse-Truncated").Single());

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task ExportarNoEsUnaViaParaSaltarseLasProtecciones()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/exports/csv", new
            {
                sessionId,
                sql = "DELETE FROM pg_class",
            });

            // Llamarlo «exportar» no cambia lo que hace la instrucción.
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("unconfirmeddestructive", body.GetProperty("reason").GetString());

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    /// <summary>
    /// El nombre del archivo puede no ser ASCII, y una cabecera HTTP sí lo exige.
    ///
    /// El nombre sale del título de la pestaña: en español lleva acentos, y una
    /// pestaña abierta con «Ver DDL» se titula <c>vista · DDL</c>. Puesto tal
    /// cual en `Content-Disposition`, Kestrel rechazaba la respuesta entera y la
    /// exportación moría con un 500 que no explicaba nada.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task ElNombreDelArchivoAdmiteAcentosYPuntoMedio()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var nombre = "análisis de año · DDL";

            var response = await client.PostAsJsonAsync("/api/exports/csv", new
            {
                sessionId,
                sql = "SELECT 1 AS id",
                fileName = nombre,
            });

            response.EnsureSuccessStatusCode();

            var disposition = response.Content.Headers.ContentDisposition?.ToString() ?? "";

            // El nombre de verdad viaja en `filename*`, en UTF-8 con porcentajes.
            Assert.Contains("filename*=utf-8''", disposition, StringComparison.OrdinalIgnoreCase);
            Assert.Contains(Uri.EscapeDataString(nombre + ".csv"), disposition, StringComparison.OrdinalIgnoreCase);

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    /// <summary>
    /// Exportar una definición no la ejecuta.
    ///
    /// Abrir una vista desde el explorador deja su CREATE VIEW en la pestaña.
    /// Exportarlo llegaba al motor: si la vista existía respondía con un error
    /// ilegible, y si no, **la creaba** dando la exportación por buena.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task ExportarUnaDefinicionSeRechazaYNoLaEjecuta()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/exports/csv", new
            {
                sessionId,
                sql = "CREATE VIEW v_no_deberia_crearse AS SELECT 1 AS uno",
            });

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("notexportable", body.GetProperty("reason").GetString());

            // Y lo que importa: no quedó creada.
            var check = await client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                sql = "SELECT COUNT(*) FROM pg_views WHERE viewname = 'v_no_deberia_crearse'",
            });

            check.EnsureSuccessStatusCode();

            var counted = await check.Content.ReadFromJsonAsync<JsonElement>();
            var value = counted.GetProperty("resultSets")[0].GetProperty("rows")[0][0].GetString();

            Assert.Equal("0", value);

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [RequiresPostgreSqlFact]
    public async Task AdmiteOtroSeparadorYTextoDeNulo()
    {
        var (client, sessionId) = await ConnectAsync();

        using (client)
        {
            var response = await client.PostAsJsonAsync("/api/exports/csv", new
            {
                sessionId,
                sql = "SELECT 1 AS a, NULL::text AS b",
                delimiter = ";",
                nullText = "NULL",
            });

            response.EnsureSuccessStatusCode();
            var csv = await response.Content.ReadAsStringAsync();

            Assert.Contains("a;b", csv, StringComparison.Ordinal);
            Assert.Contains("1;NULL", csv, StringComparison.Ordinal);

            await client.DeleteAsync($"/api/sessions/{sessionId}");
        }
    }

    [Fact]
    public async Task ExportarSinTokenSeRechaza()
    {
        using var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/exports/csv", new
        {
            sessionId = Guid.NewGuid(),
            sql = "SELECT 1",
        });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
