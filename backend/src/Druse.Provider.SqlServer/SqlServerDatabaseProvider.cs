using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.SqlClient;

namespace Druse.Provider.SqlServer;

/// <summary>Sesión SQL Server. Envuelve la conexión de SqlClient sin dejarla salir.</summary>
internal sealed class SqlServerSession : IDatabaseSession
{
    private bool _disposed;

    public SqlServerSession(Guid id, ConnectionProfile profile, SqlConnection connection)
    {
        Id = id;
        Profile = profile;
        Connection = connection;
        ServerVersion = connection.ServerVersion;
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => DatabaseEngine.SqlServer;

    public ConnectionProfile Profile { get; }

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    /// <summary>Solo accesible dentro del proveedor.</summary>
    internal SqlConnection Connection { get; }

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
/// Proveedor SQL Server sobre Microsoft.Data.SqlClient.
///
/// Solo autenticación SQL. La autenticación integrada de Windows es una tarea
/// aparte a propósito: ata la aplicación a un sistema operativo y el plan exige
/// que no sea la única forma de conectarse (ADR 0003).
/// </summary>
public sealed class SqlServerDatabaseProvider : IDatabaseProvider
{
    public DatabaseEngine Engine => DatabaseEngine.SqlServer;

    public int DefaultPort => 1433;

    public async Task<TestConnectionResult> TestConnectionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await using var connection = new SqlConnection(
                SqlServerConnectionStringFactory.Build(profile, credentials));

            await connection.OpenAsync(cancellationToken);

            stopwatch.Stop();
            return TestConnectionResult.Success(connection.ServerVersion, stopwatch.Elapsed);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            stopwatch.Stop();
            return TestConnectionResult.Failure(
                SqlServerErrorNormalizer.Normalize(exception),
                stopwatch.Elapsed);
        }
    }

    public async Task<IDatabaseSession> OpenSessionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var connection = new SqlConnection(
            SqlServerConnectionStringFactory.Build(profile, credentials));

        try
        {
            await connection.OpenAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Si abrir falla, la conexión no debe quedar viva a medias.
            await connection.DisposeAsync();

            // Y el motivo se cuenta: «la contraseña no es correcta» es algo que
            // el usuario puede arreglar; «error inesperado», no.
            throw new DatabaseOperationException(SqlServerErrorNormalizer.Normalize(exception));
        }

        // El identificador es aleatorio a propósito: es lo que viaja por HTTP y no
        // debe poder adivinarse (plan §12).
        return new SqlServerSession(Guid.NewGuid(), profile, connection);
    }
}
