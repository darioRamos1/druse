using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Domain;
using Druse.Persistence.Sqlite;
using Druse.Platform.Abstractions;

namespace Druse.UnitTests;

/// <summary>Rutas dentro de un directorio temporal, para no tocar los datos reales.</summary>
internal sealed class TemporaryPaths : IAppPaths, IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"druse-test-{Guid.NewGuid():N}");

    public string DataDirectory => _root;
    public string ConfigDirectory => _root;
    public string CacheDirectory => Path.Combine(_root, "cache");
    public string LogDirectory => Path.Combine(_root, "logs");
    public string DatabaseFile => Path.Combine(_root, "druse.db");

    public void EnsureCreated()
    {
        Directory.CreateDirectory(DataDirectory);
        Directory.CreateDirectory(CacheDirectory);
        Directory.CreateDirectory(LogDirectory);
    }

    public void Dispose()
    {
        // SQLite deja archivos -wal y -shm; se borra el directorio entero.
        try
        {
            if (Directory.Exists(_root))
            {
                Directory.Delete(_root, recursive: true);
            }
        }
        catch (IOException)
        {
            // En Windows el archivo puede seguir bloqueado un instante. No importa:
            // está en el directorio temporal del sistema.
        }
    }
}

public sealed class ConnectionProfileStoreTests : IDisposable
{
    private readonly TemporaryPaths _paths = new();
    private readonly DruseDatabase _database;
    private readonly SqliteConnectionProfileStore _store;

    public ConnectionProfileStoreTests()
    {
        _database = new DruseDatabase(_paths);
        _database.MigrateAsync(CancellationToken.None).GetAwaiter().GetResult();
        _store = new SqliteConnectionProfileStore(_database);
    }

    public void Dispose() => _paths.Dispose();

    private static ConnectionProfile Profile(string name = "Local") => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        Engine = DatabaseEngine.PostgreSql,
        Host = "127.0.0.1",
        Port = 5432,
        Database = "druse_test",
        Username = "postgres",
        Environment = ConnectionEnvironment.Production,
        ReadOnly = true,
        ConnectTimeoutSeconds = 20,
    };

    [Fact]
    public async Task GuardaYRecuperaUnPerfilCompleto()
    {
        var profile = Profile();

        await _store.SaveAsync(profile, CancellationToken.None);

        var recovered = await _store.FindAsync(profile.Id, CancellationToken.None);

        Assert.NotNull(recovered);
        Assert.Equal(profile.Name, recovered.Name);
        Assert.Equal(profile.Engine, recovered.Engine);
        Assert.Equal(profile.Port, recovered.Port);
        Assert.Equal(ConnectionEnvironment.Production, recovered.Environment);
        Assert.True(recovered.ReadOnly);
        Assert.Equal(20, recovered.ConnectTimeoutSeconds);
    }

    [Fact]
    public async Task ConservaLaAutenticacionDeWindows()
    {
        var profile = Profile("Integrada") with
        {
            Engine = DatabaseEngine.SqlServer,
            Username = string.Empty,
            Authentication = AuthenticationMode.Windows,
        };

        await _store.SaveAsync(profile, CancellationToken.None);

        var recovered = await _store.FindAsync(profile.Id, CancellationToken.None);

        Assert.NotNull(recovered);
        Assert.Equal(AuthenticationMode.Windows, recovered.Authentication);
        Assert.True(recovered.UsesIntegratedSecurity);
    }

    [Fact]
    public async Task GuardaYRecuperaElTunelSsh()
    {
        var profile = Profile("Con túnel") with
        {
            SshTunnel = new SshTunnelSettings
            {
                Host = "bastion.empresa.com",
                Port = 2222,
                Username = "operador",
                Authentication = SshAuthenticationMode.PrivateKey,
                PrivateKeyPath = @"C:\claves\id_ed25519",
                ConnectTimeoutSeconds = 25,
            },
        };

        await _store.SaveAsync(profile, CancellationToken.None);

        var recovered = await _store.FindAsync(profile.Id, CancellationToken.None);

        Assert.NotNull(recovered?.SshTunnel);
        Assert.Equal("bastion.empresa.com", recovered.SshTunnel.Host);
        Assert.Equal(2222, recovered.SshTunnel.Port);
        Assert.Equal("operador", recovered.SshTunnel.Username);
        Assert.Equal(SshAuthenticationMode.PrivateKey, recovered.SshTunnel.Authentication);
        Assert.Equal(@"C:\claves\id_ed25519", recovered.SshTunnel.PrivateKeyPath);
        Assert.Equal(25, recovered.SshTunnel.ConnectTimeoutSeconds);
    }

    [Fact]
    public async Task QuitarElTunelLoBorraDelPerfil()
    {
        var profile = Profile("Con túnel") with
        {
            SshTunnel = new SshTunnelSettings { Host = "bastion", Username = "operador" },
        };

        await _store.SaveAsync(profile, CancellationToken.None);
        await _store.SaveAsync(profile with { SshTunnel = null }, CancellationToken.None);

        var recovered = await _store.FindAsync(profile.Id, CancellationToken.None);

        Assert.Null(recovered?.SshTunnel);
    }

    [Fact]
    public async Task UnPerfilSinTunelGuardadoConectaDirecto()
    {
        var profile = Profile("Directa");

        await _store.SaveAsync(profile, CancellationToken.None);

        Assert.Null((await _store.FindAsync(profile.Id, CancellationToken.None))?.SshTunnel);
    }

    [Fact]
    public async Task UnPerfilSinMetodoGuardadoUsaContrasena()
    {
        var profile = Profile("Heredada");

        await _store.SaveAsync(profile, CancellationToken.None);

        var recovered = await _store.FindAsync(profile.Id, CancellationToken.None);

        Assert.Equal(AuthenticationMode.Password, recovered?.Authentication);
    }

    [Fact]
    public async Task LosDatosSobrevivenAReabrirLaBase()
    {
        var profile = Profile("Persistente");
        await _store.SaveAsync(profile, CancellationToken.None);

        // Instancia nueva sobre el mismo archivo: es lo que ocurre al reiniciar.
        var reopened = new SqliteConnectionProfileStore(new DruseDatabase(_paths));

        Assert.NotNull(await reopened.FindAsync(profile.Id, CancellationToken.None));
    }

    [Fact]
    public async Task GuardarDosVecesActualizaEnLugarDeDuplicar()
    {
        var profile = Profile("Original");
        await _store.SaveAsync(profile, CancellationToken.None);
        await _store.SaveAsync(profile with { Name = "Renombrada" }, CancellationToken.None);

        var all = await _store.GetAllAsync(CancellationToken.None);

        Assert.Single(all);
        Assert.Equal("Renombrada", all[0].Name);
    }

    [Fact]
    public async Task DevuelveLosPerfilesOrdenadosPorNombre()
    {
        await _store.SaveAsync(Profile("Zeta"), CancellationToken.None);
        await _store.SaveAsync(Profile("alfa"), CancellationToken.None);
        await _store.SaveAsync(Profile("Media"), CancellationToken.None);

        var names = (await _store.GetAllAsync(CancellationToken.None)).Select(p => p.Name);

        Assert.Equal(["alfa", "Media", "Zeta"], names);
    }

    [Fact]
    public async Task BorrarDevuelveSiExistia()
    {
        var profile = Profile();
        await _store.SaveAsync(profile, CancellationToken.None);

        Assert.True(await _store.DeleteAsync(profile.Id, CancellationToken.None));
        Assert.False(await _store.DeleteAsync(profile.Id, CancellationToken.None));
    }

    [Fact]
    public async Task LaTablaDePerfilesNoTieneColumnaDeContrasena()
    {
        await _store.SaveAsync(Profile(), CancellationToken.None);

        await using var connection = await _database.OpenAsync(CancellationToken.None);
        await using var command = connection.CreateCommand();

        command.CommandText = "SELECT name FROM pragma_table_info('connection_profiles');";

        await using var reader = await command.ExecuteReaderAsync(CancellationToken.None);

        var columns = new List<string>();

        while (await reader.ReadAsync(CancellationToken.None))
        {
            columns.Add(reader.GetString(0));
        }

        // Comprobación directa sobre el esquema: las contraseñas van al almacén
        // del sistema operativo, nunca aquí (plan §12).
        Assert.NotEmpty(columns);
        Assert.DoesNotContain(columns, column =>
            column.Contains("password", StringComparison.OrdinalIgnoreCase) ||
            column.Contains("secret", StringComparison.OrdinalIgnoreCase) ||
            column.Contains("credential", StringComparison.OrdinalIgnoreCase));
    }
}

public sealed class QueryHistoryStoreTests : IDisposable
{
    private readonly TemporaryPaths _paths = new();
    private readonly SqliteQueryHistoryStore _store;

    public QueryHistoryStoreTests()
    {
        var database = new DruseDatabase(_paths);
        database.MigrateAsync(CancellationToken.None).GetAwaiter().GetResult();
        _store = new SqliteQueryHistoryStore(database);
    }

    public void Dispose() => _paths.Dispose();

    private static QueryHistoryEntry Entry(string sql, bool succeeded = true, int minutesAgo = 0) => new()
    {
        Id = Guid.NewGuid(),
        ConnectionId = Guid.NewGuid(),
        ConnectionName = "Local",
        Database = "druse_test",
        Sql = sql,
        ExecutedAtUtc = DateTimeOffset.UtcNow.AddMinutes(-minutesAgo),
        DurationMs = 12,
        Succeeded = succeeded,
        RowCount = succeeded ? 5 : null,
        ErrorMessage = succeeded ? null : "error de sintaxis",
    };

    [Fact]
    public async Task GuardaYDevuelveLasEntradas()
    {
        await _store.AddAsync(Entry("SELECT 1"), CancellationToken.None);

        var recent = await _store.GetRecentAsync(10, null, CancellationToken.None);

        var entry = Assert.Single(recent);
        Assert.Equal("SELECT 1", entry.Sql);
        Assert.True(entry.Succeeded);
        Assert.Equal(5, entry.RowCount);
    }

    [Fact]
    public async Task DevuelveLoMasRecientePrimero()
    {
        await _store.AddAsync(Entry("SELECT 'antigua'", minutesAgo: 30), CancellationToken.None);
        await _store.AddAsync(Entry("SELECT 'reciente'", minutesAgo: 1), CancellationToken.None);

        var recent = await _store.GetRecentAsync(10, null, CancellationToken.None);

        Assert.Equal("SELECT 'reciente'", recent[0].Sql);
    }

    [Fact]
    public async Task GuardaLasEjecucionesFallidasConSuError()
    {
        await _store.AddAsync(Entry("SELECT * FROM", succeeded: false), CancellationToken.None);

        var entry = Assert.Single(await _store.GetRecentAsync(10, null, CancellationToken.None));

        Assert.False(entry.Succeeded);
        Assert.Equal("error de sintaxis", entry.ErrorMessage);
        Assert.Null(entry.RowCount);
    }

    [Fact]
    public async Task FiltraPorTexto()
    {
        await _store.AddAsync(Entry("SELECT * FROM usuarios"), CancellationToken.None);
        await _store.AddAsync(Entry("SELECT * FROM pedidos"), CancellationToken.None);

        var found = await _store.GetRecentAsync(10, "usuarios", CancellationToken.None);

        Assert.Single(found);
        Assert.Contains("usuarios", found[0].Sql, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ElTextoDeBusquedaNoAlteraElPatron()
    {
        await _store.AddAsync(Entry("SELECT * FROM usuarios"), CancellationToken.None);

        // Un comodín escrito por el usuario debe buscarse literalmente, no
        // interpretarse como «todo».
        var found = await _store.GetRecentAsync(10, "%", CancellationToken.None);

        Assert.Empty(found);
    }

    [Fact]
    public async Task RespetaElLimite()
    {
        for (var i = 0; i < 5; i++)
        {
            await _store.AddAsync(Entry($"SELECT {i}"), CancellationToken.None);
        }

        Assert.Equal(2, (await _store.GetRecentAsync(2, null, CancellationToken.None)).Count);
    }

    [Fact]
    public async Task SePuedeVaciarPorCompleto()
    {
        await _store.AddAsync(Entry("SELECT 1"), CancellationToken.None);
        await _store.AddAsync(Entry("SELECT 2"), CancellationToken.None);

        Assert.Equal(2, await _store.ClearAsync(CancellationToken.None));
        Assert.Empty(await _store.GetRecentAsync(10, null, CancellationToken.None));
    }
}

public sealed class PreferencesStoreTests : IDisposable
{
    private readonly TemporaryPaths _paths = new();
    private readonly SqlitePreferencesStore _store;

    public PreferencesStoreTests()
    {
        var database = new DruseDatabase(_paths);
        database.MigrateAsync(CancellationToken.None).GetAwaiter().GetResult();
        _store = new SqlitePreferencesStore(database);
    }

    public void Dispose() => _paths.Dispose();

    [Fact]
    public async Task GuardaYRecupera()
    {
        await _store.SetAsync("editor.fontSize", "13", CancellationToken.None);

        Assert.Equal("13", await _store.GetAsync("editor.fontSize", CancellationToken.None));
    }

    [Fact]
    public async Task GuardarDosVecesReemplaza()
    {
        await _store.SetAsync("tema", "oscuro", CancellationToken.None);
        await _store.SetAsync("tema", "claro", CancellationToken.None);

        Assert.Equal("claro", await _store.GetAsync("tema", CancellationToken.None));
    }

    [Fact]
    public async Task UnaClaveDesconocidaDevuelveNulo()
    {
        Assert.Null(await _store.GetAsync("no.existe", CancellationToken.None));
    }
}

/// <summary>Reparto entre la base local y el almacén de secretos.</summary>
public sealed class SavedConnectionServiceTests : IDisposable
{
    private readonly TemporaryPaths _paths = new();
    private readonly SqliteConnectionProfileStore _profiles;
    private readonly FakeSecretStore _secrets = new();
    private readonly SavedConnectionService _service;

    public SavedConnectionServiceTests()
    {
        var database = new DruseDatabase(_paths);
        database.MigrateAsync(CancellationToken.None).GetAwaiter().GetResult();

        _profiles = new SqliteConnectionProfileStore(database);
        _service = new SavedConnectionService(_profiles, _secrets);
    }

    public void Dispose() => _paths.Dispose();

    private static ConnectionProfile Profile() => new()
    {
        Id = Guid.NewGuid(),
        Name = "Local",
        Engine = DatabaseEngine.PostgreSql,
        Host = "127.0.0.1",
        Port = 5432,
        Database = "druse_test",
        Username = "postgres",
    };

    [Fact]
    public async Task GuardaElPerfilYLaContrasenaPorSeparado()
    {
        var profile = Profile();

        var result = await _service.SaveAsync(profile, "secreta", storePassword: true, CancellationToken.None);

        Assert.True(result.PasswordStored);
        Assert.NotNull(await _profiles.FindAsync(profile.Id, CancellationToken.None));

        var credentials = await _service.GetCredentialsAsync(profile.Id, CancellationToken.None);
        Assert.Equal("secreta", credentials.Password);
    }

    [Fact]
    public async Task NoGuardaLaContrasenaSiNoSePide()
    {
        var profile = Profile();

        var result = await _service.SaveAsync(profile, "secreta", storePassword: false, CancellationToken.None);

        Assert.False(result.PasswordStored);
        Assert.Empty(_secrets.Entries);
    }

    [Fact]
    public async Task DejarDeRecordarLaContrasenaLaRetira()
    {
        var profile = Profile();
        await _service.SaveAsync(profile, "secreta", storePassword: true, CancellationToken.None);

        await _service.SaveAsync(profile, null, storePassword: false, CancellationToken.None);

        // Dejarla ahí contradiría lo que el usuario acaba de elegir.
        Assert.Empty(_secrets.Entries);
        Assert.False(await _service.HasStoredPasswordAsync(profile.Id, CancellationToken.None));
    }

    [Fact]
    public async Task BorrarElPerfilBorraTambienLaContrasena()
    {
        var profile = Profile();
        await _service.SaveAsync(profile, "secreta", storePassword: true, CancellationToken.None);

        await _service.DeleteAsync(profile.Id, CancellationToken.None);

        Assert.Empty(_secrets.Entries);
        Assert.Null(await _profiles.FindAsync(profile.Id, CancellationToken.None));
    }

    [Fact]
    public async Task SinAlmacenDisponibleLoDiceEnLugarDeFallar()
    {
        var service = new SavedConnectionService(_profiles, new NullSecretStore());

        var result = await service.SaveAsync(Profile(), "secreta", storePassword: true, CancellationToken.None);

        Assert.False(result.PasswordStored);
        Assert.False(service.CanStorePasswords);
    }

    [Fact]
    public async Task RechazaUnPerfilInvalido()
    {
        var invalid = Profile() with { Host = "", Port = 0 };

        await Assert.ThrowsAsync<ArgumentException>(
            () => _service.SaveAsync(invalid, null, false, CancellationToken.None));
    }

    private sealed class FakeSecretStore : ISecretStore
    {
        public Dictionary<string, string> Entries { get; } = new(StringComparer.Ordinal);

        public bool IsAvailable => true;

        public string Description => "Almacén de prueba";

        public Task SetAsync(string key, string secret, CancellationToken cancellationToken)
        {
            Entries[key] = secret;
            return Task.CompletedTask;
        }

        public Task<string?> GetAsync(string key, CancellationToken cancellationToken) =>
            Task.FromResult(Entries.TryGetValue(key, out var secret) ? secret : null);

        public Task DeleteAsync(string key, CancellationToken cancellationToken)
        {
            Entries.Remove(key);
            return Task.CompletedTask;
        }
    }
}
