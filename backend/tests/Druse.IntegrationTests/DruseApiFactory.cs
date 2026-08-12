using Druse.Host.LocalApi.Security;
using Druse.Platform.Abstractions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Druse.IntegrationTests;

/// <summary>
/// Rutas dentro de un directorio temporal, para que las pruebas no escriban en la
/// base ni en el llavero reales del usuario.
/// </summary>
internal sealed class TemporaryPaths : IAppPaths, IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"druse-itest-{Guid.NewGuid():N}");

    public string DataDirectory => _root;
    public string ConfigDirectory => _root;
    public string CacheDirectory => Path.Combine(_root, "cache");
    public string LogDirectory => Path.Combine(_root, "logs");
    public string DatabaseFile => Path.Combine(_root, "druse.db");

    public void EnsureCreated()
    {
        Directory.CreateDirectory(DataDirectory);
        Directory.CreateDirectory(CacheDirectory);
        Directory.CreateDirectory(LogDirectory);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_root))
            {
                Directory.Delete(_root, recursive: true);
            }
        }
        catch (IOException)
        {
            // Está en el directorio temporal del sistema; no es grave.
        }
    }
}

/// <summary>
/// Host de pruebas con almacenamiento aislado.
///
/// Sustituye <see cref="IAppPaths"/> y el almacén de secretos para no tocar los
/// datos reales de quien ejecuta las pruebas, y expone un cliente que ya envía el
/// token.
/// </summary>
public sealed class DruseApiFactory : WebApplicationFactory<Program>
{
    private readonly TemporaryPaths _paths = new();

    /// <summary>Token que genera el host al arrancar.</summary>
    public string Token => Services.GetRequiredService<LocalApiToken>().Value;

    /// <summary>Cliente con la cabecera del token ya puesta.</summary>
    public HttpClient CreateAuthenticatedClient()
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add("X-Druse-Token", Token);

        return client;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<IAppPaths>();
            services.AddSingleton<IAppPaths>(_paths);

            // Un almacén en memoria: las pruebas no deben dejar credenciales en el
            // llavero de la máquina.
            services.RemoveAll<ISecretStore>();
            services.AddSingleton<ISecretStore, InMemorySecretStore>();
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        if (disposing)
        {
            _paths.Dispose();
        }
    }
}

/// <summary>Almacén de secretos que vive solo durante la prueba.</summary>
internal sealed class InMemorySecretStore : ISecretStore
{
    private readonly Dictionary<string, string> _secrets = new(StringComparer.Ordinal);

    public bool IsAvailable => true;

    public string Description => "Almacén en memoria (solo pruebas)";

    public Task SetAsync(string key, string secret, CancellationToken cancellationToken)
    {
        lock (_secrets)
        {
            _secrets[key] = secret;
        }

        return Task.CompletedTask;
    }

    public Task<string?> GetAsync(string key, CancellationToken cancellationToken)
    {
        lock (_secrets)
        {
            return Task.FromResult(_secrets.TryGetValue(key, out var secret) ? secret : null);
        }
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        lock (_secrets)
        {
            _secrets.Remove(key);
        }

        return Task.CompletedTask;
    }
}
