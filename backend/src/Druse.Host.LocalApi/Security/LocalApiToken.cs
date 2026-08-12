using System.Security.Cryptography;
using Druse.Platform.Abstractions;

namespace Druse.Host.LocalApi.Security;

/// <summary>
/// Token que autentica al cliente legítimo de la API local.
///
/// **Por qué hace falta:** escuchar solo en loopback impide el acceso desde la
/// red, pero no desde la propia máquina. Sin token, cualquier proceso del usuario
/// —incluida una pestaña del navegador con JavaScript de un sitio cualquiera—
/// podría abrir sesiones contra sus bases de datos.
///
/// **Cómo lo obtiene el cliente:** se genera al arrancar y se escribe en un
/// archivo dentro del directorio de datos del usuario. Quien puede leer ese
/// archivo ya tiene acceso a su cuenta, así que el token no añade una barrera
/// nueva frente a ese caso; lo que impide es que un proceso *sin* ese acceso
/// hable con la API.
///
/// El token vive solo mientras dura el proceso: al cerrar, el archivo se borra.
/// </summary>
public sealed class LocalApiToken : IDisposable
{
    private const string FileName = "api-token";

    private readonly string _filePath;

    public LocalApiToken(IAppPaths paths)
    {
        ArgumentNullException.ThrowIfNull(paths);

        paths.EnsureCreated();

        _filePath = Path.Combine(paths.DataDirectory, FileName);

        // 32 bytes de un generador criptográfico: no puede adivinarse ni derivarse
        // del momento de arranque.
        Value = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

        File.WriteAllText(_filePath, Value);
        RestrictPermissions(_filePath);
    }

    /// <summary>Valor que el cliente debe enviar en la cabecera <c>X-Druse-Token</c>.</summary>
    public string Value { get; }

    /// <summary>Ruta del archivo donde el cliente puede leerlo.</summary>
    public string FilePath => _filePath;

    /// <summary>Comparación en tiempo constante, para no filtrar el token por el tiempo de respuesta.</summary>
    public bool Matches(string? candidate)
    {
        if (string.IsNullOrEmpty(candidate))
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(candidate),
            System.Text.Encoding.UTF8.GetBytes(Value));
    }

    public void Dispose()
    {
        try
        {
            if (File.Exists(_filePath))
            {
                File.Delete(_filePath);
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
