using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Druse.IntegrationTests;

/// <summary>
/// Importar un archivo a una tabla, por HTTP.
///
/// Lo que se comprueba aquí no es que el CSV se lea bien —de eso hay pruebas
/// aparte— sino que **no se pueda importar a ciegas**: que la previsualización
/// no escriba, que los valores que no caben se enumeren antes en lugar de
/// reventar a mitad, y que sin confirmar no entre nada.
/// </summary>
public sealed class ImportFlowTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;

    public ImportFlowTests(DruseApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<(HttpClient Client, Guid SessionId)> ConnectAsync()
    {
        var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest());
        response.EnsureSuccessStatusCode();

        return (client, (await response.ReadJsonAsync()).GetProperty("sessionId").GetGuid());
    }

    private static async Task RunAsync(HttpClient client, Guid sessionId, string sql)
    {
        var response = await client.PostAsJsonAsync("/api/queries", new
        {
            sessionId,
            executionId = Guid.NewGuid(),
            sql,
            maxRows = 1,
            timeoutSeconds = 30,
            confirmDestructive = true,
        });

        response.EnsureSuccessStatusCode();
    }

    /// <summary>Arma el formulario tal y como lo mandará el navegador.</summary>
    private static MultipartFormDataContent Form(Guid sessionId, string tabla, string csv)
    {
        var content = new MultipartFormDataContent
        {
            { new StringContent(sessionId.ToString()), "sessionId" },
            {
                new StringContent(JsonSerializer.Serialize(new
                {
                    id = $"Table:public.{tabla}",
                    name = tabla,
                    kind = "table",
                    database = TestDatabase.Database,
                    schema = "public",
                    hasChildren = true,
                })),
                "table"
            },
            { new StringContent("true"), "hasHeaders" },
        };

        var archivo = new ByteArrayContent(Encoding.UTF8.GetBytes(csv));
        content.Add(archivo, "file", "datos.csv");

        return content;
    }

    private static async Task<int> ContarAsync(HttpClient client, Guid sessionId, string tabla)
    {
        var response = await client.PostAsJsonAsync("/api/queries", new
        {
            sessionId,
            executionId = Guid.NewGuid(),
            sql = $"SELECT COUNT(*) FROM {tabla}",
            maxRows = 1,
            timeoutSeconds = 30,
        });

        var body = await response.ReadJsonAsync();

        return int.Parse(
            body.GetProperty("resultSets")[0].GetProperty("rows")[0][0].GetString()!,
            System.Globalization.CultureInfo.InvariantCulture);
    }

    [RequiresPostgreSqlFact]
    public async Task ImportaLasFilasDelArchivo()
    {
        var (client, sessionId) = await ConnectAsync();
        var tabla = $"druse_imp_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int, nombre text, saldo numeric(10,2))");

            var response = await client.PostAsync(
                "/api/imports",
                Form(sessionId, tabla, "id,nombre,saldo\n1,Ana,10.50\n2,Bea,20.25\n"));

            response.EnsureSuccessStatusCode();

            var body = await response.ReadJsonAsync();
            Assert.Equal(2, body.GetProperty("rowsAffected").GetInt64());
            Assert.Equal(2, await ContarAsync(client, sessionId, tabla));
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    [RequiresPostgreSqlFact]
    public async Task LaPrevisualizacionNoEscribeNada()
    {
        var (client, sessionId) = await ConnectAsync();
        var tabla = $"druse_imp_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int, nombre text)");

            var response = await client.PostAsync(
                "/api/imports/preview",
                Form(sessionId, tabla, "id,nombre\n1,Ana\n"));

            response.EnsureSuccessStatusCode();

            var body = await response.ReadJsonAsync();
            Assert.Equal(1, body.GetProperty("rowCount").GetInt32());
            Assert.Contains("INSERT", body.GetProperty("statements")[0].GetString(), StringComparison.Ordinal);

            // Y la tabla sigue vacía: previsualizar es mirar, no hacer.
            Assert.Equal(0, await ContarAsync(client, sessionId, tabla));
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    [RequiresPostgreSqlFact]
    public async Task LosValoresQueNoCaben_SeEnumeranConSuFilaYSuColumna()
    {
        var (client, sessionId) = await ConnectAsync();
        var tabla = $"druse_imp_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int, nombre text)");

            var preview = await client.PostAsync(
                "/api/imports/preview",
                Form(sessionId, tabla, "id,nombre\n1,Ana\nx,Bea\n"));

            preview.EnsureSuccessStatusCode();

            var problems = (await preview.ReadJsonAsync()).GetProperty("problems");

            Assert.Equal(1, problems.GetArrayLength());
            Assert.Equal(2, problems[0].GetProperty("row").GetInt32());
            Assert.Equal("id", problems[0].GetProperty("column").GetString());

            // Y con un valor imposible dentro, no se importa nada: media
            // importación es peor que ninguna.
            var importar = await client.PostAsync(
                "/api/imports",
                Form(sessionId, tabla, "id,nombre\n1,Ana\nx,Bea\n"));

            Assert.Equal(HttpStatusCode.Conflict, importar.StatusCode);
            Assert.Equal(0, await ContarAsync(client, sessionId, tabla));
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    [RequiresPostgreSqlFact]
    public async Task LasColumnasQueNoExistenEnLaTablaSeQuedanFuera()
    {
        var (client, sessionId) = await ConnectAsync();
        var tabla = $"druse_imp_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int, nombre text)");

            var response = await client.PostAsync(
                "/api/imports/preview",
                Form(sessionId, tabla, "id,nombre,sobra\n1,Ana,lo que sea\n"));

            response.EnsureSuccessStatusCode();

            var mappings = (await response.ReadJsonAsync()).GetProperty("mappings");
            var sobra = mappings.EnumerateArray().Single(m => m.GetProperty("source").GetString() == "sobra");

            // Sin destino: colocarla por posición metería «lo que sea» en una
            // columna que no le corresponde.
            Assert.Equal(JsonValueKind.Null, sobra.GetProperty("target").ValueKind);
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    [RequiresPostgreSqlFact]
    public async Task AvisaDeLasColumnasObligatoriasQueNadieLlena()
    {
        var (client, sessionId) = await ConnectAsync();
        var tabla = $"druse_imp_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(
                client,
                sessionId,
                $"CREATE TABLE {tabla} (id int, nombre text, email text NOT NULL)");

            var response = await client.PostAsync(
                "/api/imports/preview",
                Form(sessionId, tabla, "id,nombre\n1,Ana\n"));

            response.EnsureSuccessStatusCode();

            var missing = (await response.ReadJsonAsync()).GetProperty("missingRequired");

            // Es la causa más común de que el motor rechace el lote entero, y se
            // sabe antes de intentarlo.
            Assert.Contains(
                missing.EnumerateArray().Select(item => item.GetString()),
                name => name == "email");
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }
}
