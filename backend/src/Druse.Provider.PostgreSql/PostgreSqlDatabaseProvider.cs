using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Npgsql;

namespace Druse.Provider.PostgreSql;

/// <summary>Sesión PostgreSQL. Envuelve la conexión de Npgsql sin dejarla salir.</summary>
internal sealed class PostgreSqlSession : IDatabaseSession
{
    private bool _disposed;

    public PostgreSqlSession(Guid id, ConnectionProfile profile, NpgsqlConnection connection)
    {
        Id = id;
        Profile = profile;
        Connection = connection;
        ServerVersion = connection.PostgreSqlVersion.ToString();
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

    public ConnectionProfile Profile { get; }

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    /// <summary>Solo accesible dentro del proveedor.</summary>
    internal NpgsqlConnection Connection { get; }

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

/// <summary>Proveedor PostgreSQL sobre Npgsql.</summary>
public sealed class PostgreSqlDatabaseProvider : IDatabaseProvider
{
    public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

    public int DefaultPort => 5432;

    public async Task<TestConnectionResult> TestConnectionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await using var connection = new NpgsqlConnection(
                PostgreSqlConnectionStringFactory.Build(profile, credentials));

            await connection.OpenAsync(cancellationToken);

            stopwatch.Stop();
            return TestConnectionResult.Success(connection.PostgreSqlVersion.ToString(), stopwatch.Elapsed);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            stopwatch.Stop();
            return TestConnectionResult.Failure(
                PostgreSqlErrorNormalizer.Normalize(exception),
                stopwatch.Elapsed);
        }
    }

    public async Task<IDatabaseSession> OpenSessionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var connection = new NpgsqlConnection(
            PostgreSqlConnectionStringFactory.Build(profile, credentials));

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
        return new PostgreSqlSession(Guid.NewGuid(), profile, connection);
    }
}
