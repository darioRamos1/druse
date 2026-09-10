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

    /// <summary>Lo que se espera al salto final antes de darlo por inalcanzable.</summary>
    private const int TunnelProbeTimeoutSeconds = 10;

    /// <summary>
    /// Lo que el motor del perfil dice de sí mismo, o `null` si en esta
    /// compilación no hay quien lo implemente.
    ///
    /// Se pregunta **antes** de validar, así que hay que contemplar el motor sin
    /// proveedor: un perfil pudo guardarse con una compilación que sí lo traía.
    /// Ese caso no lo arregla el validador —lo dirá <c>GetProvider</c> un momento
    /// después, con su propio mensaje—; aquí basta con no reventar antes de
    /// llegar.
    ///
    /// Es público porque el host también lo necesita: al reabrir una conexión
    /// guardada hay que saber **si este motor tiene contraseña siquiera** antes
    /// de pedirla.
    /// </summary>
    public EngineCapabilities? Capabilities(ConnectionProfile? profile) =>
        profile is not null && _providers.SupportedEngines.Contains(profile.Engine)
            ? _providers.GetProvider(profile.Engine).Capabilities
            : null;

    /// <summary>
    /// Prueba solo el túnel, sin tocar la base de datos.
    ///
    /// Sirve para separar dos fallos que «no se pudo conectar» mezcla: que el
    /// servidor intermedio no deje entrar, y que desde él no se alcance el
    /// servidor de la base. Se arreglan en sitios distintos y a veces los
    /// arregla gente distinta.
    ///
    /// Abierto el reenvío, se comprueba que su extremo local acepta un socket.
    /// Eso demuestra el camino entero hasta el puerto del motor **sin hablar su
    /// protocolo**: aquí no hay usuario de base de datos ni contraseña que
    /// valga, así que un «no» del motor no puede confundirse con un «no» de la
    /// red.
    /// </summary>
    public async Task<TunnelTestResult> TestTunnelAsync(
        ConnectionProfile profile,
        SshCredentials sshCredentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        if (profile.SshTunnel is null)
        {
            return TunnelTestResult.NotConfigured();
        }

        var stopwatch = Stopwatch.StartNew();
        ISshTunnel? tunnel;

        try
        {
            tunnel = await OpenTunnelAsync(profile, sshCredentials, cancellationToken);
        }
        catch (SshTunnelException exception)
        {
            stopwatch.Stop();

            return TunnelTestResult.Failure(
                TunnelReach.Bastion,
                exception.Message,
                stopwatch.Elapsed);
        }

        if (tunnel is null)
        {
            stopwatch.Stop();
            return TunnelTestResult.NotConfigured();
        }

        await using (tunnel)
        {
            try
            {
                using var probe = new System.Net.Sockets.TcpClient();

                // Un plazo propio, y corto: el reenvío ya está abierto, así que
                // lo único que falta es un salto que o va o no va. Sin esto, un
                // destino que ni siquiera responde dejaría la prueba colgada el
                // tiempo que decida el sistema.
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                deadline.CancelAfter(TimeSpan.FromSeconds(TunnelProbeTimeoutSeconds));

                await probe.ConnectAsync(tunnel.Host, tunnel.Port, deadline.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                stopwatch.Stop();

                return TunnelTestResult.Failure(
                    TunnelReach.Forward,
                    $"Se entró en {profile.SshTunnel.Host}, pero desde allí no se llegó a "
                        + $"{profile.Host}:{profile.Port} antes de {TunnelProbeTimeoutSeconds} segundos. "
                        + "Suele ser el cortafuegos del servidor de la base, o que ese nombre no se "
                        + "resuelve igual desde el servidor intermedio.",
                    stopwatch.Elapsed);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                stopwatch.Stop();

                // El mensaje del socket es el del extremo local del reenvío, que
                // no le dice nada a nadie: lo que hay que nombrar es el destino
                // que el usuario escribió.
                return TunnelTestResult.Failure(
                    TunnelReach.Forward,
                    $"Se entró en {profile.SshTunnel.Host}, pero desde allí se rechazó la conexión a "
                        + $"{profile.Host}:{profile.Port}.",
                    stopwatch.Elapsed);
            }

            stopwatch.Stop();

            return TunnelTestResult.Success(stopwatch.Elapsed);
        }
    }

    /// <summary>Prueba unas credenciales sin guardarlas ni dejar sesión abierta.</summary>
    public async Task<TestConnectionResult> TestAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        SshCredentials sshCredentials,
        CancellationToken cancellationToken)
    {
        var validation = ConnectionProfileValidator.Validate(profile, Capabilities(profile));

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

    /// <summary>
    /// Qué bases puede abrir esta conexión, **antes** de abrir ninguna sesión.
    ///
    /// Es lo que deja elegir en el formulario en vez de tener que saberse el
    /// nombre de memoria. Se conecta a la base desde la que cada motor sabe
    /// contestar, pregunta y cierra: no queda sesión abierta ni se registra nada,
    /// porque esto se usa mientras el usuario todavía está escribiendo.
    /// </summary>
    public async Task<IReadOnlyList<string>> ListDatabasesAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        SshCredentials sshCredentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var validation = ConnectionProfileValidator.Validate(profile, Capabilities(profile));

        if (!validation.IsValid)
        {
            throw new ArgumentException(string.Join(" ", validation.Errors), nameof(profile));
        }

        var provider = _providers.GetProvider(profile.Engine);
        var reader = _providers.GetMetadataReader(profile.Engine);
        var tunnel = await OpenTunnelAsync(profile, sshCredentials, cancellationToken);

        await using (tunnel)
        {
            await using var session = await provider.OpenSessionAsync(
                Redirect(Asking(profile, provider), tunnel),
                credentials,
                cancellationToken);

            var databases = await reader.GetDatabasesAsync(session, cancellationToken);

            return [.. databases.Select(database => database.Name)];
        }
    }

    /// <summary>
    /// El perfil con el que se pregunta qué bases hay.
    ///
    /// Cuando el perfil ya nombra una base se usa esa —quien la escribió sabrá por
    /// qué—, y si no, la que cada motor tiene para esto.
    /// </summary>
    private static ConnectionProfile Asking(ConnectionProfile profile, IDatabaseProvider provider) =>
        string.IsNullOrWhiteSpace(profile.Database)
            ? profile with { Database = provider.DefaultDatabase }
            : profile;

    /// <summary>
    /// Cambia la sesión recién abierta por otra contra la base elegida.
    ///
    /// Solo pasa cuando el perfil no nombraba ninguna. Se elige **la primera a la
    /// que el usuario tenga acceso**, y las del propio motor se dejan para el
    /// final: quien abre una conexión quiere ver sus datos, no el catálogo del
    /// servidor.
    ///
    /// **Si preguntar falla, la sesión se queda como está.** Un usuario con
    /// permiso para entrar pero no para listar sigue teniendo una conexión que
    /// sirve, y perderla por un listado informativo sería cambiar algo que
    /// funciona por nada.
    /// </summary>
    private async Task<IDatabaseSession> ChosenAsync(
        IDatabaseProvider provider,
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<string> databases;

        try
        {
            var reader = _providers.GetMetadataReader(session.Engine);

            databases =
            [
                .. (await reader.GetDatabasesAsync(session, cancellationToken))
                    .Select(database => database.Name),
            ];
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return session;
        }

        var chosen = DatabaseChoice.Pick(databases, provider.SystemDatabases);

        if (chosen is null ||
            string.Equals(chosen, session.Profile.Database, StringComparison.OrdinalIgnoreCase))
        {
            return session;
        }

        IDatabaseSession elegida;

        try
        {
            elegida = await provider.OpenDatabaseSessionAsync(session, chosen, cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // La eligió el catálogo, así que abrirla suele funcionar; cuando no,
            // la de arranque sigue siendo una conexión que sirve, y quedarse sin
            // ninguna por esto sería peor que entrar por otra base.
            return session;
        }

        // La de arranque ya no la usa nadie: se abrió solo para poder preguntar.
        await session.DisposeAsync();

        return elegida;
    }

    /// <summary>Abre una sesión y la registra.</summary>
    public async Task<IDatabaseSession> OpenAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        SshCredentials sshCredentials,
        CancellationToken cancellationToken)
    {
        var validation = ConnectionProfileValidator.Validate(profile, Capabilities(profile));

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
                Redirect(Asking(profile, provider), tunnel),
                credentials,
                cancellationToken);

            // Sin base en el perfil, la que se acaba de abrir es solo desde donde
            // se pregunta: la buena se elige ahora, con la lista en la mano.
            if (string.IsNullOrWhiteSpace(profile.Database))
            {
                session = await ChosenAsync(provider, session, cancellationToken);
            }
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
