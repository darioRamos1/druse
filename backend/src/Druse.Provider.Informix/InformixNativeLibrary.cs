using System.Runtime.InteropServices;

using IBM.Data.Db2;

namespace Druse.Provider.Informix;

/// <summary>
/// Enseña al proveedor de IBM dónde está su biblioteca nativa.
///
/// El paquete despliega el `clidriver` en un subdirectorio de la aplicación,
/// pero el `DllImport` pide `libdb2.so` a secas. En Windows eso funciona porque
/// el cargador mira el directorio de la aplicación; **en Linux no**: allí el
/// cargador solo consulta las rutas del sistema y `LD_LIBRARY_PATH`, así que la
/// primera conexión falla con «Unable to load shared library 'libdb2.so'» y, si
/// ocurre dentro de un proceso de pruebas, se lo lleva por delante entero.
///
/// Se resuelve aquí en lugar de pedir una variable de entorno porque esto tiene
/// que funcionar en las tres situaciones —la aplicación empaquetada, la
/// integración continua y quien compile el repositorio— y una variable hay que
/// acordarse de ponerla en las tres.
///
/// **Falta una pieza que no se puede resolver desde aquí:** el clidriver depende
/// de `libxml2`, que es del sistema. Sin ella la carga falla igual, con un
/// mensaje que menciona `libxml2.so.2` en vez de `libdb2.so`.
/// </summary>
internal static class InformixNativeLibrary
{
    private static int _registered;

    /// <summary>
    /// Registra el resolvedor una sola vez.
    ///
    /// Tiene que ejecutarse antes de la primera llamada nativa: después, el
    /// tiempo de ejecución ya guardó el resultado —incluido el fallo— y volver a
    /// registrarlo no cambia nada.
    /// </summary>
    public static void Ensure()
    {
        if (Interlocked.Exchange(ref _registered, 1) == 1)
        {
            return;
        }

        // Solo hace falta fuera de Windows. Registrarlo igualmente sería inocuo,
        // pero dejarlo explícito evita que alguien busque aquí un problema de
        // Windows que nunca vivió en este archivo.
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return;
        }

        NativeLibrary.SetDllImportResolver(typeof(DB2Connection).Assembly, Resolve);
    }

    private static IntPtr Resolve(string libraryName, System.Reflection.Assembly assembly, DllImportSearchPath? path)
    {
        // Solo se interviene sobre la biblioteca del clidriver; cualquier otra
        // se deja al tiempo de ejecución, que sabe resolverla.
        if (!libraryName.StartsWith("libdb2", StringComparison.Ordinal))
        {
            return IntPtr.Zero;
        }

        foreach (var candidate in Candidates(libraryName))
        {
            if (File.Exists(candidate) && NativeLibrary.TryLoad(candidate, out var handle))
            {
                return handle;
            }
        }

        // Sin candidatos, se devuelve cero para que el tiempo de ejecución siga
        // con su búsqueda normal: puede que el sistema sí la tenga instalada.
        return IntPtr.Zero;
    }

    /// <summary>
    /// Dónde puede estar, en orden.
    ///
    /// `IBM_DB_HOME` es la variable que usa quien instala el driver aparte, y se
    /// respeta antes que lo demás: si alguien la puso, es que quiere ese.
    /// </summary>
    private static IEnumerable<string> Candidates(string libraryName)
    {
        var home = Environment.GetEnvironmentVariable("IBM_DB_HOME");

        if (!string.IsNullOrWhiteSpace(home))
        {
            yield return Path.Combine(home, "lib", libraryName);
        }

        var directory = Path.GetDirectoryName(typeof(DB2Connection).Assembly.Location);

        if (!string.IsNullOrWhiteSpace(directory))
        {
            yield return Path.Combine(directory, "clidriver", "lib", libraryName);
        }

        yield return Path.Combine(AppContext.BaseDirectory, "clidriver", "lib", libraryName);
    }
}
