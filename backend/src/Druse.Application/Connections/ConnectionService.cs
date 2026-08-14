using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Connections;

/// <summary>Probar conexiones y abrir o cerrar sesiones.</summary>
public sealed class ConnectionService(
    IProviderRegistry providers,
    ISessionRegistry sessions)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ISessionRegistry _sessions = sessions;

    /// <summary>Prueba unas credenciales sin guardarlas ni dejar sesión abierta.</summary>
    public async Task<TestConnectionResult> TestAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        var validation = ConnectionProfileValidator.Validate(profile);

        if (!validation.IsValid)
        {
            return TestConnectionResult.Failure(
                new QueryError { Message = string.Join(" ", validation.Errors) },
                TimeSpan.Zero);
        }

        var provider = _providers.GetProvider(profile.Engine);

        return await provider.TestConnectionAsync(profile, credentials, cancellationToken);
    }

    /// <summary>Abre una sesión y la registra.</summary>
    public async Task<IDatabaseSession> OpenAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        var validation = ConnectionProfileValidator.Validate(profile);

        if (!validation.IsValid)
        {
            throw new ArgumentException(string.Join(" ", validation.Errors), nameof(profile));
        }

        var provider = _providers.GetProvider(profile.Engine);
        var session = await provider.OpenSessionAsync(profile, credentials, cancellationToken);

        _sessions.Add(session);

        return session;
    }

    public Task<bool> CloseAsync(Guid sessionId) => _sessions.CloseAsync(sessionId);

    /// <summary>Recupera una sesión abierta o falla con un error claro.</summary>
    public IDatabaseSession Require(Guid sessionId) =>
        _sessions.Find(sessionId) ?? throw new SessionNotFoundException(sessionId);

    /// <summary>
    /// Espera el turno para usar la sesión.
    ///
    /// Todo lo que hable con el motor por una sesión debe pedirlo antes: la
    /// conexión es una sola y no admite dos comandos a la vez.
    /// </summary>
    public Task<IDisposable> EnterAsync(Guid sessionId, CancellationToken cancellationToken) =>
        _sessions.EnterAsync(sessionId, cancellationToken);

    /// <summary>
    /// Ejecuta una operación en la base pedida. Si no es la base inicial, abre
    /// una sesión auxiliar que conserva servidor, usuario, opciones y permisos.
    /// Quien llama debe tener ya el turno de la sesión de origen.
    /// </summary>
    public async Task<T> UseDatabaseAsync<T>(
        IDatabaseSession source,
        string? database,
        Func<IDatabaseSession, Task<T>> operation,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(operation);

        if (string.IsNullOrWhiteSpace(database)
            || string.Equals(database, source.Profile.Database, StringComparison.Ordinal))
        {
            return await operation(source);
        }

        var provider = _providers.GetProvider(source.Engine);
        await using var auxiliary = await provider.OpenDatabaseSessionAsync(
            source,
            database,
            cancellationToken);

        return await operation(auxiliary);
    }
}
