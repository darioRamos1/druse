using System.Diagnostics;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Connections;

/// <summary>Probar conexiones y abrir o cerrar sesiones.</summary>
public sealed class ConnectionService(
    IProviderRegistry providers,
    ISessionRegistry sessions,
    ISshTunnelFactory tunnels,
    ISshTunnelRegistry openTunnels)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ISessionRegistry _sessions = sessions;
    private readonly ISshTunnelFactory _tunnels = tunnels;
    private readonly ISshTunnelRegistry _openTunnels = openTunnels;

    /// <summary>Prueba unas credenciales sin guardarlas ni dejar sesión abierta.</summary>
    public async Task<TestConnectionResult> TestAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        SshCredentials sshCredentials,
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
        var stopwatch = Stopwatch.StartNew();

        ISshTunnel? tunnel;

        try
        {
            tunnel = await OpenTunnelAsync(profile, sshCredentials, cancellationToken);
        }
        catch (SshTunnelException exception)
        {
            // Que falle el túnel es un resultado de la prueba, no un error de la
            // API: el usuario quiere leer por qué no se pudo llegar.
            stopwatch.Stop();
            return TestConnectionResult.Failure(
                new QueryError { Message = exception.Message },
                stopwatch.Elapsed);
        }

        await using (tunnel)
        {
            return await provider.TestConnectionAsync(
                Redirect(profile, tunnel),
                credentials,
                cancellationToken);
        }
    }

    /// <summary>Abre una sesión y la registra.</summary>
    public async Task<IDatabaseSession> OpenAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        SshCredentials sshCredentials,
        CancellationToken cancellationToken)
    {
        var validation = ConnectionProfileValidator.Validate(profile);

        if (!validation.IsValid)
        {
            throw new ArgumentException(string.Join(" ", validation.Errors), nameof(profile));
        }

        var provider = _providers.GetProvider(profile.Engine);
        var tunnel = await OpenTunnelAsync(profile, sshCredentials, cancellationToken);

        IDatabaseSession session;

        try
        {
            session = await provider.OpenSessionAsync(
                Redirect(profile, tunnel),
                credentials,
                cancellationToken);
        }
        catch
        {
            // Sin sesión, el túnel no tiene a quién servir.
            if (tunnel is not null)
            {
                await tunnel.DisposeAsync();
            }

            throw;
        }

        if (tunnel is not null)
        {
            _openTunnels.Add(session.Id, tunnel);
        }

        _sessions.Add(session);

        return session;
    }

    public async Task<bool> CloseAsync(Guid sessionId)
    {
        var closed = await _sessions.CloseAsync(sessionId);

        // El túnel se cierra después de la conexión: al revés, cerrar el reenvío
        // dejaría al driver despidiéndose contra un puerto que ya no existe.
        await _openTunnels.CloseAsync(sessionId);

        return closed;
    }

    /// <summary>Abre el túnel del perfil, o `null` si la conexión va directa.</summary>
    private async Task<ISshTunnel?> OpenTunnelAsync(
        ConnectionProfile profile,
        SshCredentials credentials,
        CancellationToken cancellationToken)
    {
        if (profile.SshTunnel is null)
        {
            return null;
        }

        return await _tunnels.OpenAsync(
            profile.SshTunnel,
            credentials,
            profile.Host,
            profile.Port,
            cancellationToken);
    }

    /// <summary>
    /// Apunta el perfil al extremo local del túnel.
    ///
    /// El servidor y el puerto originales siguen siendo válidos —lo son desde la
    /// máquina intermedia—, pero el driver de este equipo solo puede hablar con
    /// el puerto local que abrió el reenvío.
    /// </summary>
    private static ConnectionProfile Redirect(ConnectionProfile profile, ISshTunnel? tunnel) =>
        tunnel is null ? profile : profile with { Host = tunnel.Host, Port = tunnel.Port };

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
