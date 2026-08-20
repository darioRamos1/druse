using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Migraciones guardadas: se guardan, se listan y **se traen al presente**.
///
/// Lo que no se puede comprobar sin servidor es lo último. Un perfil guarda
/// nombres, y al abrirlo hay que volver a encontrarlos en dos catálogos que se han
/// movido: aquí se comprueba que encuentra lo que sigue estando y que dice, tabla
/// por tabla, qué ya no se puede migrar.
/// </summary>
public sealed class TransferProfileTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    /// <summary>Las dos tablas de los perfiles de ejemplo.</summary>
    private static readonly string[] DosTablas = ["clientes", "pedidos"];

    private static readonly string[] UnaTabla = ["clientes"];

    /// <summary>Guardar, releer de la lista y borrar.</summary>
    [RequiresPostgreSqlFact]
    public async Task ElPerfilSeGuardaSeListaYSeBorra()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var guardado = await GuardarAsync(client, Perfil($"Ventas a producción {Guid.NewGuid():N}"));
        var id = guardado.GetProperty("id").GetGuid();

        try
        {
            Assert.Equal("public", guardado.GetProperty("sourceSchema").GetString());
            Assert.Equal(["clientes", "pedidos"], Nombres(guardado.GetProperty("tables")));

            // Y aparece en la lista, que es de donde se abre.
            var lista = await client.GetAsync("/api/transfers/profiles");

            lista.EnsureSuccessStatusCode();

            Assert.Contains(
                (await lista.ReadJsonAsync()).EnumerateArray(),
                profile => profile.GetProperty("id").GetGuid() == id);
        }
        finally
        {
            var borrado = await client.DeleteAsync($"/api/transfers/profiles/{id}");

            Assert.Equal(HttpStatusCode.NoContent, borrado.StatusCode);
        }
    }

    /// <summary>
    /// Guardar un perfil ya existente no lo vuelve nuevo.
    ///
    /// La fecha de creación es del perfil, no de la última vez que se tocó: si se
    /// pisara, la lista dejaría de poder ordenarse por antigüedad y «lo creé en
    /// marzo» dejaría de ser verdad.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task RenombrarloNoLoVuelveNuevo()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var creado = await GuardarAsync(client, Perfil($"Antes {Guid.NewGuid():N}"));
        var id = creado.GetProperty("id").GetGuid();

        try
        {
            var renombrado = await GuardarAsync(client, new
            {
                id,
                name = "Después",
                sourceSchema = "public",
                targetSchema = "public",
                tables = UnaTabla,
                mode = "Upsert",
            });

            Assert.Equal("Después", renombrado.GetProperty("name").GetString());
            Assert.Equal("Upsert", renombrado.GetProperty("mode").GetString());
            Assert.Equal(
                creado.GetProperty("createdAtUtc").GetDateTimeOffset(),
                renombrado.GetProperty("createdAtUtc").GetDateTimeOffset());
        }
        finally
        {
            await client.DeleteAsync($"/api/transfers/profiles/{id}");
        }
    }

    /// <summary>
    /// Abrirlo es resolverlo contra dos conexiones vivas.
    ///
    /// Lo que importa es que **no se niega a abrirlo** cuando algo falta: devuelve
    /// lo que sí se puede migrar y dice, con su nombre, lo que no.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task AlAbrirloDiceQueSiguePudiendoseMigrarYQueNo()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var sesion = await OpenAsync(client);
        var esquema = $"druse_perfil_{Guid.NewGuid():N}";
        var viva = Nombre();
        var perdida = Nombre();

        var creado = await GuardarAsync(client, new
        {
            name = $"Perfil {Guid.NewGuid():N}",
            sourceSchema = "public",
            targetSchema = esquema,
            tables = new[] { viva, perdida },
            mode = "Insert",
        });

        var id = creado.GetProperty("id").GetGuid();

        try
        {
            await RunAsync(client, sesion, $"CREATE TABLE {viva} (id int)");
            await RunAsync(client, sesion, $"CREATE TABLE {perdida} (id int)");
            await RunAsync(client, sesion, $"CREATE SCHEMA {esquema}");

            // En el destino solo está una de las dos: la otra es el hueco.
            await RunAsync(client, sesion, $"CREATE TABLE {esquema}.{viva} (id int)");

            var response = await client.PostAsJsonAsync(
                $"/api/transfers/profiles/{id}/resolve",
                new { sourceSessionId = sesion, targetSessionId = sesion });

            response.EnsureSuccessStatusCode();

            var resolucion = await response.ReadJsonAsync();
            var tablas = resolucion.GetProperty("tables").EnumerateArray().ToList();
            var huecos = resolucion.GetProperty("gaps").EnumerateArray().ToList();

            Assert.Single(tablas);
            Assert.Equal(viva, tablas[0].GetProperty("source").GetProperty("name").GetString());
            Assert.Equal(esquema, tablas[0].GetProperty("target").GetProperty("schema").GetString());

            Assert.Single(huecos);
            Assert.Equal(perdida, huecos[0].GetProperty("table").GetString());
            Assert.Contains("no existe en el destino", huecos[0].GetProperty("reason").GetString()!);

            Assert.True(resolucion.GetProperty("hasChanges").GetBoolean());
        }
        finally
        {
            await RunAsync(client, sesion, $"DROP SCHEMA IF EXISTS {esquema} CASCADE");
            await RunAsync(client, sesion, $"DROP TABLE IF EXISTS {viva}");
            await RunAsync(client, sesion, $"DROP TABLE IF EXISTS {perdida}");
            await client.DeleteAsync($"/api/transfers/profiles/{id}");
        }
    }

    /// <summary>
    /// Anotar que se lanzó no toca el resto del perfil.
    ///
    /// Guardarlo entero al ejecutarlo daría por buenos los cambios que el usuario
    /// tuviera a medias en la pantalla.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task AnotarQueSeLanzoNoCambiaNadaMas()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var creado = await GuardarAsync(client, Perfil($"Perfil {Guid.NewGuid():N}"));
        var id = creado.GetProperty("id").GetGuid();

        try
        {
            Assert.Equal(JsonValueKind.Null, creado.GetProperty("lastRunAtUtc").ValueKind);

            var marcado = await client.PostAsync($"/api/transfers/profiles/{id}/ran", null);

            Assert.Equal(HttpStatusCode.NoContent, marcado.StatusCode);

            var releido = await client.GetAsync($"/api/transfers/profiles/{id}");

            releido.EnsureSuccessStatusCode();

            var perfil = await releido.ReadJsonAsync();

            Assert.NotEqual(JsonValueKind.Null, perfil.GetProperty("lastRunAtUtc").ValueKind);
            Assert.Equal(
                creado.GetProperty("name").GetString(),
                perfil.GetProperty("name").GetString());
            Assert.Equal(["clientes", "pedidos"], Nombres(perfil.GetProperty("tables")));
        }
        finally
        {
            await client.DeleteAsync($"/api/transfers/profiles/{id}");
        }
    }

    /// <summary>
    /// Lo que cada tabla hace distinto se guarda con el perfil.
    ///
    /// Olvidarlo sería peligroso: un perfil que perdiera el filtro se llevaría la
    /// tabla entera la próxima vez, sin que nadie lo pidiera.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task GuardaLoQueCadaTablaHaceDistinto()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var creado = await GuardarAsync(client, new
        {
            name = $"Perfil {Guid.NewGuid():N}",
            sourceSchema = "public",
            targetSchema = "public",
            tables = DosTablas,
            mode = "Insert",
            tableOptions = new Dictionary<string, object>
            {
                ["pedidos"] = new { mode = "Upsert", where = "anio = 2026" },
            },
        });

        var id = creado.GetProperty("id").GetGuid();

        try
        {
            var releido = await client.GetAsync($"/api/transfers/profiles/{id}");

            releido.EnsureSuccessStatusCode();

            var opciones = (await releido.ReadJsonAsync())
                .GetProperty("tableOptions")
                .GetProperty("pedidos");

            Assert.Equal("Upsert", opciones.GetProperty("mode").GetString());
            Assert.Equal("anio = 2026", opciones.GetProperty("where").GetString());
        }
        finally
        {
            await client.DeleteAsync($"/api/transfers/profiles/{id}");
        }
    }

    /// <summary>Un perfil sin tablas no se guarda: no repetiría nada.</summary>
    [RequiresPostgreSqlFact]
    public async Task UnPerfilSinTablasSeRechaza()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/transfers/profiles",
            new { name = "Vacío", tables = Array.Empty<string>() });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>Y un modo que no existe tampoco cae en el de por omisión.</summary>
    [RequiresPostgreSqlFact]
    public async Task UnModoDesconocidoSeRechaza()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/transfers/profiles",
            new { name = "Raro", tables = UnaTabla, mode = "Sustituir" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // -----------------------------------------------------------------------
    // Andamiaje
    // -----------------------------------------------------------------------

    private static object Perfil(string name) => new
    {
        name,
        sourceSchema = "public",
        targetSchema = "public",
        tables = DosTablas,
        mode = "Insert",
    };

    private static async Task<JsonElement> GuardarAsync(HttpClient client, object profile)
    {
        var response = await client.PostAsJsonAsync("/api/transfers/profiles", profile);

        response.EnsureSuccessStatusCode();

        return await response.ReadJsonAsync();
    }

    private static IReadOnlyList<string> Nombres(JsonElement array) =>
        [.. array.EnumerateArray().Select(item => item.GetString() ?? string.Empty)];

    private static string Nombre() => $"druse_perf_{Guid.NewGuid():N}";

    private static async Task<Guid> OpenAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest());

        response.EnsureSuccessStatusCode();

        return (await response.ReadJsonAsync()).GetProperty("sessionId").GetGuid();
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
}
