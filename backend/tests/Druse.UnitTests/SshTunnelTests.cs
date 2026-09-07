using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Infrastructure.Sessions;

namespace Druse.UnitTests;

/// <summary>
/// El túnel SSH, visto desde quien abre las conexiones.
///
/// Lo que importa aquí no es hablar SSH —de eso se encarga la librería— sino las
/// dos reglas que hacen que el túnel sea utilizable: el driver debe recibir la
/// dirección **local** del reenvío, y el túnel no debe sobrevivir a la sesión que
/// lo justificaba.
/// </summary>
public sealed class SshTunnelTests
{
    private static ConnectionProfile Profile(SshTunnelSettings? tunnel = null) => new()
    {
        Id = Guid.NewGuid(),
        Name = "Con túnel",
        Engine = DatabaseEngine.PostgreSql,
        Host = "db.interna",
        Port = 5432,
        Database = "app",
        Username = "lector",
        SshTunnel = tunnel,
    };

    private static SshTunnelSettings Tunnel() => new()
    {
        Host = "bastion.empresa.com",
        Port = 22,
        Username = "operador",
    };

    private static (ConnectionService Service, FakeProvider Provider, FakeTunnelFactory Tunnels)
        Build()
    {
        var provider = new FakeProvider();
        var tunnels = new FakeTunnelFactory();

        var service = new ConnectionService(
            new FakeRegistry(provider),
            new SessionRegistry(),
            tunnels,
            new SshTunnelRegistry());

        return (service, provider, tunnels);
    }

    [Fact]
    public async Task SinTunelElDriverRecibeElServidorTalCual()
    {
        var (service, provider, tunnels) = Build();

        await service.OpenAsync(
            Profile(),
            new DatabaseCredentials("secreta"),
            default,
            CancellationToken.None);

        Assert.Equal("db.interna", provider.LastProfile?.Host);
        Assert.Equal(5432, provider.LastProfile?.Port);
        Assert.Equal(0, tunnels.Opened);
    }

    [Fact]
    public async Task ConTunelElDriverRecibeElExtremoLocal()
    {
        var (service, provider, tunnels) = Build();

        await service.OpenAsync(
            Profile(Tunnel()),
            new DatabaseCredentials("secreta"),
            new SshCredentials("clave-ssh", null),
            CancellationToken.None);

        // El servidor real solo lo conoce la máquina intermedia; este equipo
        // habla con el puerto que abrió el reenvío.
        Assert.Equal("127.0.0.1", provider.LastProfile?.Host);
        Assert.Equal(FakeTunnel.LocalPort, provider.LastProfile?.Port);

        // Y el reenvío apunta a donde decía el perfil.
        Assert.Equal("db.interna", tunnels.LastRemoteHost);
        Assert.Equal(5432, tunnels.LastRemotePort);
        Assert.Equal("clave-ssh", tunnels.LastCredentials.Secret);
    }

    [Fact]
    public async Task CerrarLaSesionCierraElTunel()
    {
        var (service, _, tunnels) = Build();

        var session = await service.OpenAsync(
            Profile(Tunnel()),
            new DatabaseCredentials("secreta"),
            default,
            CancellationToken.None);

        Assert.False(tunnels.Last!.Disposed);

        await service.CloseAsync(session.Id);

        Assert.True(tunnels.Last.Disposed);
    }

    [Fact]
    public async Task SiLaConexionFallaElTunelNoQuedaAbierto()
    {
        var (service, provider, tunnels) = Build();
        provider.FailOnOpen = true;

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.OpenAsync(
            Profile(Tunnel()),
            new DatabaseCredentials("secreta"),
            default,
            CancellationToken.None));

        // Un túnel sin conexión que lo use es un puerto abierto para nadie.
        Assert.True(tunnels.Last!.Disposed);
    }

    [Fact]
    public async Task UnTunelQueNoAbreSeCuentaComoPruebaFallida()
    {
        var (service, _, tunnels) = Build();
        tunnels.Failure = "El servidor SSH rechazó las credenciales.";

        var result = await service.TestAsync(
            Profile(Tunnel()),
            new DatabaseCredentials("secreta"),
            default,
            CancellationToken.None);

        // No es un error de la API: la prueba se hizo y su respuesta es que no se
        // pudo llegar, con el motivo escrito para enseñarlo.
        Assert.False(result.Succeeded);
        Assert.Equal("El servidor SSH rechazó las credenciales.", result.Error?.Message);
    }

    [Fact]
    public async Task ProbarLaConexionNoDejaElTunelAbierto()
    {
        var (service, _, tunnels) = Build();

        await service.TestAsync(
            Profile(Tunnel()),
            new DatabaseCredentials("secreta"),
            default,
            CancellationToken.None);

        Assert.True(tunnels.Last!.Disposed);
    }

    /// <summary>
    /// Probar el túnel a solas: hasta dónde se llegó.
    ///
    /// Es lo que «probar conexión» no sabe decir. Allí, que el servidor
    /// intermedio no te deje entrar y que desde él no se alcance la base salen
    /// con la misma cara, y se arreglan en sitios distintos.
    /// </summary>
    [Fact]
    public async Task SinServidorIntermedioNoHayNadaQueProbar()
    {
        var (service, _, tunnels) = Build();

        var result = await service.TestTunnelAsync(Profile(), default, CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(TunnelReach.NotConfigured, result.Reach);
        Assert.Equal(0, tunnels.Opened);
    }

    [Fact]
    public async Task SiElServidorIntermedioNoDejaEntrarSeDiceAsi()
    {
        var (service, _, tunnels) = Build();
        tunnels.Failure = "Usuario o clave incorrectos en bastion.empresa.com.";

        var result = await service.TestTunnelAsync(
            Profile(Tunnel()),
            default,
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(TunnelReach.Bastion, result.Reach);
        Assert.Equal("Usuario o clave incorrectos en bastion.empresa.com.", result.Error?.Message);
    }

    /// <summary>
    /// Se entra en el servidor intermedio pero el destino no responde.
    ///
    /// El túnel se abre igual —SSH no comprueba el otro extremo hasta que algo
    /// pasa por él—, así que sin abrir un socket esto se daría por bueno.
    /// </summary>
    [Fact]
    public async Task SiDesdeAlliNoSeLlegaALaBaseSeDistingueDelOtroFallo()
    {
        var (service, _, tunnels) = Build();

        // Un puerto que nadie escucha: el reenvío existe, el destino no.
        tunnels.LocalPort = PuertoLibre();

        var result = await service.TestTunnelAsync(
            Profile(Tunnel()),
            default,
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(TunnelReach.Forward, result.Reach);

        // El mensaje nombra el destino que escribió el usuario, no el puerto
        // local del reenvío, que no le dice nada a nadie.
        Assert.Contains("db.interna:5432", result.Error?.Message ?? "", StringComparison.Ordinal);
        Assert.Contains("bastion.empresa.com", result.Error?.Message ?? "", StringComparison.Ordinal);
    }

    [Fact]
    public async Task CuandoElCaminoEnteroFuncionaSeDiceCompleto()
    {
        var (service, _, tunnels) = Build();

        // Algo que sí escucha al otro lado del reenvío.
        using var listener = new System.Net.Sockets.TcpListener(
            System.Net.IPAddress.Loopback,
            0);

        listener.Start();
        tunnels.LocalPort = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;

        var result = await service.TestTunnelAsync(
            Profile(Tunnel()),
            default,
            CancellationToken.None);

        listener.Stop();

        Assert.True(result.Succeeded);
        Assert.Equal(TunnelReach.Complete, result.Reach);
        Assert.Null(result.Error);
    }

    /// <summary>Probar no deja nada abierto: el túnel se cierra al terminar.</summary>
    [Fact]
    public async Task ProbarElTunelNoDejaElTunelAbierto()
    {
        var (service, _, tunnels) = Build();
        tunnels.LocalPort = PuertoLibre();

        await service.TestTunnelAsync(Profile(Tunnel()), default, CancellationToken.None);

        Assert.True(tunnels.Last?.Disposed);
    }

    /// <summary>Un puerto de bucle local que nadie está usando.</summary>
    private static int PuertoLibre()
    {
        var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);

        listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();

        return port;
    }

    private sealed class FakeTunnelFactory : ISshTunnelFactory
    {
        public int Opened { get; private set; }

        public FakeTunnel? Last { get; private set; }

        public string? LastRemoteHost { get; private set; }

        public int LastRemotePort { get; private set; }

        public SshCredentials LastCredentials { get; private set; }

        /// <summary>Cuando tiene valor, abrir el túnel falla con ese mensaje.</summary>
        public string? Failure { get; set; }

        /// <summary>Puerto local del túnel que se entrega. Cero deja el de siempre.</summary>
        public int LocalPort { get; set; }

        public Task<ISshTunnel> OpenAsync(
            SshTunnelSettings settings,
            SshCredentials credentials,
            string remoteHost,
            int remotePort,
            CancellationToken cancellationToken)
        {
            if (Failure is not null)
            {
                throw new SshTunnelException(Failure);
            }

            Opened++;
            LastRemoteHost = remoteHost;
            LastRemotePort = remotePort;
            LastCredentials = credentials;
            Last = new FakeTunnel { LocalPortOverride = LocalPort };

            return Task.FromResult<ISshTunnel>(Last);
        }
    }

    private sealed class FakeTunnel : ISshTunnel
    {
        public const int LocalPort = 54_321;

        /// <summary>
        /// Puerto al que apunta el extremo local.
        ///
        /// Configurable porque probar el túnel **abre un socket de verdad** contra
        /// él: para el camino feliz hay que apuntarlo a algo que escuche.
        /// </summary>
        public int LocalPortOverride { get; init; }

        public bool Disposed { get; private set; }

        public string Host => "127.0.0.1";

        public int Port => LocalPortOverride == 0 ? LocalPort : LocalPortOverride;

        public bool IsOpen => !Disposed;

        public ValueTask DisposeAsync()
        {
            Disposed = true;
            return ValueTask.CompletedTask;
        }
    }

    /// <summary>Proveedor que no habla con ningún motor; solo anota qué le pidieron.</summary>
    private sealed class FakeProvider : IDatabaseProvider
    {
        public ConnectionProfile? LastProfile { get; private set; }

        public bool FailOnOpen { get; set; }

        public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

        public int DefaultPort => 5432;

        public string DefaultDatabase => "postgres";

        public IReadOnlyList<string> SystemDatabases => ["postgres"];

        public Task<TestConnectionResult> TestConnectionAsync(
            ConnectionProfile profile,
            DatabaseCredentials credentials,
            CancellationToken cancellationToken)
        {
            LastProfile = profile;

            return Task.FromResult(TestConnectionResult.Success("18.0", TimeSpan.Zero));
        }

        public Task<IDatabaseSession> OpenSessionAsync(
            ConnectionProfile profile,
            DatabaseCredentials credentials,
            CancellationToken cancellationToken)
        {
            LastProfile = profile;

            if (FailOnOpen)
            {
                throw new InvalidOperationException("no se pudo abrir");
            }

            return Task.FromResult<IDatabaseSession>(new FakeSession(profile));
        }

        public Task<IDatabaseSession> OpenDatabaseSessionAsync(
            IDatabaseSession source,
            string database,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    private sealed class FakeSession(ConnectionProfile profile) : IDatabaseSession
    {
        private bool _disposed;

        public Guid Id { get; } = Guid.NewGuid();

        public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

        /// <summary>No habla con ningún motor, así que no hay dónde abrir una.</summary>
        public SessionTransaction Transaction => SessionTransaction.None;

        public ConnectionProfile Profile => profile;

        /// <summary>Los dobles no hablan con ningún motor: no hay nada que garantizar.</summary>
        public bool ReadOnlyEnforcedByEngine => false;

        public string ServerVersion => "18.0";

        public bool IsOpen => !_disposed;

        public ValueTask DisposeAsync()
        {
            _disposed = true;
            return ValueTask.CompletedTask;
        }
    }

    /// <summary>
    /// Registro con un solo proveedor.
    ///
    /// Las demás piezas del motor no se usan al abrir una conexión, así que se
    /// dejan sin implementar en lugar de escribir dobles que nadie llamaría.
    /// </summary>
    private sealed class FakeRegistry(IDatabaseProvider provider) : IProviderRegistry
    {
        public IReadOnlyCollection<DatabaseEngine> SupportedEngines => [provider.Engine];

        public IDatabaseProvider GetProvider(DatabaseEngine engine) => provider;

        public IDatabaseMetadataReader GetMetadataReader(DatabaseEngine engine) =>
            throw new NotSupportedException();

        public IQueryExecutor GetQueryExecutor(DatabaseEngine engine) =>
            throw new NotSupportedException();

        public IRowEditor GetRowEditor(DatabaseEngine engine) =>
            throw new NotSupportedException();

        public ITableDesigner GetTableDesigner(DatabaseEngine engine) =>
            throw new NotSupportedException();

        public IDatabaseScripter GetScripter(DatabaseEngine engine) =>
            throw new NotSupportedException();
    }
}
