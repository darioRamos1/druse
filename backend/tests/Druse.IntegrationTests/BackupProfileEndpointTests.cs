using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Perfiles de respaldo: guardarlos y **abrirlos meses después**.
///
/// Es el criterio de salida de la Fase E, y lo que se comprueba es justo lo que
/// no se puede comprobar sin una base de verdad: que un perfil guardado reproduce
/// el mismo respaldo, y que uno cuyos objetos cambiaron lo dice sin romperse.
///
/// Los perfiles guardan una intención —«este esquema entero y esta tabla»— y la
/// base se mueve debajo, así que aquí la base se mueve a propósito: se borra una
/// tabla nombrada y se crea otra dentro del esquema elegido.
/// </summary>
public sealed class BackupProfileEndpointTests(DruseApiFactory factory)
    : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    private static string Port =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_PORT") ?? "55440";

    private static bool Required =>
        Environment.GetEnvironmentVariable("DRUSE_REQUIRE_ENGINES") == "1";

    private sealed record SessionDto(Guid SessionId);

    private static async Task<Guid?> OpenAsync(HttpClient client)
    {
        var request = new
        {
            profile = new
            {
                name = "Perfiles",
                engine = "PostgreSql",
                host = "127.0.0.1",
                port = int.Parse(Port, System.Globalization.CultureInfo.InvariantCulture),
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

        return (await response.Content.ReadFromJsonAsync<SessionDto>())?.SessionId;
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

    /// <summary>Limpieza que no tapa el fallo de la prueba con uno suyo.</summary>
    private static async Task CleanAsync(HttpClient client, Guid session, string sql)
    {
        try
        {
            await RunSqlAsync(client, session, sql);
        }
        catch (HttpRequestException)
        {
            // Si la prueba ya falló, su fallo es el que importa.
        }
    }

    private static async Task<JsonElement> SaveAsync(HttpClient client, object profile)
    {
        using var response = await client.PostAsJsonAsync("/api/backup/profiles", profile);

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task UnPerfilGuardadoSeGuardaEnteroYSeVuelveAListar()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var saved = await SaveAsync(client, new
        {
            name = "Estructura a desarrollo",
            database = "druse_test",
            selection = new[]
            {
                new { kind = "Schema", schema = "public", name = (string?)null },
            },
            dataMode = "StructureOnly",
            dataOverrides = new Dictionary<string, string> { ["public.catalogo"] = "StructureAndData" },
            layout = "SingleFile",
            dataFormat = "Inserts",
            compress = false,
            destination = @"C:\respaldos\desarrollo.sql",
        });

        var id = saved.GetProperty("id").GetGuid();

        try
        {
            Assert.Equal("Estructura a desarrollo", saved.GetProperty("name").GetString());
            Assert.Equal("StructureOnly", saved.GetProperty("dataMode").GetString());
            Assert.Equal(
                "StructureAndData",
                saved.GetProperty("dataOverrides").GetProperty("public.catalogo").GetString());

            // El esquema vuelve como esquema: si al releerlo se hubiera convertido
            // en la lista de sus tablas, el perfil dejaría de recoger lo nuevo.
            var selector = saved.GetProperty("selection")[0];

            Assert.Equal("Schema", selector.GetProperty("kind").GetString());
            Assert.Equal("public", selector.GetProperty("schema").GetString());

            using var list = await client.GetAsync("/api/backup/profiles");

            list.EnsureSuccessStatusCode();

            var all = await list.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Contains(
                all.EnumerateArray(),
                profile => profile.GetProperty("id").GetGuid() == id);
        }
        finally
        {
            using var deleted = await client.DeleteAsync($"/api/backup/profiles/{id}");

            Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        }
    }

    [Fact]
    public async Task GuardarSinNombre_NoCreaNada()
    {
        using var client = _factory.CreateAuthenticatedClient();

        using var response = await client.PostAsJsonAsync(
            "/api/backup/profiles",
            new { name = "   ", destination = "x.sql" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ResolverUnPerfilQueNoExiste_DevuelveNoEncontrado()
    {
        using var client = _factory.CreateAuthenticatedClient();

        using var response = await client.PostAsJsonAsync(
            $"/api/backup/profiles/{Guid.NewGuid()}/resolve",
            new { sessionId = Guid.NewGuid() });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>
    /// El criterio de salida: un perfil de hace medio año se abre igual, y dice
    /// qué falta y qué ha aparecido.
    ///
    /// Se guarda con un esquema entero más una tabla nombrada, y después se mueve
    /// la base debajo: la tabla nombrada se borra y dentro del esquema aparece
    /// otra. Abrirlo tiene que seguir dando un respaldo lanzable.
    /// </summary>
    [Fact]
    public async Task UnPerfilConObjetosDesaparecidosSeAbreYDiceQuéFalta()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var session = await OpenAsync(client);

        if (session is null) { return; }

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var schema = $"druse_perf_{suffix}";
        var quedan = $"{schema}.quedan";
        var seVa = $"{schema}.se_va";
        var nueva = $"{schema}.nueva";
        Guid? id = null;

        try
        {
            await RunSqlAsync(client, session.Value, $"CREATE SCHEMA {schema};");
            await RunSqlAsync(client, session.Value, $"CREATE TABLE {quedan} (id integer PRIMARY KEY);");
            await RunSqlAsync(client, session.Value, $"CREATE TABLE {seVa} (id integer PRIMARY KEY);");

            var saved = await SaveAsync(client, new
            {
                name = $"Perfil {suffix}",
                database = "druse_test",
                selection = new object[]
                {
                    new { kind = "Schema", schema, name = (string?)null },
                    new { kind = "Table", schema, name = "se_va" },
                },
                dataMode = "StructureOnly",
                layout = "SingleFile",
                dataFormat = "Inserts",
                destination = @"C:\respaldos\perfil.sql",
                // Lo que resolvía al guardarlo: es la memoria con la que después
                // se dice qué ha aparecido.
                knownTables = new[] { $"{schema}.quedan", $"{schema}.se_va" },
            });

            id = saved.GetProperty("id").GetGuid();

            // --- La base se mueve debajo -------------------------------------
            await RunSqlAsync(client, session.Value, $"DROP TABLE {seVa};");
            await RunSqlAsync(client, session.Value, $"CREATE TABLE {nueva} (id integer PRIMARY KEY);");

            using var response = await client.PostAsJsonAsync(
                $"/api/backup/profiles/{id}/resolve",
                new { sessionId = session.Value });

            response.EnsureSuccessStatusCode();

            var resolution = await response.Content.ReadFromJsonAsync<JsonElement>();

            // Se abre, y lo que queda es lanzable: las dos tablas que hoy existen.
            var tables = resolution.GetProperty("tables")
                .EnumerateArray()
                .Select(table => table.GetProperty("name").GetString())
                .ToList();

            Assert.Contains("quedan", tables);
            Assert.Contains("nueva", tables);
            Assert.DoesNotContain("se_va", tables);

            // Y dice qué se perdió, con el nombre que el usuario reconoce.
            var gap = Assert.Single(resolution.GetProperty("gaps").EnumerateArray());

            Assert.Equal("se_va", gap.GetProperty("selector").GetProperty("name").GetString());
            Assert.Contains("ya no existe", gap.GetProperty("reason").GetString()!, StringComparison.Ordinal);

            // Y qué ha aparecido dentro del esquema que se eligió entero, que es
            // lo que se pidió al marcarlo pero nadie recuerda medio año después.
            Assert.Equal(
                [$"{schema}.nueva"],
                resolution.GetProperty("added").EnumerateArray().Select(item => item.GetString()));
        }
        finally
        {
            if (id is not null)
            {
                using var deleted = await client.DeleteAsync($"/api/backup/profiles/{id}");
            }

            await CleanAsync(client, session.Value, $"DROP SCHEMA IF EXISTS {schema} CASCADE;");
        }
    }

    /// <summary>
    /// Un esquema entero que ya no está no rompe el perfil: se dice y se sigue.
    ///
    /// Pasa de verdad cuando alguien renombra un esquema, y es el caso en que
    /// fallar dejaría al usuario sin poder ni abrir lo que guardó.
    /// </summary>
    [Fact]
    public async Task UnEsquemaDesaparecidoSeCuentaSinTirarLaResolución()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var session = await OpenAsync(client);

        if (session is null) { return; }

        var saved = await SaveAsync(client, new
        {
            name = $"Fantasma {Guid.NewGuid():N}",
            database = "druse_test",
            selection = new[]
            {
                new { kind = "Schema", schema = "no_existe_este_esquema", name = (string?)null },
            },
            dataMode = "StructureOnly",
            layout = "SingleFile",
            dataFormat = "Inserts",
            destination = @"C:\respaldos\fantasma.sql",
        });

        var id = saved.GetProperty("id").GetGuid();

        try
        {
            using var response = await client.PostAsJsonAsync(
                $"/api/backup/profiles/{id}/resolve",
                new { sessionId = session.Value });

            response.EnsureSuccessStatusCode();

            var resolution = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Empty(resolution.GetProperty("tables").EnumerateArray());

            var gap = Assert.Single(resolution.GetProperty("gaps").EnumerateArray());

            Assert.Contains(
                "no_existe_este_esquema",
                gap.GetProperty("reason").GetString()!,
                StringComparison.Ordinal);
        }
        finally
        {
            using var deleted = await client.DeleteAsync($"/api/backup/profiles/{id}");
        }
    }

    /// <summary>
    /// Lanzar un perfil se anota, y guardar uno no se lleva por delante esa marca.
    ///
    /// De esa fecha vive el orden de la lista, que es lo primero que ve quien
    /// vuelve a hacer el respaldo de todas las semanas.
    /// </summary>
    [Fact]
    public async Task AnotarQueSeLanzóNoRequiereGuardarElPerfilEntero()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var saved = await SaveAsync(client, new
        {
            name = $"Semanal {Guid.NewGuid():N}",
            selection = Array.Empty<object>(),
            dataMode = "StructureAndData",
            layout = "SingleFile",
            dataFormat = "Inserts",
            destination = @"C:\respaldos\semanal.sql",
        });

        var id = saved.GetProperty("id").GetGuid();

        try
        {
            Assert.True(
                saved.GetProperty("lastRunAtUtc").ValueKind is JsonValueKind.Null or JsonValueKind.Undefined,
                "Un perfil recién guardado no se ha lanzado nunca.");

            using var ran = await client.PostAsJsonAsync($"/api/backup/profiles/{id}/ran", new { });

            Assert.Equal(HttpStatusCode.NoContent, ran.StatusCode);

            using var response = await client.GetAsync($"/api/backup/profiles/{id}");

            response.EnsureSuccessStatusCode();

            var profile = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.NotEqual(JsonValueKind.Null, profile.GetProperty("lastRunAtUtc").ValueKind);
        }
        finally
        {
            using var deleted = await client.DeleteAsync($"/api/backup/profiles/{id}");
        }
    }
}
