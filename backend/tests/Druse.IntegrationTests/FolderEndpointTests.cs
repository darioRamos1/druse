using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// El explorador de carpetas visto desde la API, que es como lo usa la pantalla
/// cuando Druse corre en el navegador.
///
/// No hace falta base de datos: lo que se comprueba es que el proceso local sabe
/// decir qué carpetas hay y qué pasaría al escribir en una de ellas, que es lo
/// que sustituye al diálogo del sistema.
/// </summary>
public sealed class FolderEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    [Fact]
    public async Task SinRutaDevuelveLosSitiosConocidosYLasUnidades()
    {
        using var client = _factory.CreateAuthenticatedClient();
        using var response = await client.GetAsync("/api/folders");

        response.EnsureSuccessStatusCode();

        var listing = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(string.Empty, listing.GetProperty("path").GetString());
        Assert.NotEmpty(listing.GetProperty("separator").GetString()!);

        var folders = listing.GetProperty("folders").EnumerateArray().ToList();

        Assert.NotEmpty(folders);
        Assert.Contains(folders, folder => folder.GetProperty("kind").GetString() == "Drive");
    }

    [Fact]
    public async Task ListaLasSubcarpetasDeUnaRuta()
    {
        var root = Path.Combine(Path.GetTempPath(), $"druse-api-folders-{Guid.NewGuid():N}");

        Directory.CreateDirectory(Path.Combine(root, "respaldos"));
        File.WriteAllText(Path.Combine(root, "algo.sql"), "-- nada");

        try
        {
            using var client = _factory.CreateAuthenticatedClient();
            using var response = await client.GetAsync($"/api/folders?path={Uri.EscapeDataString(root)}");

            response.EnsureSuccessStatusCode();

            var listing = await response.Content.ReadFromJsonAsync<JsonElement>();
            var names = listing.GetProperty("folders")
                .EnumerateArray()
                .Select(folder => folder.GetProperty("name").GetString())
                .ToList();

            // Solo carpetas: para elegir dónde guardar, los archivos sobran.
            Assert.Equal(["respaldos"], names);
            Assert.True(listing.GetProperty("canWrite").GetBoolean());
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    /// <summary>
    /// Lo que hace falta para elegir un respaldo que restaurar: sus archivos y,
    /// marcadas, las carpetas que son un respaldo entero.
    /// </summary>
    [Fact]
    public async Task ConExtensionesYMarcadorEnseñaLosRespaldos()
    {
        var root = Path.Combine(Path.GetTempPath(), $"druse-api-abrir-{Guid.NewGuid():N}");

        Directory.CreateDirectory(Path.Combine(root, "tienda"));
        File.WriteAllText(Path.Combine(root, "tienda", "manifest.json"), "{}");
        Directory.CreateDirectory(Path.Combine(root, "fotos"));
        File.WriteAllText(Path.Combine(root, "ventas.sql"), "-- respaldo");
        File.WriteAllText(Path.Combine(root, "notas.txt"), "nada que ver");

        try
        {
            using var client = _factory.CreateAuthenticatedClient();

            using var response = await client.GetAsync(
                $"/api/folders?path={Uri.EscapeDataString(root)}&files=sql,zip&marker=manifest.json");

            response.EnsureSuccessStatusCode();

            var listing = await response.Content.ReadFromJsonAsync<JsonElement>();

            var files = listing.GetProperty("files")
                .EnumerateArray()
                .Select(file => file.GetProperty("name").GetString())
                .ToList();

            Assert.Equal(["ventas.sql"], files);

            var marked = listing.GetProperty("folders")
                .EnumerateArray()
                .Where(folder => folder.GetProperty("marked").GetBoolean())
                .Select(folder => folder.GetProperty("name").GetString())
                .ToList();

            Assert.Equal(["tienda"], marked);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ComponeElDestinoYAvisaDeLoQueSeSobrescribiria()
    {
        var root = Path.Combine(Path.GetTempPath(), $"druse-api-target-{Guid.NewGuid():N}");

        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "respaldo.sql"), "-- el de ayer");

        try
        {
            using var client = _factory.CreateAuthenticatedClient();

            using var response = await client.GetAsync(
                $"/api/folders/target?folder={Uri.EscapeDataString(root)}&name=respaldo.sql");

            response.EnsureSuccessStatusCode();

            var target = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Equal(Path.Combine(root, "respaldo.sql"), target.GetProperty("path").GetString());
            Assert.True(target.GetProperty("exists").GetBoolean());
            Assert.True(target.GetProperty("canWrite").GetBoolean());
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    /// <summary>
    /// Un nombre con carpetas dentro escribiría en otro sitio del que la pantalla
    /// enseña. Se rechaza con su motivo, no con un 500.
    /// </summary>
    [Fact]
    public async Task UnNombreQueEsMediaRutaSeRechaza()
    {
        var root = Path.Combine(Path.GetTempPath(), $"druse-api-mal-{Guid.NewGuid():N}");

        Directory.CreateDirectory(root);

        try
        {
            using var client = _factory.CreateAuthenticatedClient();

            using var response = await client.GetAsync(
                $"/api/folders/target?folder={Uri.EscapeDataString(root)}&name={Uri.EscapeDataString("../fuera.sql")}");

            response.EnsureSuccessStatusCode();

            var target = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.False(string.IsNullOrWhiteSpace(target.GetProperty("problem").GetString()));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task CreaUnaCarpetaYSeNiegaARepetirla()
    {
        var root = Path.Combine(Path.GetTempPath(), $"druse-api-crear-{Guid.NewGuid():N}");

        Directory.CreateDirectory(root);

        try
        {
            using var client = _factory.CreateAuthenticatedClient();

            using var created = await client.PostAsJsonAsync(
                "/api/folders",
                new { parent = root, name = "agosto" });

            created.EnsureSuccessStatusCode();
            Assert.True(Directory.Exists(Path.Combine(root, "agosto")));

            using var repetida = await client.PostAsJsonAsync(
                "/api/folders",
                new { parent = root, name = "agosto" });

            Assert.Equal(HttpStatusCode.BadRequest, repetida.StatusCode);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
