using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Druse.IntegrationTests;

/// <summary>
/// Editar filas por HTTP, que es la primera vez que Druse escribe en los datos
/// del usuario.
///
/// Lo que se comprueba aquí no es que funcione —de eso se encargan las pruebas
/// contractuales contra los tres motores— sino **que las reglas no se pueden
/// saltar desde fuera**: sin confirmar, sin clave primaria o con la conexión en
/// solo lectura, la API tiene que negarse aunque la interfaz no lo impida.
/// </summary>
public sealed class RowEditFlowTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;

    public RowEditFlowTests(DruseApiFactory factory)
    {
        _factory = factory;
    }

    private async Task<(HttpClient Client, Guid SessionId)> ConnectAsync(bool readOnly = false)
    {
        var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest(readOnly));
        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        return (client, body.GetProperty("sessionId").GetGuid());
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

    private static object Table(string name) => new
    {
        id = $"Table:public.{name}",
        name,
        kind = "table",
        database = TestDatabase.Database,
        schema = "public",
        hasChildren = true,
    };

    private static object Edit(object table, Guid sessionId, string valor, bool confirmed = true) => new
    {
        sessionId,
        table,
        confirmed,
        edits = new[]
        {
            new
            {
                key = new[] { new { column = "id", value = "2" } },
                changes = new[] { new { column = "nombre", value = valor } },
            },
        },
    };

    [RequiresPostgreSqlFact]
    public async Task GuardaElCambioYDevuelveElSqlQueEjecuto()
    {
        var (client, sessionId) = await ConnectAsync();
        var tabla = $"druse_edit_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int PRIMARY KEY, nombre text)");
            await RunAsync(client, sessionId, $"INSERT INTO {tabla} VALUES (1, 'Ana'), (2, 'Bea')");

            var response = await client.PostAsJsonAsync("/api/rows", Edit(Table(tabla), sessionId, "Beatriz"));

            response.EnsureSuccessStatusCode();
            var body = await response.ReadJsonAsync();

            Assert.Equal(1, body.GetProperty("rowsAffected").GetInt64());

            var sql = body.GetProperty("statements")[0].GetString();
            Assert.Contains("UPDATE", sql, StringComparison.Ordinal);
            Assert.Contains("'Beatriz'", sql, StringComparison.Ordinal);
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
        var tabla = $"druse_edit_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int PRIMARY KEY, nombre text)");
            await RunAsync(client, sessionId, $"INSERT INTO {tabla} VALUES (1, 'Ana'), (2, 'Bea')");

            // Sin confirmar: la previsualización existe justo para el momento en
            // que el usuario todavía no ha dicho que sí.
            var preview = await client.PostAsJsonAsync(
                "/api/rows/preview",
                Edit(Table(tabla), sessionId, "Beatriz", confirmed: false));

            preview.EnsureSuccessStatusCode();

            var body = await preview.ReadJsonAsync();
            Assert.Contains("'Beatriz'", body.GetProperty("statements")[0].GetString(), StringComparison.Ordinal);

            // Y la tabla sigue como estaba.
            var check = await client.PostAsJsonAsync("/api/queries", new
            {
                sessionId,
                executionId = Guid.NewGuid(),
                sql = $"SELECT nombre FROM {tabla} WHERE id = 2",
                maxRows = 10,
                timeoutSeconds = 30,
            });

            var resultado = await check.ReadJsonAsync();
            Assert.Equal("Bea", resultado.GetProperty("resultSets")[0].GetProperty("rows")[0][0].GetString());
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    [RequiresPostgreSqlFact]
    public async Task SinConfirmar_NoGuarda()
    {
        var (client, sessionId) = await ConnectAsync();
        var tabla = $"druse_edit_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int PRIMARY KEY, nombre text)");
            await RunAsync(client, sessionId, $"INSERT INTO {tabla} VALUES (2, 'Bea')");

            var response = await client.PostAsJsonAsync(
                "/api/rows",
                Edit(Table(tabla), sessionId, "Beatriz", confirmed: false));

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.ReadJsonAsync();
            Assert.Equal("unconfirmed", body.GetProperty("reason").GetString());
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    [RequiresPostgreSqlFact]
    public async Task SinClavePrimaria_SeNiegaYLoExplica()
    {
        var (client, sessionId) = await ConnectAsync();
        var tabla = $"druse_edit_{Guid.NewGuid():N}";

        try
        {
            // Sin clave primaria no hay forma de señalar una fila concreta.
            await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int, nombre text)");
            await RunAsync(client, sessionId, $"INSERT INTO {tabla} VALUES (2, 'Bea')");

            var response = await client.PostAsJsonAsync("/api/rows", Edit(Table(tabla), sessionId, "Beatriz"));

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.ReadJsonAsync();
            Assert.Equal("noprimarykey", body.GetProperty("reason").GetString());
            Assert.Contains("clave primaria", body.GetProperty("message").GetString(), StringComparison.Ordinal);
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    [RequiresPostgreSqlFact]
    public async Task ConexionDeSoloLectura_NoEdita()
    {
        // La tabla se prepara con una conexión normal…
        var (admin, adminSession) = await ConnectAsync();
        var tabla = $"druse_edit_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(admin, adminSession, $"CREATE TABLE {tabla} (id int PRIMARY KEY, nombre text)");
            await RunAsync(admin, adminSession, $"INSERT INTO {tabla} VALUES (2, 'Bea')");

            // …y se intenta editar con una marcada de solo lectura.
            var (client, sessionId) = await ConnectAsync(readOnly: true);

            try
            {
                var response = await client.PostAsJsonAsync("/api/rows", Edit(Table(tabla), sessionId, "Beatriz"));

                Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

                var body = await response.ReadJsonAsync();
                Assert.Equal("readonlyconnection", body.GetProperty("reason").GetString());
            }
            finally
            {
                client.Dispose();
            }
        }
        finally
        {
            await RunAsync(admin, adminSession, $"DROP TABLE IF EXISTS {tabla}");
            admin.Dispose();
        }
    }

    [RequiresPostgreSqlFact]
    public async Task NoDejaCambiarLaClavePrimaria()
    {
        var (client, sessionId) = await ConnectAsync();
        var tabla = $"druse_edit_{Guid.NewGuid():N}";

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int PRIMARY KEY, nombre text)");
            await RunAsync(client, sessionId, $"INSERT INTO {tabla} VALUES (2, 'Bea')");

            var response = await client.PostAsJsonAsync("/api/rows", new
            {
                sessionId,
                table = Table(tabla),
                confirmed = true,
                edits = new[]
                {
                    new
                    {
                        key = new[] { new { column = "id", value = "2" } },
                        // Cambiar la clave es mover la fila; eso se hace con SQL
                        // a la vista, no arrastrando por una cuadrícula.
                        changes = new[] { new { column = "id", value = "99" } },
                    },
                },
            });

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.ReadJsonAsync();
            Assert.Equal("keymismatch", body.GetProperty("reason").GetString());
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }
}
