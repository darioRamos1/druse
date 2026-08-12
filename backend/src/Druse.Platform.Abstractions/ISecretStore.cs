namespace Druse.Platform.Abstractions;

/// <summary>
/// Guarda secretos en el almacén del sistema operativo.
///
/// Windows Credential Manager, el Llavero de macOS o el Secret Service de Linux.
/// El resto de la aplicación no sabe cuál de los tres hay debajo, ni le importa.
///
/// **Ninguna implementación puede escribir secretos en la base local, en un
/// archivo de configuración ni en un log** (plan §12).
/// </summary>
public interface ISecretStore
{
    /// <summary>Indica si hay un almacén utilizable en esta máquina.</summary>
    bool IsAvailable { get; }

    /// <summary>Nombre del almacén, para poder explicarle al usuario dónde quedó su contraseña.</summary>
    string Description { get; }

    /// <summary>Guarda o reemplaza un secreto.</summary>
    Task SetAsync(string key, string secret, CancellationToken cancellationToken);

    /// <summary>Recupera un secreto, o `null` si no está guardado.</summary>
    Task<string?> GetAsync(string key, CancellationToken cancellationToken);

    /// <summary>Borra un secreto. No falla si no existía.</summary>
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}

/// <summary>
/// Almacén que no guarda nada.
///
/// Se usa cuando el sistema no ofrece uno, que es el caso del modo portable y de
/// algunos escritorios Linux sin Secret Service. Guardar en su lugar un archivo
/// cifrado con una clave que también está en el disco sería fingir seguridad, así
/// que se prefiere pedir la contraseña cada vez y decirlo claramente (ADR 0003).
/// </summary>
public sealed class NullSecretStore : ISecretStore
{
    public bool IsAvailable => false;

    public string Description => "Sin almacén seguro: la contraseña se pedirá en cada conexión.";

    public Task SetAsync(string key, string secret, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task<string?> GetAsync(string key, CancellationToken cancellationToken) =>
        Task.FromResult<string?>(null);

    public Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}
