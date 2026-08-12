using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Druse.Platform.Abstractions;

namespace Druse.Host.LocalApi.Security;

/// <summary>
/// Dónde escucha la API y con qué token, escrito en un archivo para que el
/// cliente lo encuentre.
///
/// **Por qué el token:** escuchar solo en loopback impide el acceso desde la red,
/// pero no desde la propia máquina. Sin él, cualquier proceso del usuario
/// —incluida una pestaña del navegador con JavaScript de un sitio cualquiera—
/// podría abrir sesiones contra sus bases de datos.
///
/// **Por qué el puerto va aquí:** al empaquetar con Tauri el puerto deja de ser
/// fijo, porque el 5177 puede estar ocupado por otra cosa. Se pide uno libre al
/// sistema y se publica junto al token, en el mismo archivo: quien pueda leerlo
/// tiene todo lo necesario para hablar con la API, y quien no, nada.
///
/// El archivo se borra al cerrar. Si el proceso muere de golpe puede quedar,
/// pero su contenido ya no sirve: el siguiente arranque genera otro token y lo
/// sobrescribe.
/// </summary>
public sealed class LocalApiEndpoint : IDisposable
{
    private const string FileName = "endpoint.json";

    public LocalApiEndpoint(IAppPaths paths)
    {
        ArgumentNullException.ThrowIfNull(paths);

        paths.EnsureCreated();

        FilePath = Path.Combine(paths.DataDirectory, FileName);

        // 32 bytes de un generador criptográfico: no puede adivinarse ni
        // derivarse del momento de arranque.
        Token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    }

    /// <summary>Valor que el cliente debe enviar en la cabecera <c>X-Druse-Token</c>.</summary>
    public string Token { get; }

    /// <summary>Puerto en el que quedó escuchando. Se conoce después de arrancar.</summary>
    public int Port { get; private set; }

    public string FilePath { get; }

    /// <summary>
    /// Publica el punto de conexión una vez conocido el puerto.
    ///
    /// Se llama al arrancar y no en el constructor porque con puerto dinámico el
    /// número real solo existe cuando el servidor ya está escuchando.
    /// </summary>
    public void Publish(int port)
    {
        Port = port;

        var payload = JsonSerializer.Serialize(new
        {
            port,
            token = Token,
            pid = Environment.ProcessId,
        });

        File.WriteAllText(FilePath, payload);
        RestrictPermissions(FilePath);
    }

    /// <summary>Comparación en tiempo constante, para no filtrar el token por el tiempo de respuesta.</summary>
    public bool Matches(string? candidate)
    {
        if (string.IsNullOrEmpty(candidate))
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(candidate),
            Encoding.UTF8.GetBytes(Token));
    }

    public void Dispose()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                File.Delete(FilePath);
            }
        }
        catch (IOException)
        {
            // Si no se puede borrar, el token deja de valer igualmente al cerrar
            // el proceso: el siguiente arranque genera otro.
        }
    }

    /// <summary>
    /// Restringe el archivo al usuario actual.
    ///
    /// En Unix se traduce a 0600. En Windows el directorio de datos del usuario ya
    /// está protegido por las ACL del perfil, y reescribirlas a mano es más fácil
    /// de romper que de acertar.
    /// </summary>
    private static void RestrictPermissions(string path)
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        try
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        catch (IOException)
        {
            // Sistemas de archivos que no admiten modos POSIX.
        }
    }
}
