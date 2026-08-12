using Druse.Platform.Abstractions;
using Druse.Platform.Native;
using Druse.Platform.Native.Secrets;

namespace Druse.UnitTests;

/// <summary>
/// Comprueba el almacén real del sistema.
///
/// Usa claves con un GUID y las borra al terminar, para no dejar basura en el
/// llavero de quien ejecute las pruebas.
/// </summary>
public sealed class SecretStoreTests
{
    private static string NewKey() => $"druse-test-{Guid.NewGuid():N}";

    [Fact]
    public async Task GuardaLeeYBorraUnSecreto()
    {
        var store = SecretStoreFactory.Create();

        if (!store.IsAvailable)
        {
            // Sin almacén no hay nada que comprobar, y la suite no debe fallar
            // por ello (por ejemplo en un contenedor de integración continua).
            Assert.IsType<NullSecretStore>(store);
            return;
        }

        var key = NewKey();
        const string Secret = "contraseña de prueba con acentos y símbolos: ñ € $";

        try
        {
            await store.SetAsync(key, Secret, CancellationToken.None);

            var recovered = await store.GetAsync(key, CancellationToken.None);

            Assert.Equal(Secret, recovered);
        }
        finally
        {
            await store.DeleteAsync(key, CancellationToken.None);
        }

        Assert.Null(await store.GetAsync(key, CancellationToken.None));
    }

    [Fact]
    public async Task LeerUnSecretoInexistenteDevuelveNulo()
    {
        var store = SecretStoreFactory.Create();

        Assert.Null(await store.GetAsync(NewKey(), CancellationToken.None));
    }

    [Fact]
    public async Task BorrarUnSecretoInexistenteNoFalla()
    {
        var store = SecretStoreFactory.Create();

        // Borrar debe poder llamarse siempre, sin comprobar antes si existe.
        await store.DeleteAsync(NewKey(), CancellationToken.None);
    }

    [Fact]
    public async Task GuardarDosVecesReemplazaElValor()
    {
        var store = SecretStoreFactory.Create();

        if (!store.IsAvailable)
        {
            return;
        }

        var key = NewKey();

        try
        {
            await store.SetAsync(key, "primera", CancellationToken.None);
            await store.SetAsync(key, "segunda", CancellationToken.None);

            Assert.Equal("segunda", await store.GetAsync(key, CancellationToken.None));
        }
        finally
        {
            await store.DeleteAsync(key, CancellationToken.None);
        }
    }

    [Fact]
    public void ElAlmacenSeIdentifica()
    {
        var store = SecretStoreFactory.Create();

        Assert.False(string.IsNullOrWhiteSpace(store.Description));
    }

    [Fact]
    public async Task ElAlmacenNuloNuncaDevuelveNada()
    {
        var store = new NullSecretStore();

        await store.SetAsync("clave", "secreto", CancellationToken.None);

        // Aceptar el secreto y no guardarlo es deliberado: así el resto del código
        // no necesita ramificar según haya almacén o no.
        Assert.Null(await store.GetAsync("clave", CancellationToken.None));
        Assert.False(store.IsAvailable);
    }
}

public sealed class AppPathsTests
{
    [Fact]
    public void LasRutasSonAbsolutasYLlevanElNombreDelProducto()
    {
        var paths = new AppPaths();

        foreach (var directory in new[]
        {
            paths.DataDirectory,
            paths.ConfigDirectory,
            paths.CacheDirectory,
            paths.LogDirectory,
        })
        {
            Assert.True(Path.IsPathRooted(directory), $"'{directory}' debería ser absoluta.");
            Assert.Contains("druse", directory, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void LaBaseLocalViveEnElDirectorioDeDatos()
    {
        var paths = new AppPaths();

        Assert.StartsWith(paths.DataDirectory, paths.DatabaseFile, StringComparison.Ordinal);
        Assert.EndsWith(".db", paths.DatabaseFile, StringComparison.Ordinal);
    }

    [Fact]
    public void LasRutasNoSeConstruyenConSeparadoresFijos()
    {
        var paths = new AppPaths();

        // Un separador escrito a mano rompería la compilación cruzada (ADR 0003).
        var wrongSeparator = Path.DirectorySeparatorChar == '/' ? '\\' : '/';

        Assert.DoesNotContain(wrongSeparator, paths.DataDirectory);
    }
}
