using Druse.Database.Abstractions;

namespace Druse.Application.Abstractions;

/// <summary>
/// Guarda las sesiones abiertas mientras dura el proceso.
///
/// Vive en memoria a propósito: una sesión es una conexión viva, y una conexión
/// no sobrevive a un reinicio por mucho que se persista su identificador.
/// </summary>
public interface ISessionRegistry
{
    /// <summary>Registra una sesión recién abierta.</summary>
    void Add(IDatabaseSession session);

    /// <summary>Devuelve la sesión, o `null` si no existe o ya se cerró.</summary>
    IDatabaseSession? Find(Guid sessionId);

    /// <summary>Cierra y descarta la sesión. Devuelve `false` si no existía.</summary>
    Task<bool> CloseAsync(Guid sessionId);

    /// <summary>Cierra todas. Se usa al apagar el proceso (plan §12).</summary>
    Task CloseAllAsync();

    IReadOnlyCollection<IDatabaseSession> All { get; }
}

/// <summary>Se usó un identificador de sesión que no está abierto.</summary>
public sealed class SessionNotFoundException(Guid sessionId)
    : InvalidOperationException($"La sesión '{sessionId}' no está abierta.")
{
    public Guid SessionId { get; } = sessionId;
}
