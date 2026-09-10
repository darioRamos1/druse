using System.Net;
using System.Net.Http.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Crear una base desde el formulario, por donde entra la interfaz.
///
/// **No necesita ningún servidor**: el único motor que sabe hacerlo es el que es
/// un archivo. Y por eso mismo es de las pocas pruebas de integración que corren
/// siempre, en cualquier máquina.
///
/// Lo que se comprueba aquí y no en el proveedor es el camino entero: que el
/// formulario pueda pedirlo, que el perfil se valide antes, y que un motor que no
/// sabe reciba un no con su motivo en vez de un error del servidor.
/// </summary>
public sealed class CreateDatabaseEndpointTests(DruseApiFactory factory)
    : IClassFixture<DruseApiFactory>, IDisposable
{
    private readonly DruseApiFactory _factory = factory;

    private readonly string _carpeta = Path.Combine(
        Path.GetTempPath(),
        $"druse-api-crear-{Guid.NewGuid():N}");

    public void Dispose()
    {
        try
        {
            Directory.Delete(_carpeta, recursive: true);
        }
        catch (IOException)
        {
            // El sistema se lleva su carpeta temporal cuando le toca.
        }
    }

    /// <summary>
    /// La petición del formulario.
    ///
    /// Un nombre vacío deja la ruta vacía, no la carpeta: `Path.Combine` con una
    /// cadena vacía devuelve el directorio, y entonces la prueba de «sin ruta»
    /// estaría mandando una ruta perfectamente válida.
    /// </summary>
    private object Request(string archivo, string engine = "sqlite") => new
    {
        profile = new
        {
            name = "SQLite",
            engine,
            host = string.Empty,
            port = 0,
            database = archivo.Length == 0 ? string.Empty : Path.Combine(_carpeta, archivo),
            username = string.Empty,
        },
    };

    [Fact]
    public async Task CreaElArchivoYDespuesSePuedeAbrir()
    {
        Directory.CreateDirectory(_carpeta);

        using var client = _factory.CreateAuthenticatedClient();

        var creada = await client.PostAsJsonAsync(
            "/api/connections/database",
            Request("nueva.db"));

        Assert.Equal(HttpStatusCode.NoContent, creada.StatusCode);

        // **Crear no abre.** Se comprueba aparte que lo que quedó en el disco es
        // una base de verdad y no un archivo vacío, que es el error que este
        // motor pone fácil.
        var abierta = await client.PostAsJsonAsync(
            "/api/connections/test",
            Request("nueva.db"));

        abierta.EnsureSuccessStatusCode();

        var body = await abierta.ReadJsonAsync();

        Assert.True(
            body.GetProperty("succeeded").GetBoolean(),
            body.TryGetProperty("errorMessage", out var motivo) ? motivo.GetString() : null);
    }

    /// <summary>
    /// Un motor que no sabe crear recibe un **no con su motivo**, no un error del
    /// servidor: es una petición que se entendió y no se puede atender.
    /// </summary>
    [Fact]
    public async Task UnMotorQueNoSabeCrearLoDiceSinRomperse()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/connections/database",
            new
            {
                profile = new
                {
                    name = "PostgreSQL",
                    engine = "postgresql",
                    host = "127.0.0.1",
                    port = 5432,
                    database = "loquesea",
                    username = "postgres",
                },
            });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>Sin ruta no hay nada que crear, y se dice antes de tocar el disco.</summary>
    [Fact]
    public async Task SinRutaSeRechazaAntesDeTocarNada()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/connections/database",
            Request(string.Empty));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
