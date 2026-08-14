using System.Text.Json;
using Druse.Host.LocalApi.Security;

namespace Druse.IntegrationTests;

/// <summary>
/// El archivo con el que el cliente encuentra la API.
///
/// Lo que se protege aquí es un fallo que se ve raro desde fuera: la aplicación
/// dice «Falta el token de la API local» con una API perfectamente viva delante,
/// porque otra instancia se llevó su punto de conexión al apagarse.
/// </summary>
public sealed class LocalApiEndpointTests
{
    [Fact]
    public void AlCerrar_RetiraSuPropioPuntoDeConexion()
    {
        using var paths = new TemporaryPaths();
        var endpoint = new LocalApiEndpoint(paths);

        endpoint.Publish(5177);
        Assert.True(File.Exists(endpoint.FilePath));

        endpoint.Dispose();

        Assert.False(File.Exists(endpoint.FilePath));
    }

    /// <summary>
    /// Reiniciar la API es arrancar una y cerrar la otra, así que las dos
    /// conviven un momento. Si la que se va borra el archivo de la que se queda,
    /// el frontend se queda sin token contra una API que está funcionando.
    /// </summary>
    [Fact]
    public void AlCerrar_NoSeLlevaElPuntoDeConexionDeOtraInstancia()
    {
        using var paths = new TemporaryPaths();
        var saliente = new LocalApiEndpoint(paths);

        saliente.Publish(5177);

        // La instancia nueva publica encima: mismo archivo, su puerto, su token
        // y **su** identificador de proceso.
        var deOtra = JsonSerializer.Serialize(new
        {
            port = 5178,
            token = "el-token-de-la-nueva",
            pid = Environment.ProcessId + 1,
        });

        File.WriteAllText(saliente.FilePath, deOtra);

        saliente.Dispose();

        Assert.True(File.Exists(saliente.FilePath));
        Assert.Equal(deOtra, File.ReadAllText(saliente.FilePath));
    }
}
