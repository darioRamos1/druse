using Druse.Platform.Abstractions;

namespace Druse.Platform.Native;

/// <summary>
/// Rutas según la convención de cada sistema operativo.
///
/// - Windows: `%APPDATA%\Druse` y `%LOCALAPPDATA%\Druse`.
/// - macOS: `~/Library/Application Support/Druse`.
/// - Linux: las variables XDG, con los valores por omisión del estándar.
///
/// Se usa `Path.Combine` en todo momento: escribir un separador a mano rompería
/// la compilación cruzada en cuanto alguien copiara la línea (ADR 0003).
/// </summary>
public sealed class AppPaths : IAppPaths
{
    private const string ApplicationName = "Druse";

    /// <summary>
    /// Variable que manda sobre la convención del sistema.
    ///
    /// Existe porque **en Windows no hay otra forma de mover estos datos**:
    /// `GetFolderPath` pregunta a la API del sistema y no mira la variable
    /// `APPDATA`, así que arrancar Druse con otro `APPDATA` —lo que sí funciona
    /// para un proceso de Node— lo deja escribiendo igualmente en el perfil del
    /// usuario. Se descubrió montando las pruebas de punta a punta: creían correr
    /// aisladas y estaban usando la base de verdad.
    ///
    /// Sirve además para lo que se le pida encima: una instalación portable en
    /// una llave USB, o dos perfiles en la misma máquina.
    /// </summary>
    public const string DataDirectoryVariable = "DRUSE_DATA_DIR";

    public AppPaths()
    {
        // Una ruta relativa se resolvería contra el directorio de trabajo, que
        // en un servicio no es el que nadie espera: se exige absoluta o se
        // ignora, en lugar de escribir en un sitio sorpresa.
        var custom = Environment.GetEnvironmentVariable(DataDirectoryVariable);

        if (!string.IsNullOrWhiteSpace(custom) && Path.IsPathRooted(custom))
        {
            DataDirectory = custom;
            ConfigDirectory = custom;
            CacheDirectory = Path.Combine(custom, "cache");
            LogDirectory = Path.Combine(custom, "logs");
        }
        else if (OperatingSystem.IsWindows())
        {
            var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            DataDirectory = Path.Combine(roaming, ApplicationName);
            ConfigDirectory = DataDirectory;
            CacheDirectory = Path.Combine(local, ApplicationName, "cache");
            LogDirectory = Path.Combine(local, ApplicationName, "logs");
        }
        else if (OperatingSystem.IsMacOS())
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var support = Path.Combine(home, "Library", "Application Support", ApplicationName);

            DataDirectory = support;
            ConfigDirectory = support;
            CacheDirectory = Path.Combine(home, "Library", "Caches", ApplicationName);
            LogDirectory = Path.Combine(home, "Library", "Logs", ApplicationName);
        }
        else
        {
            // Linux y cualquier otro Unix: especificación XDG Base Directory.
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

            var dataHome = ResolveXdg("XDG_DATA_HOME", Path.Combine(home, ".local", "share"));
            var configHome = ResolveXdg("XDG_CONFIG_HOME", Path.Combine(home, ".config"));
            var cacheHome = ResolveXdg("XDG_CACHE_HOME", Path.Combine(home, ".cache"));

            DataDirectory = Path.Combine(dataHome, ApplicationName.ToLowerInvariant());
            ConfigDirectory = Path.Combine(configHome, ApplicationName.ToLowerInvariant());
            CacheDirectory = Path.Combine(cacheHome, ApplicationName.ToLowerInvariant());
            LogDirectory = Path.Combine(DataDirectory, "logs");
        }

        DatabaseFile = Path.Combine(DataDirectory, "druse.db");
    }

    public string DataDirectory { get; }

    public string ConfigDirectory { get; }

    public string CacheDirectory { get; }

    public string LogDirectory { get; }

    public string DatabaseFile { get; }

    public void EnsureCreated()
    {
        foreach (var directory in new[] { DataDirectory, ConfigDirectory, CacheDirectory, LogDirectory })
        {
            Directory.CreateDirectory(directory);
        }
    }

    /// <summary>
    /// Lee una variable XDG.
    ///
    /// La especificación dice que una ruta relativa debe ignorarse, no
    /// interpretarse: si se aceptara, la aplicación escribiría en un sitio
    /// distinto según desde dónde se lanzara.
    /// </summary>
    private static string ResolveXdg(string variable, string fallback)
    {
        var value = Environment.GetEnvironmentVariable(variable);

        return !string.IsNullOrWhiteSpace(value) && Path.IsPathRooted(value) ? value : fallback;
    }
}
