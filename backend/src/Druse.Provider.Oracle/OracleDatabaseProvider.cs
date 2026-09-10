using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Oracle.ManagedDataAccess.Client;

namespace Druse.Provider.Oracle;

/// <summary>Sesión Oracle. Envuelve la conexión de ODP.NET sin dejarla salir.</summary>
internal sealed class OracleSession : IDatabaseSession
{
    private bool _disposed;

    public OracleSession(
        Guid id,
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        OracleConnection connection,
        string currentSchema)
    {
        Id = id;
        Profile = profile;
        Credentials = credentials;
        Connection = connection;
        Transaction = new SessionTransaction(connection);
        ServerVersion = connection.ServerVersion;
        CurrentSchema = currentSchema;
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => DatabaseEngine.Oracle;

    public ConnectionProfile Profile { get; }

    /// <summary>
    /// Oracle **no** tiene sesiones de solo lectura equivalentes.
    ///
    /// `SET TRANSACTION READ ONLY` existe, pero dura lo que dura la transacción y
    /// se pierde en el primer `COMMIT`: no es un modo de la sesión, es una
    /// propiedad de una transacción. Fingir que sí lo es enseñaría un candado que
    /// se abre solo. Aquí la garantía es la de siempre: un usuario con permisos
    /// restringidos en el servidor.
    /// </summary>
    public bool ReadOnlyEnforcedByEngine => false;

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    public SessionTransaction Transaction { get; }

    /// <summary>Solo accesible dentro del proveedor.</summary>
    internal OracleConnection Connection { get; }

    /// <summary>
    /// El esquema del usuario conectado, en mayúsculas como lo guarda el
    /// catálogo.
    ///
    /// En Oracle un esquema **es** un usuario, así que este es el equivalente al
    /// `public` de PostgreSQL o al `dbo` de SQL Server: el sitio donde caen las
    /// tablas que se crean sin nombrar dueño. Se lee al abrir para no repetir la
    /// consulta cada vez que hace falta.
    /// </summary>
    internal string CurrentSchema { get; private set; }

    /// <summary>
    /// La misma sesión, sabiendo que ahora resuelve los nombres en otro esquema.
    ///
    /// No abre nada: lo que cambió fue el `CURRENT_SCHEMA` de esta conexión, y
    /// esto es lo que hace que el lector de catálogo lo sepa cuando un nodo del
    /// árbol no traiga esquema propio.
    /// </summary>
    internal OracleSession PointedAt(string schema)
    {
        CurrentSchema = schema;

        return this;
    }

    /// <summary>Solo se usa para abrir otro servicio del mismo servidor.</summary>
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
/// Proveedor Oracle sobre el cliente gestionado de ODP.NET.
///
/// **Aquí «base de datos» significa otra cosa que en los demás motores.** Una
/// conexión de Oracle apunta a un *servicio*, y dentro no hay varias bases entre
/// las que moverse: hay esquemas, que son usuarios. Lo que el explorador enseña
/// en el primer nivel son esos esquemas, y lo que el perfil llama base es el
/// nombre del servicio.
/// </summary>
public sealed class OracleDatabaseProvider : IDatabaseProvider
{
    public DatabaseEngine Engine => DatabaseEngine.Oracle;

    /// <summary>
    /// Le falta el tipo que en los otros motores más se da por hecho: **no hay
    /// booleano**. Existe en PL/SQL desde siempre y como tipo de columna solo
    /// desde 23ai, así que una columna booleana que llegue aquí acaba en
    /// `NUMBER(1)` y se lee como 1 y 0.
    ///
    /// Tampoco hay identificador único —`RAW(16)` guarda los bytes pero el motor
    /// no comprueba que sean uno— ni tipo JSON antes de 21c. Lo que sí conserva,
    /// y no es poco, es la marca de tiempo con zona horaria.
    ///
    /// `DATE` incluye la hora, así que una fecha sin hora se guarda con las cero
    /// horas; se cuenta como propia porque el dato viaja entero.
    /// </summary>
    public EngineCapabilities Capabilities { get; } = new()
    {
        NativeFamilies =
        [
            ColumnFamily.Text,
            ColumnFamily.Integral,
            ColumnFamily.Fractional,
            ColumnFamily.Date,
            ColumnFamily.Timestamp,
            ColumnFamily.TimestampWithZone,
            ColumnFamily.Binary,
        ],
    };

    public int DefaultPort => 1521;

    /// <summary>
    /// El servicio de la instalación de serie.
    ///
    /// No es «la base desde la que se pregunta qué bases hay», porque en Oracle
    /// eso no existe: hay que nombrar un destino para conectar, y este es el que
    /// tiene delante quien todavía no sabe cuál escribir.
    /// </summary>
    public string DefaultDatabase => OracleConnectionStringFactory.DefaultService;

    /// <summary>
    /// Esquemas del propio motor.
    ///
    /// Son muchos más que en los otros motores —una instalación de serie trae
    /// alrededor de treinta— y aquí ocupan el sitio que allí ocupan las bases del
    /// sistema: lo que no se elige solo cuando el usuario no dijo nada.
    /// </summary>
    public IReadOnlyList<string> SystemDatabases =>
    [
        "SYS", "SYSTEM", "SYSAUX", "XDB", "OUTLN", "DBSNMP", "APPQOSSYS",
        "AUDSYS", "GSMADMIN_INTERNAL", "ORDDATA", "ORDSYS", "MDSYS", "CTXSYS",
        "LBACSYS", "OLAPSYS", "WMSYS", "DVSYS", "REMOTE_SCHEDULER_AGENT",
    ];

    public async Task<TestConnectionResult> TestConnectionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await using var connection = new OracleConnection(
                OracleConnectionStringFactory.Build(profile, credentials));

            await connection.OpenAsync(cancellationToken);

            stopwatch.Stop();
            return TestConnectionResult.Success(connection.ServerVersion, stopwatch.Elapsed);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            stopwatch.Stop();
            return TestConnectionResult.Failure(
                OracleErrorNormalizer.Normalize(exception),
                stopwatch.Elapsed);
        }
    }

    public async Task<IDatabaseSession> OpenSessionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var connection = new OracleConnection(
            OracleConnectionStringFactory.Build(profile, credentials));

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
            throw new DatabaseOperationException(OracleErrorNormalizer.Normalize(exception));
        }

        // Los mensajes de `DBMS_OUTPUT` no existen si nadie abre su búfer, y eso
        // es una propiedad de la conexión: se pide una vez, aquí.
        await OracleServerOutput.EnableAsync(connection, cancellationToken);

        var schema = await ResetSchemaAsync(connection, profile.Username, cancellationToken);

        // El identificador es aleatorio a propósito: es lo que viaja por HTTP y no
        // debe poder adivinarse (plan §12).
        return new OracleSession(Guid.NewGuid(), profile, credentials, connection, schema);
    }

    /// <summary>
    /// Cómo se escriben las fechas en esta sesión.
    ///
    /// Oracle **no tiene un formato canónico**: convierte entre texto y fecha con
    /// el que diga `NLS_DATE_FORMAT`, que de fábrica es `DD-MON-RR` y depende del
    /// idioma del servidor —`11-AGO-26` en español, `11-AUG-26` en inglés—. Sin
    /// fijarlo, el mismo respaldo se lee bien en un servidor y falla en otro, y un
    /// valor escrito como `2026-08-11` se rechaza con un error del driver que
    /// habla de «información válida para el análisis» y no menciona las fechas.
    ///
    /// Se fija el formato ISO, que es el que usan los demás proveedores para
    /// escribir y leer. Así una fecha se ve igual venga del motor que venga, y lo
    /// que un respaldo escribe es lo que la restauración sabe leer.
    /// </summary>
    private const string Formats =
        "NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS' " +
        "NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI:SSXFF' " +
        "NLS_TIMESTAMP_TZ_FORMAT = 'YYYY-MM-DD HH24:MI:SSXFF TZH:TZM' " +
        "NLS_NUMERIC_CHARACTERS = '.,'";

    /// <summary>
    /// Devuelve la sesión a su esquema y dice cuál es.
    ///
    /// **El reinicio no es una precaución de más: es obligatorio.** Las
    /// conexiones se reutilizan desde un pool, y `ALTER SESSION SET
    /// CURRENT_SCHEMA` —que es como el explorador se asoma a otro esquema— se
    /// queda pegado a la conexión cuando se devuelve. Sin esto, la siguiente
    /// consulta que tomara esa conexión resolvería sus tablas en el esquema
    /// ajeno y fallaría con «la tabla no existe» hablando de una tabla que sí
    /// está. Es un fallo intermitente, que depende de qué conexión toque, y de
    /// los más difíciles de perseguir.
    ///
    /// `USER` no lo cambia el `ALTER SESSION`: siempre es el usuario con el que
    /// se abrió, así que es lo único fiable para saber a dónde volver.
    ///
    /// Si algo fallara se usa el nombre de usuario en mayúsculas, que es lo que
    /// Oracle habría contestado. Es mejor que dejar la sesión sin esquema por
    /// omisión y que el explorador no sepa dónde empezar.
    /// </summary>
    private static async Task<string> ResetSchemaAsync(
        OracleConnection connection,
        string username,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var command = connection.CreateCommand();

            command.CommandText = "SELECT USER FROM DUAL";

            if (await command.ExecuteScalarAsync(cancellationToken) is string schema
                && !string.IsNullOrWhiteSpace(schema))
            {
                // Los formatos van en la misma instrucción: es una sola ida y
                // vuelta, y las dos cosas son lo mismo —dejar la sesión en un
                // estado conocido antes de usarla—.
                command.CommandText =
                    $"ALTER SESSION SET CURRENT_SCHEMA = {OracleIdentifier.Quote(schema)} {Formats}";

                await command.ExecuteNonQueryAsync(cancellationToken);

                return schema;
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Se sigue con el recambio de abajo.
        }

        return username.ToUpperInvariant();
    }

    /// <summary>
    /// Abre una sesión apuntada a otro esquema del mismo servicio.
    ///
    /// En los demás motores esto abre otra base, y el perfil cambia de destino.
    /// **Aquí no hay otra base a la que ir**: lo que el explorador enseña como
    /// bases son esquemas, y todos viven dentro de la misma conexión. Lo que
    /// cambia es a nombre de quién se resuelven los nombres sin calificar, que es
    /// lo que hace `CURRENT_SCHEMA`.
    ///
    /// Se abre una conexión nueva en vez de cambiarle el esquema a la que ya
    /// había, porque quien pide esto sigue usando la suya: es el explorador
    /// mirando otra rama sin soltar la que tiene abierta.
    /// </summary>
    public async Task<IDatabaseSession> OpenDatabaseSessionAsync(
        IDatabaseSession source,
        string database,
        CancellationToken cancellationToken)
    {
        if (source is not OracleSession oracle || !oracle.IsOpen)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor Oracle o ya está cerrada.",
                nameof(source));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(database);

        var session = (OracleSession)await OpenSessionAsync(
            oracle.Profile,
            oracle.Credentials,
            cancellationToken);

        try
        {
            await using var command = session.Connection.CreateCommand();

            // El nombre va citado y con las comillas dobladas: es lo único que
            // impide que un esquema llamado `X" OR 1=1` sea una instrucción.
            var quoted = database.Replace("\"", "\"\"", StringComparison.Ordinal);

            command.CommandText = $"ALTER SESSION SET CURRENT_SCHEMA = \"{quoted}\"";

            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            await session.DisposeAsync();

            throw new DatabaseOperationException(OracleErrorNormalizer.Normalize(exception));
        }

        return session.PointedAt(database);
    }
}
