using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using IBM.Data.Db2;

namespace Druse.Provider.Informix;

/// <summary>Sesión Informix. Envuelve la conexión de IBM sin dejarla salir.</summary>
internal sealed class InformixSession : IDatabaseSession
{
    private bool _disposed;

    public InformixSession(
        Guid id,
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        DB2Connection connection)
    {
        Id = id;
        Profile = profile;
        Credentials = credentials;
        Connection = connection;
        Transaction = new SessionTransaction(connection);
        ServerVersion = connection.ServerVersion;
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => DatabaseEngine.Informix;

    public ConnectionProfile Profile { get; }

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    /// <summary>
    /// La transacción manual de esta conexión. Las reglas viven en la clase
    /// compartida; aquí solo se le da la conexión sobre la que trabajar.
    /// </summary>
    public SessionTransaction Transaction { get; }

    /// <summary>Solo accesible dentro del proveedor.</summary>
    internal DB2Connection Connection { get; }

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
/// Proveedor de IBM Informix, al que se llega por DRDA.
///
/// No existe un proveedor ADO.NET moderno propio de Informix, así que se usa el
/// de DB2 hablando el protocolo DRDA. **Esto exige que el servidor tenga DRDA
/// habilitado**: un puerto con `drsoctcp` en `sqlhosts` y una base con registro
/// de transacciones. Contra un servidor sin esa configuración la conexión falla
/// por cómo está montado el servidor, no por la cadena de conexión, y conviene
/// descartarlo antes de buscar el fallo en otro sitio.
/// </summary>
public sealed class InformixDatabaseProvider : IDatabaseProvider
{
    public DatabaseEngine Engine => DatabaseEngine.Informix;

    /// <summary>
    /// Puerto del escuchador DRDA, no el nativo de Informix.
    ///
    /// El servidor suele atender SQLI en un puerto y DRDA en otro; 9089 es el que
    /// usa la imagen de desarrollo de IBM. Es solo el valor que propone el
    /// formulario: si el administrador puso otro, se escribe a mano.
    /// </summary>
    public int DefaultPort => 9089;

    public async Task<TestConnectionResult> TestConnectionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await using var connection = new DB2Connection(
                InformixConnectionStringFactory.Build(profile, credentials));

            await connection.OpenAsync(cancellationToken);

            stopwatch.Stop();
            return TestConnectionResult.Success(connection.ServerVersion, stopwatch.Elapsed);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            stopwatch.Stop();
            return TestConnectionResult.Failure(
                InformixErrorNormalizer.Normalize(exception),
                stopwatch.Elapsed);
        }
    }

    public async Task<IDatabaseSession> OpenSessionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var connection = new DB2Connection(
            InformixConnectionStringFactory.Build(profile, credentials));

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
            throw new DatabaseOperationException(InformixErrorNormalizer.Normalize(exception));
        }

        // El identificador es aleatorio a propósito: es lo que viaja por HTTP y no
        // debe poder adivinarse (plan §12).
        return new InformixSession(Guid.NewGuid(), profile, credentials, connection);
    }

    public Task<IDatabaseSession> OpenDatabaseSessionAsync(
        IDatabaseSession source,
        string database,
        CancellationToken cancellationToken)
    {
        if (source is not InformixSession informix || !informix.IsOpen)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor Informix o ya está cerrada.",
                nameof(source));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(database);

        // En Informix la base forma parte de la conexión y no se cambia con un
        // `USE`: navegar a otra base es abrir otra conexión con la misma
        // identidad, que es justo lo que hace este método.
        return OpenSessionAsync(
            informix.Profile with { Database = database },
            informix.Credentials,
            cancellationToken);
    }
}
