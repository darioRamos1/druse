using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Druse.Application.Connections;
using Druse.Domain;
using Microsoft.Extensions.DependencyInjection;

namespace Druse.IntegrationTests;

public sealed class ReportDatasetEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private const string VentasSql = """
        SELECT CAST('2026-01-01' AS date) AS mes, municipio, CAST(SUM(importe) AS decimal(10,2)) AS venta
        FROM (VALUES ('05001', 30), ('05001', 50), ('08001', 100), ('11001', 40)) AS ventas(municipio, importe)
        GROUP BY municipio
        ORDER BY municipio
        """;

    private const string MetasSql = """
        SELECT DATE '2026-01-01' AS mes, municipio, importe::numeric(10,2) AS meta
        FROM (VALUES ('05001', 100), ('08001', 200)) AS metas(municipio, importe)
        """;

    [Fact]
    public async Task GuardaReabreYBorraUnConjuntoSinTocarLasBases()
    {
        using var client = factory.CreateAuthenticatedClient();
        var id = Guid.NewGuid();
        var dataset = Dataset(Guid.NewGuid(), Guid.NewGuid(), ventasVisual: true);

        var saved = await client.PutAsJsonAsync($"/api/reports/datasets/{id}", dataset);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal(1, (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("version").GetInt64());

        var reopened = await client.GetFromJsonAsync<JsonElement>($"/api/reports/datasets/{id}");
        var sources = reopened.GetProperty("sources");
        Assert.Equal("Visual", sources[0].GetProperty("mode").GetString());
        Assert.Equal("Sql", sources[1].GetProperty("mode").GetString());
        Assert.Equal("ManyToOne", reopened.GetProperty("join").GetProperty("cardinality").GetString());
        Assert.Contains(
            (await client.GetFromJsonAsync<JsonElement>("/api/reports/datasets")).EnumerateArray(),
            item => item.GetProperty("id").GetGuid() == id);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/reports/datasets/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/reports/datasets/{id}")).StatusCode);
    }

    [Fact]
    public async Task RechazaUnaDefinicionIncompletaOConEnumsDesconocidos()
    {
        using var client = factory.CreateAuthenticatedClient();
        var sinUnion = Dataset(Guid.NewGuid(), Guid.NewGuid(), ventasVisual: false) with { Join = null };
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PutAsJsonAsync($"/api/reports/datasets/{Guid.NewGuid()}", sinUnion)).StatusCode);

        var modoRaro = Dataset(Guid.NewGuid(), Guid.NewGuid(), ventasVisual: false);
        modoRaro = modoRaro with { Sources = [modoRaro.Sources[0] with { Mode = "Grafico" }, modoRaro.Sources[1]] };
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/reports/datasets/preview", modoRaro)).StatusCode);
    }

    [Fact]
    public async Task LaVistaPreviaSenalaLaFuenteCuyaConexionYaNoExiste()
    {
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/reports/datasets/preview",
            Dataset(Guid.NewGuid(), Guid.NewGuid(), ventasVisual: false));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();
        foreach (var source in preview.GetProperty("sources").EnumerateArray())
        {
            Assert.False(source.GetProperty("succeeded").GetBoolean());
            Assert.Equal("connection-missing", source.GetProperty("failureCode").GetString());
        }

        Assert.False(preview.GetProperty("join").GetProperty("succeeded").GetBoolean());
    }

    [Fact]
    public async Task LaVistaPreviaLeeDosFuentesAunqueTodaviaNoHayaUnion()
    {
        using var client = factory.CreateAuthenticatedClient();
        var sinUnion = Dataset(Guid.NewGuid(), Guid.NewGuid(), ventasVisual: false) with { Join = null };

        var response = await client.PostAsJsonAsync("/api/reports/datasets/preview", sinUnion);

        // Guardar la exige; previsualizar no, porque las columnas salen de aquí.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var preview = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, preview.GetProperty("sources").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, preview.GetProperty("join").ValueKind);
    }

    [Fact]
    public async Task ListaLasComposicionesDeUnaBaseSinFijarLaTabla()
    {
        using var client = factory.CreateAuthenticatedClient();

        // Las composiciones cuelgan de una conexión guardada; guardarla no la abre.
        var (connectionId, _) = await SaveProfilesAsync();
        foreach (var (table, name) in new[] { ("ventas", "Ventas por mes"), ("metas", "Metas por mes") })
        {
            var id = Guid.NewGuid();
            var saved = await client.PutAsJsonAsync($"/api/workspace/compositions/{id}", new
            {
                id,
                connectionId,
                database = "comercial",
                schema = "dbo",
                table,
                name,
                model = """{"sql":"SELECT 1","state":{}}""",
            });
            Assert.Equal(HttpStatusCode.NoContent, saved.StatusCode);
        }

        var todas = await client.GetFromJsonAsync<JsonElement>(
            $"/api/workspace/compositions?connectionId={connectionId}&database=comercial");
        var deUnaTabla = await client.GetFromJsonAsync<JsonElement>(
            $"/api/workspace/compositions?connectionId={connectionId}&database=comercial&schema=dbo&table=metas");

        Assert.Equal(2, todas.GetArrayLength());
        Assert.Equal("Metas por mes", Assert.Single(deUnaTabla.EnumerateArray()).GetProperty("name").GetString());
    }

    [Fact]
    public async Task LasBasesDeUnaConexionQueYaNoExisteDicenPorQue()
    {
        using var client = factory.CreateAuthenticatedClient();

        var list = await client.GetFromJsonAsync<JsonElement>($"/api/reports/connections/{Guid.NewGuid()}/databases");

        Assert.Equal(0, list.GetProperty("databases").GetArrayLength());
        Assert.Equal("connection-missing", list.GetProperty("failureCode").GetString());
    }

    [RequiresTwoEnginesFact]
    public async Task LasBasesDeUnaConexionGuardadaSeLeenConSuContrasenaGuardada()
    {
        var (_, metas) = await SaveProfilesAsync();
        using var client = factory.CreateAuthenticatedClient();

        var list = await client.GetFromJsonAsync<JsonElement>($"/api/reports/connections/{metas}/databases");

        Assert.Equal(JsonValueKind.Null, list.GetProperty("failureCode").ValueKind);
        Assert.Contains(list.GetProperty("databases").EnumerateArray(),
            database => database.GetString() == TestDatabase.Database);
    }

    [RequiresTwoEnginesFact]
    public async Task UnaFuenteVisualYOtraSqlPreparanElMismoCruceQueDosSql()
    {
        var (ventas, metas) = await SaveProfilesAsync();
        using var client = factory.CreateAuthenticatedClient();
        var id = Guid.NewGuid();
        var visual = Dataset(ventas, metas, ventasVisual: true);

        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/reports/datasets/{id}", visual)).StatusCode);
        var reopened = await client.GetFromJsonAsync<DatasetRequest>($"/api/reports/datasets/{id}");
        Assert.NotNull(reopened);

        var conVisual = await PreviewAsync(client, reopened);
        var soloSql = await PreviewAsync(client, Dataset(ventas, metas, ventasVisual: false));

        foreach (var source in conVisual.GetProperty("sources").EnumerateArray())
        {
            Assert.True(source.GetProperty("succeeded").GetBoolean(), source.GetProperty("message").GetString());
        }

        var join = conVisual.GetProperty("join");
        Assert.True(join.GetProperty("succeeded").GetBoolean(), join.GetProperty("message").GetString());
        Assert.Equal(3, join.GetProperty("rowCount").GetInt32());
        Assert.Equal(2, join.GetProperty("matchedRows").GetInt32());
        Assert.Equal(1, join.GetProperty("unmatchedLeftRows").GetInt32());
        Assert.Equal("05001", join.GetProperty("sampleRows")[0][1].GetString());
        Assert.Equal(220m, join.GetProperty("sampleRows").EnumerateArray().Sum(row => row[2].GetDecimal()));
        Assert.Equal(
            join.GetProperty("sampleRows").GetRawText(),
            soloSql.GetProperty("join").GetProperty("sampleRows").GetRawText());
    }

    [RequiresTwoEnginesFact]
    public async Task UnaMetaDuplicadaDetieneLaUnionYMuestraLaClave()
    {
        var (ventas, metas) = await SaveProfilesAsync();
        using var client = factory.CreateAuthenticatedClient();
        var dataset = Dataset(ventas, metas, ventasVisual: false);
        dataset = dataset with
        {
            Sources =
            [
                dataset.Sources[0],
                dataset.Sources[1] with
                {
                    Sql = """
                        SELECT DATE '2026-01-01' AS mes, municipio, importe::numeric(10,2) AS meta
                        FROM (VALUES ('05001', 100), ('05001', 120), ('08001', 200)) AS metas(municipio, importe)
                        """,
                },
            ],
        };

        var join = (await PreviewAsync(client, dataset)).GetProperty("join");

        Assert.False(join.GetProperty("succeeded").GetBoolean());
        Assert.Equal("2026-01-01 · 05001", Assert.Single(join.GetProperty("duplicateKeys").EnumerateArray()).GetString());
    }

    private static async Task<JsonElement> PreviewAsync(HttpClient client, DatasetRequest dataset)
    {
        var response = await client.PostAsJsonAsync("/api/reports/datasets/preview", dataset);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<(Guid Ventas, Guid Metas)> SaveProfilesAsync()
    {
        using var scope = factory.Services.CreateScope();
        var saved = scope.ServiceProvider.GetRequiredService<SavedConnectionService>();
        var ventas = new ConnectionProfile
        {
            Id = Guid.NewGuid(),
            Name = "Ventas BI de prueba",
            Engine = DatabaseEngine.SqlServer,
            Host = TestSqlServer.Host,
            Port = TestSqlServer.Port,
            Database = TestSqlServer.Database,
            Username = TestSqlServer.Username,
            SslMode = SslMode.Require,
        };
        var metas = new ConnectionProfile
        {
            Id = Guid.NewGuid(),
            Name = "Metas BI de prueba",
            Engine = DatabaseEngine.PostgreSql,
            Host = TestDatabase.Host,
            Port = TestDatabase.Port,
            Database = TestDatabase.Database,
            Username = TestDatabase.Username,
        };
        await saved.SaveAsync(ventas, TestSqlServer.Password, storePassword: true, CancellationToken.None);
        await saved.SaveAsync(metas, TestDatabase.Password, storePassword: true, CancellationToken.None);
        return (ventas.Id, metas.Id);
    }

    private static DatasetRequest Dataset(Guid ventas, Guid metas, bool ventasVisual) => new(
        "Ventas y metas",
        [
            new SourceRequest(
                "Ventas", ventas, TestSqlServer.Database, ventasVisual ? "Visual" : "Sql", VentasSql,
                ventasVisual ? """{"table":"ventas","groupBy":["mes","municipio"],"aggregates":[{"sum":"importe"}]}""" : null),
            new SourceRequest("Metas", metas, TestDatabase.Database, "Sql", MetasSql, null),
        ],
        new JoinRequest([new KeyRequest("mes", "mes"), new KeyRequest("municipio", "municipio")], "Left", "ManyToOne"));

    // Lo que escribe la interfaz a mano: nombres y enums como texto.
    private sealed record DatasetRequest(string Name, IReadOnlyList<SourceRequest> Sources, JoinRequest? Join);

    private sealed record SourceRequest(
        string Alias, Guid ConnectionId, string Database, string Mode, string Sql, string? VisualModel);

    private sealed record JoinRequest(IReadOnlyList<KeyRequest> Keys, string Kind, string Cardinality);

    private sealed record KeyRequest(string Left, string Right);
}
