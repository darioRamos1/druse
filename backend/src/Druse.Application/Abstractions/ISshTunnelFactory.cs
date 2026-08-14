using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Secretos con los que entrar en el servidor intermedio.
///
/// Van aparte de las credenciales del motor a propósito: son de otra máquina y
/// de otra cuenta, y mezclarlas acabaría enviando la contraseña de la base al
/// servidor de salto (plan §12).
/// </summary>
/// <param name="Secret">
/// Contraseña del usuario SSH, o passphrase de la clave privada, según el método.
/// </param>
/// <param name="VerificationCode">
/// Código de un solo uso, cuando el servidor lo pide. No se guarda nunca: caduca
/// en segundos y guardarlo anularía justo aquello para lo que sirve.
/// </param>
public readonly record struct SshCredentials(string? Secret, string? VerificationCode);

/// <summary>
/// Túnel abierto contra un servidor intermedio.
///
/// Mientras vive, <see cref="Host"/> y <see cref="Port"/> apuntan a un puerto
/// local que reenvía al servidor real. Es propiedad de quien lo abre, y cerrarlo
/// corta el reenvío: ninguna conexión que dependa de él sobrevive.
/// </summary>
public interface ISshTunnel : IAsyncDisposable
{
    /// <summary>Siempre una dirección de bucle local.</summary>
    string Host { get; }

    /// <summary>Puerto local que el sistema asignó al abrirlo.</summary>
    int Port { get; }

    bool IsOpen { get; }
}

/// <summary>Abre túneles SSH. La implementación es la única que conoce la librería.</summary>
public interface ISshTunnelFactory
{
    /// <summary>
    /// Abre una sesión SSH y reenvía un puerto local hacia
    /// <paramref name="remoteHost"/>:<paramref name="remotePort"/>, resueltos
    /// **desde el servidor intermedio**.
    /// </summary>
    /// <exception cref="SshTunnelException">
    /// No se pudo abrir, con un motivo que el usuario pueda entender y sin
    /// secretos dentro.
    /// </exception>
    Task<ISshTunnel> OpenAsync(
        SshTunnelSettings settings,
        SshCredentials credentials,
        string remoteHost,
        int remotePort,
        CancellationToken cancellationToken);
}

/// <summary>El túnel no se pudo abrir. El mensaje está pensado para enseñarlo.</summary>
public sealed class SshTunnelException(string message, Exception? innerException = null)
    : Exception(message, innerException);
