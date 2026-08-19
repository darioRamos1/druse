using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using MySqlConnector;

namespace Druse.Provider.MySql;

/// <summary>Sesión MySQL. Envuelve la conexión de MySqlConnector sin dejarla salir.</summary>
internal sealed class MySqlSession : IDatabaseSession
{
    private bool _disposed;

    public MySqlSession(
        Guid id,
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        MySqlConnection connection)
    {
        Id = id;
        Profile = profile;
        Credentials = credentials;
        Connection = connection;
        Transaction = new SessionTransaction(connection);
        ServerVersion = connection.ServerVersion;
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => DatabaseEngine.MySql;

    public ConnectionProfile Profile { get; }

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    /// <summary>
    /// La transacción manual de esta conexión. Las reglas viven en la clase
    /// compartida; aquí solo se le da la conexión sobre la que trabajar.
    /// </summary>
    public SessionTransaction Transaction { get; }

    /// <summary>Solo accesible dentro del proveedor.</summary>
    internal MySqlConnection Connection { get; }

    /// <summary>Solo se usa para abrir otra base del mismo servidor.</summary>
    internal DatabaseCredentials Credentials { get; private set; }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        // Lo que no se confirmó, se pierde: deshacerlo aquí lo deja explícito
        // en vez de depender de lo que haga el driver al cerrar.
        await Transaction.DisposeAsync();
        Credentials = default;
        await Connection.DisposeAsync();
    }
}

/// <summary>
/// Proveedor MySQL sobre MySqlConnector.
///
/// Sirve también para MariaDB: el protocolo y el catálogo `information_schema`
/// que usa el lector de metadatos son comunes a ambos. No se declara un motor
/// aparte porque nada de lo que hace el proveedor se bifurca por el sabor del
/// servidor; si algún día hiciera falta, saldría de `ServerVersion`.
/// </summary>
public sealed class MySqlDatabaseProvider : IDatabaseProvider
{
    public DatabaseEngine Engine => DatabaseEngine.MySql;

    public int DefaultPort => 3306;

    /// <summary>
    /// Vacía a propósito: MySQL conecta sin base, y entonces preguntar cuáles hay
    /// no depende de acertar con ninguna.
    /// </summary>
    public string DefaultDatabase => string.Empty;

    public IReadOnlyList<string> SystemDatabases =>
        ["information_schema", "mysql", "performance_schema", "sys"];

    public async Task<TestConnectionResult> TestConnectionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await using var connection = new MySqlConnection(
                MySqlConnectionStringFactory.Build(profile, credentials));

            await connection.OpenAsync(cancellationToken);

            stopwatch.Stop();
            return TestConnectionResult.Success(connection.ServerVersion, stopwatch.Elapsed);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            stopwatch.Stop();
            return TestConnectionResult.Failure(
                MySqlErrorNormalizer.Normalize(exception),
                stopwatch.Elapsed);
        }
    }

    public async Task<IDatabaseSession> OpenSessionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var connection = new MySqlConnection(
            MySqlConnectionStringFactory.Build(profile, credentials));

        try
        {
            await connection.OpenAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            await connection.DisposeAsync();
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Si abrir falla, la conexión no debe quedar viva a medias.
            await connection.DisposeAsync();

            // Y el motivo se cuenta: «la contraseña no es correcta» es algo que
            // el usuario puede arreglar; «error inesperado», no.
            throw new DatabaseOperationException(MySqlErrorNormalizer.Normalize(exception));
        }

        // El identificador es aleatorio a propósito: es lo que viaja por HTTP y no
        // debe poder adivinarse (plan §12).
        return new MySqlSession(Guid.NewGuid(), profile, credentials, connection);
    }

    public Task<IDatabaseSession> OpenDatabaseSessionAsync(
        IDatabaseSession source,
        string database,
        CancellationToken cancellationToken)
    {
        if (source is not MySqlSession mysql || !mysql.IsOpen)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor MySQL o ya está cerrada.",
                nameof(source));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(database);

        return OpenSessionAsync(
            mysql.Profile with { Database = database },
            mysql.Credentials,
            cancellationToken);
    }
}
