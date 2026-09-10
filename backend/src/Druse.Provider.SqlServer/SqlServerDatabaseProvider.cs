using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.SqlClient;

namespace Druse.Provider.SqlServer;

/// <summary>Sesión SQL Server. Envuelve la conexión de SqlClient sin dejarla salir.</summary>
internal sealed class SqlServerSession : IDatabaseSession
{
    private bool _disposed;

    public SqlServerSession(
        Guid id,
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        SqlConnection connection)
    {
        Id = id;
        Profile = profile;
        Credentials = credentials;
        Connection = connection;
        Transaction = new SessionTransaction(connection);
        ServerVersion = connection.ServerVersion;
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => DatabaseEngine.SqlServer;

    public ConnectionProfile Profile { get; }

    /// <summary>
    /// Siempre `false`: **SQL Server no tiene sesiones de solo lectura**.
    ///
    /// `ApplicationIntent=ReadOnly` no sirve —solo enruta hacia una réplica de
    /// lectura en un grupo de disponibilidad, y sin él la conexión escribe
    /// igual—, y poner la base entera en `READ_ONLY` es una decisión del
    /// servidor, no de quien se conecta. Aquí, marcar «solo lectura» es un aviso
    /// del analizador de SQL, y la garantía de verdad es un usuario con permisos
    /// restringidos. Decirlo es mejor que enseñar un candado que no cierra.
    /// </summary>
    public bool ReadOnlyEnforcedByEngine => false;

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    /// <summary>
    /// La transacción manual de esta conexión. Las reglas viven en la clase
    /// compartida; aquí solo se le da la conexión sobre la que trabajar.
    /// </summary>
    public SessionTransaction Transaction { get; }

    /// <summary>Solo accesible dentro del proveedor.</summary>
    internal SqlConnection Connection { get; }

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
/// Proveedor SQL Server sobre Microsoft.Data.SqlClient.
///
/// Solo autenticación SQL. La autenticación integrada de Windows es una tarea
/// aparte a propósito: ata la aplicación a un sistema operativo y el plan exige
/// que no sea la única forma de conectarse (ADR 0003).
/// </summary>
public sealed class SqlServerDatabaseProvider : IDatabaseProvider
{
    public DatabaseEngine Engine => DatabaseEngine.SqlServer;

    /// <summary>
    /// Tiene un tipo para cada familia —`uniqueidentifier`, `bit`,
    /// `datetimeoffset`— pero **no un tipo JSON**: lo que llama JSON son
    /// funciones sobre texto, así que un `jsonb` que aterrice aquí deja de
    /// comprobarse.
    ///
    /// Y no tiene sesiones de solo lectura: lo único que hay es el aviso del
    /// analizador, que no es una frontera.
    /// </summary>
    public EngineCapabilities Capabilities { get; } = new()
    {
        SupportsIntegratedSecurity = true,
        NativeFamilies =
        [
            ColumnFamily.Text,
            ColumnFamily.Integral,
            ColumnFamily.Fractional,
            ColumnFamily.Boolean,
            ColumnFamily.Date,
            ColumnFamily.Time,
            ColumnFamily.Timestamp,
            ColumnFamily.TimestampWithZone,
            ColumnFamily.Binary,
            ColumnFamily.Uuid,
        ],
    };

    public int DefaultPort => 1433;

    /// <summary>`master` la ve cualquier inicio de sesión, por poco permiso que tenga.</summary>
    public string DefaultDatabase => "master";

    public IReadOnlyList<string> SystemDatabases => ["master", "model", "msdb", "tempdb"];

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
            throw new DatabaseOperationException(SqlServerErrorNormalizer.Normalize(exception));
        }

        // El identificador es aleatorio a propósito: es lo que viaja por HTTP y no
        // debe poder adivinarse (plan §12).
        return new SqlServerSession(Guid.NewGuid(), profile, credentials, connection);
    }

    public Task<IDatabaseSession> OpenDatabaseSessionAsync(
        IDatabaseSession source,
        string database,
        CancellationToken cancellationToken)
    {
        if (source is not SqlServerSession sqlServer || !sqlServer.IsOpen)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor SQL Server o ya está cerrada.",
                nameof(source));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(database);

        return OpenSessionAsync(
            sqlServer.Profile with { Database = database },
            sqlServer.Credentials,
            cancellationToken);
    }
}
