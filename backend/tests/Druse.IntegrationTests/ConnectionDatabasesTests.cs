using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Abrir una conexión sin saberse el nombre de la base.
///
/// Es lo que pasa siempre con un servidor ajeno: se tienen el host y la clave, y
/// el nombre de la base es justo lo que se venía a buscar. Aquí se comprueba lo
/// único que no se puede comprobar sin servidor: que la lista es la de verdad y
/// que la sesión queda abierta **contra la base elegida**, no contra la de
/// arranque.
/// </summary>
public sealed class ConnectionDatabasesTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    /// <summary>Las de PostgreSQL, que se dejan para el final al elegir.</summary>
    private static readonly string[] DelMotor = ["postgres", "template0", "template1"];

    /// <summary>Las que el usuario puede abrir, preguntadas sin abrir sesión.</summary>
    [RequiresPostgreSqlFact]
    public async Task ListaLasBasesQueSePuedenAbrir()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/connections/databases",
            TestDatabase.ConnectRequest(database: string.Empty));

        response.EnsureSuccessStatusCode();

        var databases = (await response.ReadJsonAsync())
            .GetProperty("databases")
            .EnumerateArray()
            .Select(database => database.GetString())
            .ToList();

        Assert.Contains(TestDatabase.Database, databases);
    }

    /// <summary>
    /// Sin base en el perfil, se entra por la primera a la que se tenga acceso.
    ///
    /// Y no basta con que la respuesta diga un nombre: se pregunta al motor por
    /// dónde está conectado de verdad, porque el fallo que importa —quedarse en la
    /// base de arranque y decir otra cosa— se vería igual desde fuera.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task SinBaseSeAbreLaPrimeraALaQueSeTieneAcceso()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/sessions",
            TestDatabase.ConnectRequest(database: string.Empty));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var session = await response.ReadJsonAsync();
        var sessionId = session.GetProperty("sessionId").GetGuid();
        var database = session.GetProperty("database").GetString();

        Assert.False(string.IsNullOrWhiteSpace(database));

        // `postgres` y las plantillas son del motor: se dejan para el final, y en
        // este servidor hay bases propias de sobra.
        Assert.DoesNotContain(database, DelMotor);

        Assert.Equal(database, await LeerAsync(client, sessionId, "SELECT current_database()"));
    }

    /// <summary>
    /// Y si el perfil sí nombra una base, se respeta.
    ///
    /// Quien la escribió sabrá por qué: elegir por él sería peor que no elegir.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task LaBaseEscritaEnElPerfilManda()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/sessions",
            TestDatabase.ConnectRequest(database: TestDatabase.SecondaryDatabase));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var session = await response.ReadJsonAsync();

        Assert.Equal(
            TestDatabase.SecondaryDatabase,
            session.GetProperty("database").GetString());

        Assert.Equal(
            TestDatabase.SecondaryDatabase,
            await LeerAsync(client, session.GetProperty("sessionId").GetGuid(), "SELECT current_database()"));
    }

    private static async Task<string> LeerAsync(HttpClient client, Guid sessionId, string sql)
    {
        var response = await client.PostAsJsonAsync("/api/queries", new
        {
            sessionId,
            executionId = Guid.NewGuid(),
            sql,
            maxRows = 1,
            timeoutSeconds = 30,
        });

        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        return body.GetProperty("resultSets")[0].GetProperty("rows")[0][0].GetString() ?? string.Empty;
    }
}
