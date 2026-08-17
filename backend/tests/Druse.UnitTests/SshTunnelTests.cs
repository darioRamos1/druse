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

    private sealed class FakeTunnelFactory : ISshTunnelFactory
    {
        public int Opened { get; private set; }

        public FakeTunnel? Last { get; private set; }

        public string? LastRemoteHost { get; private set; }

        public int LastRemotePort { get; private set; }

        public SshCredentials LastCredentials { get; private set; }

        /// <summary>Cuando tiene valor, abrir el túnel falla con ese mensaje.</summary>
        public string? Failure { get; set; }

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
            Last = new FakeTunnel();

            return Task.FromResult<ISshTunnel>(Last);
        }
    }

    private sealed class FakeTunnel : ISshTunnel
    {
        public const int LocalPort = 54_321;

        public bool Disposed { get; private set; }

        public string Host => "127.0.0.1";

        public int Port => LocalPort;

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
