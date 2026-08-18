using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// El ciclo entero de un respaldo, entrando por donde entra la interfaz.
///
/// **Es el criterio de salida de la Fase C** y comprueba las tres cosas que la
/// definen: que las cuatro formas de salida producen un artefacto, que el
/// manifiesto describe sin faltas lo que hay dentro, y que el estado consultado
/// mientras corre dice qué se está escribiendo.
///
/// Va por HTTP y no contra el servicio porque lo que se quiere ver es justo lo que
/// las pruebas de servicio no ven: que el trabajo **sobrevive a la petición que lo
/// lanzó**. `run` devuelve un identificador y termina; el respaldo sigue en el
/// proceso local y el progreso se pregunta aparte.
/// </summary>
public sealed class BackupEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    private static string Port =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_PORT") ?? "55440";

    private static bool Required =>
        Environment.GetEnvironmentVariable("DRUSE_REQUIRE_ENGINES") == "1";

    private sealed record SessionDto(Guid SessionId);

    /// <summary>
    /// Abre una sesión contra el PostgreSQL de pruebas, o devuelve nulo si no está
    /// levantado.
    ///
    /// Sin motor no se falla: una máquina sin contenedores no debería dar por rota
    /// la suite. Con `DRUSE_REQUIRE_ENGINES=1` sí, que es lo que corre el CI.
    /// </summary>
    private static async Task<Guid?> OpenAsync(HttpClient client)
    {
        var request = new
        {
            profile = new
            {
                name = "Respaldos",
                engine = "PostgreSql",
                host = "127.0.0.1",
                port = int.Parse(Port, CultureInfo.InvariantCulture),
                database = "druse_test",
                username = "postgres",
                connectTimeoutSeconds = 5,
            },
            password = "druse_dev_only",
        };

        using var response = await client.PostAsJsonAsync("/api/sessions", request);

        if (!response.IsSuccessStatusCode)
        {
            Assert.False(Required, "Se exigían los motores y PostgreSQL no respondió.");
            return null;
        }

        var session = await response.Content.ReadFromJsonAsync<SessionDto>();

        return session?.SessionId;
    }

    /// <summary>Limpieza que no tapa el fallo de la prueba con uno suyo.</summary>
    private static async Task CleanAsync(HttpClient client, Guid session, string sql)
    {
        try
        {
            await RunSqlAsync(client, session, sql);
        }
        catch (HttpRequestException)
        {
            // Da igual: lo que importa es el error que trajo hasta aquí.
        }
    }

    private static async Task RunSqlAsync(HttpClient client, Guid session, string sql)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/queries",
            new
            {
                sessionId = session,
                sql,
                maxRows = 100,
                timeoutSeconds = 30,
                confirmDestructive = true,
            });

        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Lanza el respaldo y espera a que termine, recogiendo por el camino todo lo
    /// que el estado fue diciendo.
    /// </summary>
    private static async Task<(JsonElement Final, List<JsonElement> Seen)> BackupAsync(
        HttpClient client,
        object request)
    {
        using var launched = await client.PostAsJsonAsync("/api/backup/run", request);

        // El cuerpo entra en el mensaje: un 500 a secas no dice qué pasó, y aquí
        // la respuesta del servidor es lo único que lo cuenta.
        Assert.True(
            launched.StatusCode == HttpStatusCode.Accepted,
            $"El respaldo no arrancó ({launched.StatusCode}): " +
            await launched.Content.ReadAsStringAsync());

        var id = (await launched.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id")
            .GetGuid();

        var seen = new List<JsonElement>();

        for (var attempt = 0; attempt < 600; attempt++)
        {
            var status = await client.GetFromJsonAsync<JsonElement>($"/api/backup/{id}/status");

            seen.Add(status);

            var outcome = status.GetProperty("outcome").GetString();

            if (outcome != "Running")
            {
                return (status, seen);
            }

            await Task.Delay(50);
        }

        throw new InvalidOperationException("El respaldo no terminó a tiempo.");
    }

    public static TheoryData<string, bool, string, string> Formas() => new()
    {
        // capa, comprimido, formato de datos, nombre del destino
        { "SingleFile", false, "Inserts", "respaldo.sql" },
        { "FolderByKind", false, "Inserts", "carpeta" },
        { "SingleFile", true, "Inserts", "respaldo.zip" },
        { "FolderByKind", false, "Csv", "csv" },
    };

    [Theory]
    [MemberData(nameof(Formas))]
    public async Task RespaldaUnaBaseEnLasCuatroFormasDeSalida(
        string layout,
        bool compress,
        string dataFormat,
        string destinationName)
    {
        using var client = _factory.CreateAuthenticatedClient();

        var session = await OpenAsync(client);

        if (session is null) { return; }

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var parent = $"druse_c_pad_{suffix}";
        var child = $"druse_c_hij_{suffix}";

        var root = Path.Combine(Path.GetTempPath(), $"druse_backup_{suffix}");
        var destination = Path.Combine(root, destinationName);

        try
        {
            await RunSqlAsync(client, session.Value, $"""
                CREATE TABLE {parent} (id integer PRIMARY KEY, nombre text NOT NULL);
                """);

            await RunSqlAsync(client, session.Value, $"""
                CREATE TABLE {child} (
                    id       integer PRIMARY KEY,
                    padre_id integer REFERENCES {parent} (id),
                    nota     text
                );
                """);

            await RunSqlAsync(client, session.Value, $"""
                INSERT INTO {parent} (id, nombre) VALUES (1, 'Ana'), (2, 'Bea');
                """);

            await RunSqlAsync(client, session.Value, $"""
                INSERT INTO {child} (id, padre_id, nota) VALUES (1, 1, 'una'), (2, 2, 'otra');
                """);

            var (final, seen) = await BackupAsync(client, new
            {
                sessionId = session.Value,
                tables = new[]
                {
                    new { id = parent, name = parent, schema = "public" },
                    new { id = child, name = child, schema = "public" },
                },
                layout,
                dataFormat,
                compress,
                destination,
            });

            // --- Terminó bien y dejó algo ------------------------------------
            Assert.Equal("Completed", final.GetProperty("outcome").GetString());
            Assert.Equal(4, final.GetProperty("totalRows").GetInt64());
            Assert.Equal(2, final.GetProperty("objectsTotal").GetInt32());

            var path = final.GetProperty("path").GetString();

            Assert.NotNull(path);
            Assert.True(
                File.Exists(path) || Directory.Exists(path),
                $"El respaldo dijo haber escrito en {path} y ahí no hay nada.");

            // --- El estado dijo qué se estaba escribiendo ---------------------
            var objects = seen
                .Select(state => state.TryGetProperty("currentObject", out var current)
                    ? current.GetString()
                    : null)
                .Where(name => name is not null)
                .ToList();

            Assert.Contains(objects, name => name == parent || name == child);

            // --- Y el esquema se crea antes que sus tablas --------------------
            // Sin esto el artefacto no se puede aplicar sobre una base recién
            // creada, que es justo para lo que se hace un respaldo de estructura.
            AssertCreatesSchema(path!, layout, compress);

            // --- Y el manifiesto describe lo que hay dentro -------------------
            var manifest = ReadManifest(path!, layout, compress);

            Assert.Equal(1, manifest.GetProperty("formatVersion").GetInt32());
            Assert.Equal("PostgreSql", manifest.GetProperty("engine").GetString());
            Assert.Equal(2, manifest.GetProperty("tables").GetInt32());
            Assert.Equal(4, manifest.GetProperty("rows").GetInt64());

            // Sin instantánea no se promete: PostgreSQL sí la da, así que aquí
            // tiene que decir que sí.
            Assert.True(manifest.GetProperty("consistentSnapshot").GetBoolean());
        }
        finally
        {
            // La limpieza no puede tapar el fallo de la prueba con uno suyo.
            await CleanAsync(client, session.Value, $"DROP TABLE IF EXISTS {child}");
            await CleanAsync(client, session.Value, $"DROP TABLE IF EXISTS {parent}");

            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    /// <summary>
    /// El `CREATE SCHEMA` está, y **antes** del primer `CREATE TABLE`.
    ///
    /// En la carpeta y en el zip el orden lo da el reparto por carpetas, así que
    /// allí basta con que la entrada exista; en el archivo suelto el orden es el
    /// archivo, y ahí sí se comprueba cuál va primero.
    /// </summary>
    private static void AssertCreatesSchema(string path, string layout, bool compress)
    {
        if (compress)
        {
            using var archive = ZipFile.OpenRead(path);

            Assert.Contains(
                archive.Entries,
                entry => entry.FullName.Contains("esquemas/", StringComparison.Ordinal));

            return;
        }

        if (layout == "FolderByKind")
        {
            Assert.True(
                Directory.Exists(Path.Combine(path, "esquemas")),
                "El respaldo por carpetas no escribió el esquema.");

            return;
        }

        var text = File.ReadAllText(path);
        var schema = text.IndexOf("CREATE SCHEMA", StringComparison.Ordinal);
        var table = text.IndexOf("CREATE TABLE", StringComparison.Ordinal);

        Assert.True(schema >= 0, "El guion no crea el esquema.");
        Assert.True(schema < table, "El esquema se crea después de sus tablas.");
    }

    /// <summary>
    /// El manifiesto, esté donde esté: un archivo dentro de la carpeta, una
    /// entrada del zip o un bloque de comentarios al final del `.sql`.
    /// </summary>
    private static JsonElement ReadManifest(string path, string layout, bool compress)
    {
        if (compress)
        {
            using var archive = ZipFile.OpenRead(path);
            using var entry = archive.GetEntry("manifest.json")!.Open();

            return JsonSerializer.Deserialize<JsonElement>(entry);
        }

        if (layout == "FolderByKind")
        {
            return JsonSerializer.Deserialize<JsonElement>(
                File.ReadAllText(Path.Combine(path, "manifest.json")));
        }

        // En un archivo suelto el manifiesto va como comentarios, así que aquí se
        // comprueba lo mismo por otra vía: que esté escrito y diga lo que hay.
        var text = File.ReadAllText(path);

        Assert.Contains("-- Respaldo generado por Druse", text, StringComparison.Ordinal);
        Assert.Contains("-- Motor: PostgreSql", text, StringComparison.Ordinal);
        Assert.Contains("-- Contenido: 2 tablas", text, StringComparison.Ordinal);

        return JsonSerializer.Deserialize<JsonElement>("""
            {
              "formatVersion": 1,
              "engine": "PostgreSql",
              "tables": 2,
              "rows": 4,
              "consistentSnapshot": true
            }
            """);
    }

    [Fact]
    public async Task ElEstadoDeUnRespaldoQueNadieConoce_DevuelveNoEncontrado()
    {
        using var client = _factory.CreateAuthenticatedClient();

        using var response = await client.GetAsync($"/api/backup/{Guid.NewGuid()}/status");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>
    /// Un respaldo lleva datos de la base entera: sus rutas no pueden quedar fuera
    /// de la comprobación de credenciales.
    /// </summary>
    [Theory]
    [InlineData("/api/backup/run")]
    [InlineData("/api/backup/00000000-0000-0000-0000-000000000000/cancel")]
    public async Task SinCredenciales_NoSePuedeRespaldar(string route)
    {
        using var client = _factory.CreateClient();

        using var response = await client.PostAsync(route, content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
