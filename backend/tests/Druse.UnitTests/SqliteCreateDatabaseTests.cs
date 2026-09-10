using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.PostgreSql;
using Druse.Provider.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// Crear una base, que es lo contrario de abrirla.
///
/// Va aquí y no en las contractuales porque **no hace falta ningún servidor**:
/// el motor es un archivo y lo que se comprueba es qué deja en el disco. Y
/// porque lo que importa comprobar son los tres «no»: no crea al abrir, no
/// machaca lo que ya está, y no lo puede hacer un motor que no sabe.
/// </summary>
public sealed class SqliteCreateDatabaseTests : IDisposable
{
    private readonly string _carpeta = Path.Combine(
        Path.GetTempPath(),
        $"druse-crear-{Guid.NewGuid():N}");

    private readonly SqliteDatabaseProvider _provider = new();

    public SqliteCreateDatabaseTests() => Directory.CreateDirectory(_carpeta);

    public void Dispose()
    {
        try
        {
            Directory.Delete(_carpeta, recursive: true);
        }
        catch (IOException)
        {
            // El sistema se lleva su carpeta temporal cuando le toca.
        }
    }

    private ConnectionProfile Profile(string archivo) => new()
    {
        Id = Guid.NewGuid(),
        Name = "SQLite",
        Engine = DatabaseEngine.Sqlite,
        Host = string.Empty,
        Port = 0,
        Database = Path.Combine(_carpeta, archivo),
        Username = string.Empty,
    };

    /// <summary>
    /// Lo que se crea es **una base**, no un archivo vacío.
    ///
    /// Es la trampa del motor: abrir en modo de creación deja el archivo a cero
    /// bytes hasta la primera escritura, y un archivo de cero bytes no se puede
    /// abrir después —cualquier consulta falla con «file is not a database»—. Por
    /// eso la prueba no se conforma con que exista: lo abre y lo consulta.
    /// </summary>
    [Fact]
    public async Task CrearDejaUnaBaseQueSePuedeAbrir()
    {
        var profile = Profile("nueva.db");

        await _provider.CreateDatabaseAsync(profile, default, CancellationToken.None);

        Assert.True(File.Exists(profile.Database));

        var result = await _provider.TestConnectionAsync(
            profile,
            default,
            CancellationToken.None);

        Assert.True(result.Succeeded, result.Error?.Message);
    }

    /// <summary>
    /// **Abrir no crea.** Es la decisión que hace que una ruta mal escrita se
    /// note: si abrir creara el archivo, un error de tecleo dejaría una base
    /// vacía en el disco y una conexión que parece funcionar.
    /// </summary>
    [Fact]
    public async Task AbrirLoQueNoEstaFallaYNoDejaNadaEnElDisco()
    {
        var profile = Profile("no-existe.db");

        var result = await _provider.TestConnectionAsync(
            profile,
            default,
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.False(File.Exists(profile.Database));
    }

    /// <summary>
    /// Crear sobre algo que ya está **no lo toca**.
    ///
    /// Vaciar una base con un botón que pone «crear» sería borrarla sin avisar, y
    /// esa es la clase de error que no se puede deshacer.
    /// </summary>
    [Fact]
    public async Task CrearSobreLoQueYaEstaNoLoMachaca()
    {
        var profile = Profile("ocupado.db");

        await File.WriteAllTextAsync(profile.Database, "esto no es una base");

        var error = await Assert.ThrowsAsync<DatabaseOperationException>(() =>
            _provider.CreateDatabaseAsync(profile, default, CancellationToken.None));

        Assert.Contains("Ya hay un archivo", error.Error.Message, StringComparison.Ordinal);
        Assert.Equal("esto no es una base", await File.ReadAllTextAsync(profile.Database));
    }

    /// <summary>
    /// Un motor que no lo declara **lanza**, en vez de contestar que no hizo nada.
    ///
    /// Llegar ahí es un error de quien llama, y devolver un «no» silencioso lo
    /// dejaría pasar sin que nadie se enterara.
    /// </summary>
    [Fact]
    public async Task UnMotorQueNoSabeCrearLoDice()
    {
        // Se pide por la interfaz a propósito: la implementación por omisión vive
        // ahí, y un proveedor que no la reescriba es exactamente lo que se está
        // comprobando.
        IDatabaseProvider postgres = new PostgreSqlDatabaseProvider();

        Assert.False(postgres.Capabilities.CanCreateDatabase);

        await Assert.ThrowsAsync<NotSupportedException>(() =>
            postgres.CreateDatabaseAsync(
                Profile("da-igual.db") with { Engine = DatabaseEngine.PostgreSql },
                default,
                CancellationToken.None));
    }
}
