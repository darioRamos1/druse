using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Druse.Application.Connections;
using Druse.Domain;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Druse.IntegrationTests;

/// <summary>
/// Hito 3 de Reportes BI: «Actualizar ahora», el resultado guardado y los reportes.
///
/// El criterio del plan: reabrir con las bases desconectadas; al reconectar y
/// actualizar, cambian los datos; si una fuente falla, se conserva el resultado
/// anterior.
/// </summary>
public sealed class ReportRefreshEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private const string VentasSql = """
        SELECT municipio, CAST(importe AS decimal(10,2)) AS venta
        FROM (VALUES ('05001', 80), ('08001', 100), ('11001', 40)) AS ventas(municipio, importe)
        """;

    [RequiresTwoEnginesFact]
    public async Task ConservaElResultadoSinConexionYSoloLoCambiaUnaActualizacionBuena()
    {
        var table = $"bi_metas_{Guid.NewGuid():N}";
        await PostgresAsync($"""
            CREATE TABLE {table} (municipio text PRIMARY KEY, meta numeric(10,2));
            INSERT INTO {table} VALUES ('05001', 100), ('08001', 200);
            """);
        try
        {
            using var client = factory.CreateAuthenticatedClient();
            var (ventas, metas) = Profiles();
            await SaveProfilesAsync(ventas, metas);
            var id = Guid.NewGuid();
            Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(
                $"/api/reports/datasets/{id}", Dataset(ventas.Id, metas.Id, table))).StatusCode);

            // 1. Primera actualización.
            var first = await RefreshAsync(client, id);
            Assert.Equal("Refreshed", first.GetProperty("outcome").GetString());
            Assert.Equal(3, first.GetProperty("run").GetProperty("rowCount").GetInt32());

            // 2. Sin las conexiones, el resultado se sigue leyendo: vive en reports.db.
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/connections/{ventas.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/connections/{metas.Id}")).StatusCode);
            Assert.Equal(100m, MetaDe(await SnapshotAsync(client, id), "05001"));

            // Y actualizar sin ellas falla sin tocarlo.
            var offline = await RefreshAsync(client, id);
            Assert.Equal("Failed", offline.GetProperty("outcome").GetString());
            Assert.All(offline.GetProperty("run").GetProperty("sources").EnumerateArray(),
                source => Assert.Equal("connection-missing", source.GetProperty("failureCode").GetString()));
            Assert.Equal(100m, MetaDe(await SnapshotAsync(client, id), "05001"));

            // 3. Al reconectar y actualizar, cambian los datos.
            await SaveProfilesAsync(ventas, metas);
            await PostgresAsync($"UPDATE {table} SET meta = 150 WHERE municipio = '05001'");
            Assert.Equal("Refreshed", (await RefreshAsync(client, id)).GetProperty("outcome").GetString());
            var snapshot = await SnapshotAsync(client, id);
            Assert.Equal(150m, MetaDe(snapshot, "05001"));
            Assert.False(snapshot.GetProperty("fromOlderDefinition").GetBoolean());

            // 4. Si una fuente falla, se conserva el resultado anterior.
            await PostgresAsync($"DROP TABLE {table}");
            var broken = await RefreshAsync(client, id);
            Assert.Equal("Failed", broken.GetProperty("outcome").GetString());
            var metasRead = broken.GetProperty("run").GetProperty("sources")[1];
            Assert.Equal("database-error", metasRead.GetProperty("failureCode").GetString());
            Assert.Equal(150m, MetaDe(await SnapshotAsync(client, id), "05001"));

            // Los intentos quedan contados, los más recientes primero.
            var runs = await client.GetFromJsonAsync<JsonElement>($"/api/reports/datasets/{id}/runs");
            Assert.Equal(
                ["Failed", "Succeeded", "Failed", "Succeeded"],
                runs.EnumerateArray().Select(run => run.GetProperty("status").GetString()!).ToArray());
        }
        finally
        {
            await PostgresAsync($"DROP TABLE IF EXISTS {table}");
        }
    }

    [RequiresTwoEnginesFact]
    public async Task CambiarLaDefinicionMarcaElResultadoComoDeUnaVersionAnterior()
    {
        using var client = factory.CreateAuthenticatedClient();
        var (ventas, metas) = Profiles();
        await SaveProfilesAsync(ventas, metas);
        var id = Guid.NewGuid();
        var dataset = Dataset(ventas.Id, metas.Id, table: null);
        await client.PutAsJsonAsync($"/api/reports/datasets/{id}", dataset);
        await RefreshAsync(client, id);

        await client.PutAsJsonAsync($"/api/reports/datasets/{id}", dataset with
        {
            Sources = [dataset.Sources[0] with { Sql = VentasSql + " WHERE municipio <> '11001'" }, dataset.Sources[1]],
        });

        var snapshot = await SnapshotAsync(client, id);
        Assert.True(snapshot.GetProperty("fromOlderDefinition").GetBoolean());
        Assert.Equal(1, snapshot.GetProperty("definitionVersion").GetInt64());
    }

    [Fact]
    public async Task GuardaLosReportesDeUnConjuntoYLosBorraConEl()
    {
        using var client = factory.CreateAuthenticatedClient();
        var datasetId = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(
            $"/api/reports/datasets/{datasetId}", Dataset(Guid.NewGuid(), Guid.NewGuid(), table: null))).StatusCode);
        var reportId = Guid.NewGuid();
        var report = new
        {
            datasetId,
            name = " Ventas por municipio ",
            visual = "Bar",
            settings = """{"category":"izquierda.municipio","value":"izquierda.venta","aggregate":"Sum"}""",
        };

        var saved = await client.PutAsJsonAsync($"/api/reports/reports/{reportId}", report);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal("Ventas por municipio", (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString());

        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PutAsJsonAsync($"/api/reports/reports/{Guid.NewGuid()}", report with { visual = "Pastel" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.PutAsJsonAsync($"/api/reports/reports/{Guid.NewGuid()}", report with { datasetId = Guid.NewGuid() })).StatusCode);

        var list = await client.GetFromJsonAsync<JsonElement>($"/api/reports/datasets/{datasetId}/reports");
        Assert.Equal("Bar", Assert.Single(list.EnumerateArray()).GetProperty("visual").GetString());

        // Sin resultado todavía: un estado normal, no un error.
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync($"/api/reports/datasets/{datasetId}/snapshot")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/reports/datasets/{Guid.NewGuid()}/snapshot")).StatusCode);

        await client.DeleteAsync($"/api/reports/datasets/{datasetId}");
        Assert.Empty((await client.GetFromJsonAsync<JsonElement>($"/api/reports/datasets/{datasetId}/reports")).EnumerateArray());
    }

    [Fact]
    public async Task GuardaReabreYBorraUnTableroYListaTodosLosReportes()
    {
        using var client = factory.CreateAuthenticatedClient();
        var datasetId = Guid.NewGuid();
        await client.PutAsJsonAsync($"/api/reports/datasets/{datasetId}", Dataset(Guid.NewGuid(), Guid.NewGuid(), table: null));
        var reportId = Guid.NewGuid();
        await client.PutAsJsonAsync($"/api/reports/reports/{reportId}", new
        {
            datasetId,
            name = "Cumplimiento",
            visual = "Indicator",
            settings = "{}",
        });

        var todos = await client.GetFromJsonAsync<JsonElement>("/api/reports/reports");
        Assert.Contains(todos.EnumerateArray(), report => report.GetProperty("id").GetGuid() == reportId);

        var id = Guid.NewGuid();
        var model = $$"""{"version":1,"pages":[{"id":"p1","panels":[{"id":"a","reportId":"{{reportId}}","width":6,"height":4}]}],"filters":[]}""";
        var saved = await client.PutAsJsonAsync($"/api/reports/dashboards/{id}", new { name = " Ventas 2026 ", model });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal("Ventas 2026", (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString());

        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PutAsJsonAsync($"/api/reports/dashboards/{Guid.NewGuid()}", new { name = "Roto", model = "{roto" })).StatusCode);

        var tableros = await client.GetFromJsonAsync<JsonElement>("/api/reports/dashboards");
        var tablero = tableros.EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == id);
        Assert.Equal(model, tablero.GetProperty("model").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/reports/dashboards/{id}")).StatusCode);
        Assert.DoesNotContain((await client.GetFromJsonAsync<JsonElement>("/api/reports/dashboards")).EnumerateArray(),
            item => item.GetProperty("id").GetGuid() == id);
    }

    private static async Task<JsonElement> RefreshAsync(HttpClient client, Guid id)
    {
        var response = await client.PostAsync($"/api/reports/datasets/{id}/refresh", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<JsonElement> SnapshotAsync(HttpClient client, Guid id)
    {
        var response = await client.GetAsync($"/api/reports/datasets/{id}/snapshot");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>La meta de un municipio en el cruce: columnas izquierda.municipio (0) y derecha.meta (3).</summary>
    private static decimal MetaDe(JsonElement snapshot, string municipio) =>
        snapshot.GetProperty("rows").EnumerateArray()
            .Single(row => row[0].GetString() == municipio)[3].GetDecimal();

    private static async Task PostgresAsync(string sql)
    {
        var connection = new NpgsqlConnectionStringBuilder
        {
            Host = TestDatabase.Host,
            Port = TestDatabase.Port,
            Database = TestDatabase.Database,
            Username = TestDatabase.Username,
            Password = TestDatabase.Password,
        }.ConnectionString;
        await using var source = NpgsqlDataSource.Create(connection);
        await using var command = source.CreateCommand(sql);
        await command.ExecuteNonQueryAsync();
    }

    private static (ConnectionProfile Ventas, ConnectionProfile Metas) Profiles() => (
        new ConnectionProfile
        {
            Id = Guid.NewGuid(),
            Name = $"Ventas BI {Guid.NewGuid():N}"[..20],
            Engine = DatabaseEngine.SqlServer,
            Host = TestSqlServer.Host,
            Port = TestSqlServer.Port,
            Database = TestSqlServer.Database,
            Username = TestSqlServer.Username,
            SslMode = Druse.Domain.SslMode.Require,
        },
        new ConnectionProfile
        {
            Id = Guid.NewGuid(),
            Name = $"Metas BI {Guid.NewGuid():N}"[..19],
            Engine = DatabaseEngine.PostgreSql,
            Host = TestDatabase.Host,
            Port = TestDatabase.Port,
            Database = TestDatabase.Database,
            Username = TestDatabase.Username,
        });

    private async Task SaveProfilesAsync(ConnectionProfile ventas, ConnectionProfile metas)
    {
        using var scope = factory.Services.CreateScope();
        var saved = scope.ServiceProvider.GetRequiredService<SavedConnectionService>();
        await saved.SaveAsync(ventas, TestSqlServer.Password, storePassword: true, CancellationToken.None);
        await saved.SaveAsync(metas, TestDatabase.Password, storePassword: true, CancellationToken.None);
    }

    private static DatasetRequest Dataset(Guid ventas, Guid metas, string? table) => new(
        "Ventas y metas",
        [
            new SourceRequest("Ventas", ventas, TestSqlServer.Database, "Sql", VentasSql),
            new SourceRequest("Metas", metas, TestDatabase.Database, "Sql", table is null
                ? "SELECT municipio, importe::numeric(10,2) AS meta FROM (VALUES ('05001', 100), ('08001', 200)) AS m(municipio, importe)"
                : $"SELECT municipio, meta FROM {table}"),
        ],
        new JoinRequest([new KeyRequest("municipio", "municipio")], "Left", "OneToOne"));

    private sealed record DatasetRequest(string Name, IReadOnlyList<SourceRequest> Sources, JoinRequest? Join);

    private sealed record SourceRequest(string Alias, Guid ConnectionId, string Database, string Mode, string Sql);

    private sealed record JoinRequest(IReadOnlyList<KeyRequest> Keys, string Kind, string Cardinality);

    private sealed record KeyRequest(string Left, string Right);
}
