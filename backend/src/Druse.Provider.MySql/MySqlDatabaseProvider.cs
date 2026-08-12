using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using MySqlConnector;

namespace Druse.Provider.MySql;

/// <summary>Sesión MySQL. Envuelve la conexión de MySqlConnector sin dejarla salir.</summary>
internal sealed class MySqlSession : IDatabaseSession
{
    private bool _disposed;

    public MySqlSession(Guid id, ConnectionProfile profile, MySqlConnection connection)
    {
        Id = id;
        Profile = profile;
        Connection = connection;
        ServerVersion = connection.ServerVersion;
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => DatabaseEngine.MySql;

    public ConnectionProfile Profile { get; }

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    /// <summary>Solo accesible dentro del proveedor.</summary>
    internal MySqlConnection Connection { get; }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
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
        catch
        {
            // Si abrir falla, la conexión no debe quedar viva a medias.
            await connection.DisposeAsync();
            throw;
        }

        // El identificador es aleatorio a propósito: es lo que viaja por HTTP y no
        // debe poder adivinarse (plan §12).
        return new MySqlSession(Guid.NewGuid(), profile, connection);
    }
}
