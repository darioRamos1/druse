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

    /// <summary>
    /// En SQL Server, «exigir cifrado» valía además por verificar el certificado:
    /// era el único modo que ponía `TrustServerCertificate` en falso. Desde que
    /// `Require` significa lo mismo en los cuatro motores —cifra y no comprueba—,
    /// dejar ese perfil como estaba le quitaría la verificación **sin decirlo**.
    ///
    /// La migración lo mueve a `VerifyFull`, que es lo que ya estaba haciendo.
    /// </summary>
    [Fact]
    public async Task UnPerfilDeSqlServerConRequire_SeMigraAVerifyFull()
    {
        var sqlServer = Profile("Producción") with
        {
            Engine = DatabaseEngine.SqlServer,
            SslMode = SslMode.Require,
        };

        var postgres = Profile("Desarrollo") with { SslMode = SslMode.Require };

        await _store.SaveAsync(sqlServer, CancellationToken.None);
        await _store.SaveAsync(postgres, CancellationToken.None);

        // Volver a migrar es lo que pasa al abrir Druse después de actualizar.
        await _database.MigrateAsync(CancellationToken.None);

        var migrado = await _store.FindAsync(sqlServer.Id, CancellationToken.None);
        var intacto = await _store.FindAsync(postgres.Id, CancellationToken.None);

        Assert.Equal(SslMode.VerifyFull, migrado?.SslMode);

        // Y solo SQL Server: en los demás motores `Require` siempre significó
        // cifrar sin comprobar, así que subirles el listón sería cambiarles la
        // conexión por su cuenta.
        Assert.Equal(SslMode.Require, intacto?.SslMode);
    }

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

/// <summary>
/// Las pestañas del editor, que es trabajo **sin ejecutar**: lo que se perdía al
/// cerrar porque el historial solo guarda lo que llegó a lanzarse.
/// </summary>
public sealed class EditorTabStoreTests : IDisposable
{
    private readonly TemporaryPaths _paths = new();
    private readonly SqliteEditorTabStore _store;

    public EditorTabStoreTests()
    {
        var database = new DruseDatabase(_paths);
        database.MigrateAsync(CancellationToken.None).GetAwaiter().GetResult();
        _store = new SqliteEditorTabStore(database);
    }

    public void Dispose() => _paths.Dispose();

    private static EditorTabState Tab(string id, string sql, bool active = false) => new()
    {
        Id = id,
        Title = id,
        Sql = sql,
        IsActive = active,
        IsDirty = true,
        ConnectionId = "conexion-1",
        Database = "druse_test",
    };

    [Fact]
    public async Task GuardaYDevuelveLoQueNoSeEjecuto()
    {
        await _store.ReplaceAllAsync(
            [Tab("uno", "SELECT 1"), Tab("dos", "-- a medio escribir\nSELECT", active: true)],
            CancellationToken.None);

        var tabs = await _store.GetAllAsync(CancellationToken.None);

        Assert.Equal(2, tabs.Count);
        Assert.Equal("SELECT 1", tabs[0].Sql);
        Assert.Equal("-- a medio escribir\nSELECT", tabs[1].Sql);
        Assert.True(tabs[1].IsActive);
        Assert.Equal("conexion-1", tabs[0].ConnectionId);
    }

    /// <summary>El orden de la barra es parte de lo que se recupera.</summary>
    [Fact]
    public async Task ConservaElOrden()
    {
        await _store.ReplaceAllAsync(
            [Tab("c", "3"), Tab("a", "1"), Tab("b", "2")],
            CancellationToken.None);

        var tabs = await _store.GetAllAsync(CancellationToken.None);

        Assert.Equal(["c", "a", "b"], tabs.Select(tab => tab.Id));
        Assert.Equal([0, 1, 2], tabs.Select(tab => tab.Position));
    }

    /// <summary>
    /// Guardar sustituye: una pestaña cerrada no puede volver sola la próxima vez
    /// que se abra la aplicación.
    /// </summary>
    [Fact]
    public async Task GuardarSustituyeLoAnterior()
    {
        await _store.ReplaceAllAsync(
            [Tab("uno", "SELECT 1"), Tab("dos", "SELECT 2")],
            CancellationToken.None);
        await _store.ReplaceAllAsync([Tab("uno", "SELECT 1")], CancellationToken.None);

        var tabs = await _store.GetAllAsync(CancellationToken.None);

        Assert.Equal("uno", Assert.Single(tabs).Id);
    }

    [Fact]
    public async Task SinNadaGuardadoNoDevuelveNada()
    {
        Assert.Empty(await _store.GetAllAsync(CancellationToken.None));
    }

    /// <summary>Sobrevive a cerrar la aplicación: el archivo es el mismo.</summary>
    [Fact]
    public async Task LoGuardadoSobreviveAReabrir()
    {
        await _store.ReplaceAllAsync([Tab("uno", "SELECT 1")], CancellationToken.None);

        var reopened = new SqliteEditorTabStore(new DruseDatabase(_paths));

        Assert.Equal("SELECT 1", Assert.Single(await reopened.GetAllAsync(CancellationToken.None)).Sql);
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
    public async Task EditarSinEscribirLaContrasenaLaConserva()
    {
        var profile = Profile();
        await _service.SaveAsync(profile, "secreta", storePassword: true, CancellationToken.None);

        // Es lo que llega al cambiar el nombre desde el formulario: la contraseña
        // guardada no se puede mostrar, así que el campo viaja ausente.
        var result = await _service.SaveAsync(
            profile with { Name = "Renombrada" },
            null,
            storePassword: true,
            CancellationToken.None);

        Assert.True(result.PasswordStored);
        Assert.Equal(
            "secreta",
            (await _service.GetCredentialsAsync(profile.Id, CancellationToken.None)).Password);
    }

    [Fact]
    public async Task UnaContrasenaVaciaSiLaRetira()
    {
        var profile = Profile();
        await _service.SaveAsync(profile, "secreta", storePassword: true, CancellationToken.None);

        // Vaciar el campo a propósito es una orden distinta de no tocarlo.
        var result = await _service.SaveAsync(
            profile,
            string.Empty,
            storePassword: true,
            CancellationToken.None);

        Assert.False(result.PasswordStored);
        Assert.False(await _service.HasStoredPasswordAsync(profile.Id, CancellationToken.None));
    }

    [Fact]
    public async Task EditarSinEscribirElSecretoDelTunelLoConserva()
    {
        var profile = Profile() with
        {
            SshTunnel = new SshTunnelSettings { Host = "bastion", Username = "operador" },
        };

        await _service.SaveAsync(
            profile,
            "secreta",
            storePassword: true,
            CancellationToken.None,
            "clave-ssh",
            storeSshSecret: true);

        var result = await _service.SaveAsync(
            profile with { Name = "Renombrada" },
            null,
            storePassword: true,
            CancellationToken.None,
            null,
            storeSshSecret: true);

        Assert.True(result.SshSecretStored);
        Assert.Equal(
            "clave-ssh",
            (await _service.GetSshCredentialsAsync(profile.Id, CancellationToken.None)).Secret);
    }

    [Fact]
    public async Task QuitarElTunelRetiraSuSecreto()
    {
        var profile = Profile() with
        {
            SshTunnel = new SshTunnelSettings { Host = "bastion", Username = "operador" },
        };

        await _service.SaveAsync(
            profile,
            null,
            storePassword: false,
            CancellationToken.None,
            "clave-ssh",
            storeSshSecret: true);

        await _service.SaveAsync(
            profile with { SshTunnel = null },
            null,
            storePassword: false,
            CancellationToken.None,
            null,
            storeSshSecret: true);

        // Sin túnel, ese secreto ya no abre nada: dejarlo sería ensuciar el
        // llavero del usuario.
        Assert.False(await _service.HasStoredSshSecretAsync(profile.Id, CancellationToken.None));
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
