using System.Collections.Concurrent;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;

namespace Druse.Infrastructure.Sessions;

/// <summary>
/// Sesiones abiertas, en memoria y seguras entre hilos.
///
/// Varias peticiones HTTP pueden tocar la misma sesión a la vez —ejecutar una
/// consulta mientras el explorador pide metadatos—, de ahí el diccionario
/// concurrente.
/// </summary>
public sealed class SessionRegistry : ISessionRegistry
{
    private readonly ConcurrentDictionary<Guid, IDatabaseSession> _sessions = new();

    public IReadOnlyCollection<IDatabaseSession> All => _sessions.Values.ToList();

    public void Add(IDatabaseSession session)
    {
        ArgumentNullException.ThrowIfNull(session);

        _sessions[session.Id] = session;
    }

    public IDatabaseSession? Find(Guid sessionId) =>
        _sessions.TryGetValue(sessionId, out var session) && session.IsOpen ? session : null;

    public async Task<bool> CloseAsync(Guid sessionId)
    {
        if (!_sessions.TryRemove(sessionId, out var session))
        {
            return false;
        }

        await session.DisposeAsync();
        return true;
    }

    /// <summary>
    /// Cierra todas las sesiones al apagar.
    ///
    /// Se ignoran los fallos individuales a propósito: si una conexión ya se cayó,
    /// eso no debe impedir cerrar las demás ni bloquear el apagado.
    /// </summary>
    public async Task CloseAllAsync()
    {
        foreach (var sessionId in _sessions.Keys.ToList())
        {
            try
            {
                await CloseAsync(sessionId);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // Nada que hacer durante el apagado.
            }
        }
    }
}
