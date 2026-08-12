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

    /// <summary>
    /// Un turno por sesión.
    ///
    /// El diccionario concurrente protege la lista de sesiones, pero no la
    /// conexión que hay dentro de cada una: eso es lo que hace este semáforo.
    /// </summary>
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _turns = new();

    public IReadOnlyCollection<IDatabaseSession> All => _sessions.Values.ToList();

    public void Add(IDatabaseSession session)
    {
        ArgumentNullException.ThrowIfNull(session);

        _sessions[session.Id] = session;
    }

    public IDatabaseSession? Find(Guid sessionId) =>
        _sessions.TryGetValue(sessionId, out var session) && session.IsOpen ? session : null;

    /// <inheritdoc />
    public async Task<IDisposable> EnterAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        var turn = _turns.GetOrAdd(sessionId, _ => new SemaphoreSlim(1, 1));

        await turn.WaitAsync(cancellationToken);

        return new Turn(turn);
    }

    /// <summary>El turno de una sesión, que se devuelve al liberarlo.</summary>
    private sealed class Turn(SemaphoreSlim semaphore) : IDisposable
    {
        private bool _released;

        public void Dispose()
        {
            if (_released)
            {
                return;
            }

            _released = true;
            semaphore.Release();
        }
    }

    public async Task<bool> CloseAsync(Guid sessionId)
    {
        if (!_sessions.TryRemove(sessionId, out var session))
        {
            return false;
        }

        // El turno se retira con la sesión: dejarlo sería acumular semáforos de
        // conexiones que ya no existen.
        if (_turns.TryRemove(sessionId, out var turn))
        {
            turn.Dispose();
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
