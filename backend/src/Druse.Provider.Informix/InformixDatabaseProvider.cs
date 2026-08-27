using System.Data.Common;
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
        DbConnection connection)
    {
        Id = id;
        Profile = profile;
        Credentials = credentials;
        Connection = connection;
        Transaction = new SessionTransaction(connection);
        ServerVersion = connection.ServerVersion;
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => Profile.Engine;

    public ConnectionProfile Profile { get; }

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    /// <summary>
    /// La transacción manual de esta conexión. Las reglas viven en la clase
    /// compartida; aquí solo se le da la conexión sobre la que trabajar.
    /// </summary>
    public SessionTransaction Transaction { get; }

    /// <summary>
    /// Solo accesible dentro del proveedor.
    ///
    /// Es `DbConnection` y no el tipo de IBM porque **por aquí entran dos
    /// transportes**: el de DB2 cuando se habla DRDA y el puente JDBC cuando se
    /// habla SQLI. Todo lo que hay encima —catálogo, tipos, diseñador— funciona
    /// igual con cualquiera de los dos, que es lo que permite compartirlo.
    /// </summary>
    internal DbConnection Connection { get; }

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
    /// <summary>
    /// Se resuelve la biblioteca nativa antes de que nadie llame al driver.
    ///
    /// El constructor estático corre una sola vez y siempre antes de la primera
    /// conexión, que es justo la condición que impone el tiempo de ejecución
    /// para poder registrar un resolvedor.
    /// </summary>
    static InformixDatabaseProvider() => InformixNativeLibrary.Ensure();

    /// <summary>
    /// Por dónde se entra al motor.
    ///
    /// Se registra una instancia por transporte. Todo lo que hay debajo es
    /// compartido —es el mismo Informix—; lo único que cambia es cómo se abre la
    /// conexión y qué puerto se propone.
    /// </summary>
    public InformixDatabaseProvider(DatabaseEngine engine = DatabaseEngine.Informix)
    {
        if (engine is not (DatabaseEngine.Informix or DatabaseEngine.InformixSqli))
        {
            throw new ArgumentOutOfRangeException(
                nameof(engine),
                engine,
                "Este proveedor solo atiende a Informix.");
        }

        Engine = engine;
    }

    public DatabaseEngine Engine { get; }

    /// <summary>`true` cuando se habla el protocolo nativo en vez de DRDA.</summary>
    private bool EsSqli => Engine == DatabaseEngine.InformixSqli;

    /// <summary>
    /// Puerto del escuchador DRDA, no el nativo de Informix.
    ///
    /// El servidor suele atender SQLI en un puerto y DRDA en otro; 9089 es el que
    /// usa la imagen de desarrollo de IBM. Es solo el valor que propone el
    /// formulario: si el administrador puso otro, se escribe a mano.
    /// </summary>
    public int DefaultPort => EsSqli ? 9088 : 9089;

    /// <summary>`sysmaster` es la base del servidor, y es donde vive el catálogo.</summary>
    public string DefaultDatabase => "sysmaster";

    public IReadOnlyList<string> SystemDatabases =>
        ["sysmaster", "sysadmin", "sysutils", "sysuser", "syscdr"];

    public async Task<TestConnectionResult> TestConnectionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await using var connection = Crear(profile, credentials);

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

        var connection = Crear(profile, credentials);

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

    /// <summary>
    /// Abre la conexión que corresponde al transporte de este proveedor.
    ///
    /// Es el único punto donde los dos caminos se separan. Lo que devuelve es
    /// `DbConnection` en ambos casos, y por eso el resto del proveedor no tiene
    /// que enterarse de por dónde ha entrado.
    /// </summary>
    private DbConnection Crear(ConnectionProfile profile, DatabaseCredentials credentials)
    {
        if (!EsSqli)
        {
            return new DB2Connection(InformixConnectionStringFactory.Build(profile, credentials));
        }

        // Idempotente y aquí, no en el constructor estático: el registro solo hace
        // falta si alguien va a conectar por SQLI, y cargarlo siempre obligaría a
        // la variante sin Informix a arrastrar el puente.
        Druse.Jdbc.JdbcConnection.RegisterInformixDriver();

        return new Druse.Jdbc.JdbcConnection(
            InformixSqliConnectionStringFactory.Build(profile, credentials));
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
