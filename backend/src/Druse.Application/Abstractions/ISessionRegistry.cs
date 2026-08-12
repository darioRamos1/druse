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

    /// <summary>
    /// Espera el turno para usar la sesión y lo devuelve como algo que liberar.
    ///
    /// **Una sesión es una conexión, y una conexión no ejecuta dos cosas a la
    /// vez.** Si dos peticiones la usan a la vez, el driver protesta —SQL Server
    /// dice que la conexión «no es compatible con MultipleActiveResultSets» y
    /// Npgsql que ya hay un comando en marcha— y una de las dos falla sin que el
    /// usuario haya hecho nada raro: basta con expandir dos nodos del árbol
    /// seguidos.
    ///
    /// Esperar el turno es lo correcto: el trabajo se hace igual, solo que en
    /// orden. Cancelar una consulta no pasa por aquí —viaja por otra conexión—,
    /// así que una ejecución larga se sigue pudiendo cortar.
    /// </summary>
    Task<IDisposable> EnterAsync(Guid sessionId, CancellationToken cancellationToken);

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
