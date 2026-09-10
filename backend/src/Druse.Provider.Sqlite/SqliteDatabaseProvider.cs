using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.Sqlite;

namespace Druse.Provider.Sqlite;

/// <summary>Sesión SQLite. Envuelve la conexión del driver sin dejarla salir.</summary>
internal sealed class SqliteSession : IDatabaseSession
{
    private bool _disposed;

    public SqliteSession(
        Guid id,
        ConnectionProfile profile,
        SqliteConnection connection,
        string version)
    {
        Id = id;
        Profile = profile;
        Connection = connection;
        Transaction = new SessionTransaction(connection);
        ServerVersion = version;
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => DatabaseEngine.Sqlite;

    public ConnectionProfile Profile { get; }

    /// <summary>
    /// **Aquí el candado es real, y es el más fuerte de los seis.**
    ///
    /// No es un modo de la sesión que el servidor haga cumplir: es que el archivo
    /// se abre sin permiso de escritura. No hay instrucción, función ni disparador
    /// que pueda saltárselo, porque el sistema operativo no lo deja. Donde
    /// PostgreSQL y MySQL prometen que el servidor rechazará las escrituras, aquí
    /// directamente no hay por dónde escribir.
    /// </summary>
    public bool ReadOnlyEnforcedByEngine => Profile.ReadOnly;

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    public SessionTransaction Transaction { get; }

    /// <summary>Solo accesible dentro del proveedor.</summary>
    internal SqliteConnection Connection { get; }

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
        await Connection.DisposeAsync();
    }
}

/// <summary>
/// Proveedor SQLite.
///
/// **Es el único de los seis que no habla con un servidor.** No hay proceso al
/// otro lado, ni red, ni identidad: hay un archivo que se abre. Eso cambia lo que
/// el perfil necesita —solo una ruta— y cambia lo que se puede prometer: el modo
/// de solo lectura de aquí es el más fuerte de todos, porque no depende de que
/// nadie lo respete.
///
/// Lo que no cambia es el contrato. Este proveedor supera el mismo conjunto de
/// pruebas que los otros cinco, y las diferencias del motor —que no tiene
/// procedimientos, que su `ALTER TABLE` casi no existe, que sus tipos son
/// afinidades y no tipos— están declaradas, no rodeadas.
/// </summary>
public sealed class SqliteDatabaseProvider : IDatabaseProvider
{
    public DatabaseEngine Engine => DatabaseEngine.Sqlite;

    /// <summary>
    /// **Aquí el tipo de una columna no obliga a nada.**
    ///
    /// SQLite tiene afinidades, no tipos: una columna declarada `INTEGER` acepta
    /// el texto `hola` y lo guarda tal cual. Así que lo que se declara abajo no es
    /// «qué comprueba el motor» —no comprueba nada— sino **qué se puede volver a
    /// leer igual**, que es lo que el traslado de datos necesita saber.
    ///
    /// Por eso están las familias que sobreviven al viaje de ida y vuelta:
    /// números, texto y binarios. Y no están las que no: no hay booleano, ni
    /// fecha, ni hora, ni marca de tiempo, ni identificador único. Todas ellas se
    /// guardan como número o como texto según convenga, y al releerlas nadie sabe
    /// que lo eran.
    ///
    /// Es el motor con más huecos de los seis, y decirlo es justo lo que evita
    /// que un traslado prometa una copia exacta que no lo es.
    /// </summary>
    public EngineCapabilities Capabilities { get; } = new()
    {
        RequiresHost = false,
        RequiresUsername = false,
        RequiresDatabase = true,
        UsesFilePath = true,
        CanCreateDatabase = true,
        SupportsSshTunnel = false,
        SupportsTransportEncryption = false,
        EnforcesReadOnlySessions = true,
        NativeFamilies =
        [
            ColumnFamily.Text,
            ColumnFamily.Integral,
            ColumnFamily.Fractional,
            ColumnFamily.Binary,
        ],
    };

    /// <summary>No hay puerto. Se declara cero para que el formulario no proponga uno.</summary>
    public int DefaultPort => 0;

    /// <summary>
    /// Vacía: no hay una base desde la que preguntar qué bases hay, porque no hay
    /// varias. El archivo que se abre es la única, y sin él no se conecta.
    /// </summary>
    public string DefaultDatabase => string.Empty;

    /// <summary>
    /// Nombres que SQLite reserva para sí.
    ///
    /// `main` es el archivo abierto y `temp` la base en memoria de esta conexión.
    /// No son bases del sistema en el sentido de los demás motores —no guardan un
    /// catálogo aparte— pero ocupan su sitio: son lo que no se elige solo.
    /// </summary>
    public IReadOnlyList<string> SystemDatabases => ["temp"];

    public async Task<TestConnectionResult> TestConnectionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await using var connection = new SqliteConnection(
                SqliteConnectionStringFactory.Build(profile));

            await connection.OpenAsync(cancellationToken);

            // Abrir no basta para saber que el archivo es una base de SQLite: el
            // driver no lee la cabecera hasta la primera consulta, así que un
            // archivo cualquiera pasaría la prueba y fallaría al explorarlo.
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT sqlite_version()";

            var version = (await command.ExecuteScalarAsync(cancellationToken))?.ToString()
                ?? "desconocida";

            stopwatch.Stop();
            return TestConnectionResult.Success(version, stopwatch.Elapsed);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            stopwatch.Stop();
            return TestConnectionResult.Failure(
                SqliteErrorNormalizer.Normalize(exception),
                stopwatch.Elapsed);
        }
    }

    public async Task<IDatabaseSession> OpenSessionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var connection = new SqliteConnection(SqliteConnectionStringFactory.Build(profile));

        try
        {
            await connection.OpenAsync(cancellationToken);

            var version = await PrepareAsync(connection, profile, cancellationToken);

            // El identificador es aleatorio a propósito: es lo que viaja por HTTP y
            // no debe poder adivinarse (plan §12).
            return new SqliteSession(Guid.NewGuid(), profile, connection, version);
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

            throw new DatabaseOperationException(SqliteErrorNormalizer.Normalize(exception));
        }
    }

    /// <summary>
    /// Deja la conexión lista y devuelve la versión del motor.
    ///
    /// Las tres cosas que se piden importan y ninguna viene puesta:
    ///
    /// - **`foreign_keys`** está apagado de fábrica, por compatibilidad con
    ///   versiones de hace veinte años. Con él apagado, las claves foráneas que el
    ///   diseñador escribe se guardan y **no se comprueban nunca**: la interfaz
    ///   enseñaría una relación que el motor ignora.
    /// - **`journal_mode = WAL`** deja leer mientras otro escribe. Sin él, un
    ///   respaldo largo bloquea a quien quiera guardar una fila.
    /// - **`busy_timeout`** hace que una escritura espere su turno en vez de
    ///   fallar al instante con «database is locked».
    ///
    /// En solo lectura no se piden las dos últimas: cambian el archivo, y el
    /// archivo está abierto para no cambiarlo.
    /// </summary>
    private static async Task<string> PrepareAsync(
        SqliteConnection connection,
        ConnectionProfile profile,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();

        command.CommandText = "PRAGMA foreign_keys = ON;";
        await command.ExecuteNonQueryAsync(cancellationToken);

        if (!profile.ReadOnly)
        {
            command.CommandText =
                $"PRAGMA journal_mode = WAL; PRAGMA busy_timeout = {profile.ConnectTimeoutSeconds * 1000};";

            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        command.CommandText = "SELECT sqlite_version()";

        return (await command.ExecuteScalarAsync(cancellationToken))?.ToString() ?? "desconocida";
    }

    /// <summary>
    /// No hay otra base a la que ir.
    ///
    /// En los demás motores esto abre otra base del mismo servidor. Aquí la base
    /// **es** el archivo: cambiar de base es cambiar de perfil, y eso lo hace el
    /// usuario eligiendo otro archivo, no el explorador por su cuenta.
    ///
    /// Se admite un solo caso, el que el explorador usa de verdad: pedir la misma
    /// base que ya está abierta. Devolver una sesión nueva sobre el mismo archivo
    /// es correcto y barato, y evita que el árbol tenga que saber que este motor
    /// es distinto.
    /// </summary>
    /// <summary>
    /// Crea el archivo, y **solo si no estaba**.
    ///
    /// Es lo contrario de abrir: aquí sí se deja algo en el disco, así que se
    /// hace cuando alguien lo pide y nunca por descuido. Si el archivo ya existe
    /// no se toca ni se vacía —eso sería borrar una base con un botón que dice
    /// «crear»— y se dice que ya estaba.
    ///
    /// Abrir en modo de creación no basta: SQLite escribe el archivo pero lo deja
    /// de cero bytes hasta la primera escritura, y un archivo vacío no es una
    /// base —al abrirlo después, cualquier consulta falla con «file is not a
    /// database»—. Por eso se pide algo que obligue a escribir la cabecera.
    /// </summary>
    public async Task CreateDatabaseAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentException.ThrowIfNullOrWhiteSpace(profile.Database);

        if (File.Exists(profile.Database))
        {
            throw new DatabaseOperationException(new QueryError
            {
                Message = "Ya hay un archivo en esa ruta. Ábrelo, o elige otro nombre.",
            });
        }

        try
        {
            await using var connection = new SqliteConnection(
                SqliteConnectionStringFactory.BuildForCreate(profile));

            await connection.OpenAsync(cancellationToken);

            await using var command = connection.CreateCommand();

            // Cambiar la versión del usuario escribe la cabecera, que es lo que
            // convierte un archivo de cero bytes en una base de datos. No deja
            // ninguna tabla dentro: la base nace vacía, que es lo que se pidió.
            command.CommandText = "PRAGMA user_version = 0;";

            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            throw new DatabaseOperationException(SqliteErrorNormalizer.Normalize(exception));
        }
    }

    public Task<IDatabaseSession> OpenDatabaseSessionAsync(
        IDatabaseSession source,
        string database,
        CancellationToken cancellationToken)
    {
        if (source is not SqliteSession sqlite || !sqlite.IsOpen)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor SQLite o ya está cerrada.",
                nameof(source));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(database);

        if (!string.Equals(database, SqliteMetadataReader.MainDatabase, StringComparison.OrdinalIgnoreCase))
        {
            throw new DatabaseOperationException(new QueryError
            {
                Message =
                    $"«{database}» no es una base de este archivo. En SQLite el archivo es la " +
                    "base: para abrir otra hay que elegir otro archivo.",
            });
        }

        return OpenSessionAsync(sqlite.Profile, default, cancellationToken);
    }
}
