using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Npgsql;

namespace Druse.Provider.PostgreSql;

/// <summary>Sesión PostgreSQL. Envuelve la conexión de Npgsql sin dejarla salir.</summary>
internal sealed class PostgreSqlSession : IDatabaseSession
{
    private bool _disposed;

    public PostgreSqlSession(
        Guid id,
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        NpgsqlConnection connection,
        bool readOnlyEnforcedByEngine)
    {
        Id = id;
        Profile = profile;
        Credentials = credentials;
        Connection = connection;
        Transaction = new SessionTransaction(connection);
        ServerVersion = connection.PostgreSqlVersion.ToString();
        ReadOnlyEnforcedByEngine = readOnlyEnforcedByEngine;
    }

    public Guid Id { get; }

    public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

    public ConnectionProfile Profile { get; }

    /// <summary>Aquí sí: PostgreSQL tiene sesiones de solo lectura de verdad.</summary>
    public bool ReadOnlyEnforcedByEngine { get; }

    public string ServerVersion { get; }

    public bool IsOpen => !_disposed && Connection.State == System.Data.ConnectionState.Open;

    /// <summary>
    /// La transacción manual de esta conexión. Las reglas viven en la clase
    /// compartida; aquí solo se le da la conexión sobre la que trabajar.
    /// </summary>
    public SessionTransaction Transaction { get; }

    /// <summary>Solo accesible dentro del proveedor.</summary>
    internal NpgsqlConnection Connection { get; }

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

/// <summary>Proveedor PostgreSQL sobre Npgsql.</summary>
public sealed class PostgreSqlDatabaseProvider : IDatabaseProvider
{
    public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

    /// <summary>
    /// El motor con menos huecos de los cuatro: guarda todas las familias con un
    /// tipo propio, tiene JSON que se consulta por sus campos y columnas que
    /// guardan varios valores. Por eso es el único destino al que se puede llevar
    /// cualquier cosa sin avisar de nada.
    /// </summary>
    public EngineCapabilities Capabilities { get; } = new()
    {
        EnforcesReadOnlySessions = true,
        StoresJson = true,
        StoresArrays = true,
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

    public int DefaultPort => 5432;

    /// <summary>`postgres` existe en toda instalación y es donde se pregunta.</summary>
    public string DefaultDatabase => "postgres";

    /// <summary>Las plantillas y la base de mantenimiento no son de nadie.</summary>
    public IReadOnlyList<string> SystemDatabases => ["postgres", "template0", "template1"];

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
            throw new DatabaseOperationException(PostgreSqlErrorNormalizer.Normalize(exception));
        }

        // Solo lectura de verdad, no un aviso: el servidor rechaza toda
        // escritura de esta sesión, venga por donde venga —un `SELECT INTO`, un
        // `COPY ... FROM`, una función que escriba por dentro—. El analizador de
        // SQL sigue avisando antes, pero deja de ser lo único que hay.
        var enforced = await ApplyReadOnlyAsync(connection, profile, cancellationToken);

        // El identificador es aleatorio a propósito: es lo que viaja por HTTP y no
        // debe poder adivinarse (plan §12).
        return new PostgreSqlSession(Guid.NewGuid(), profile, credentials, connection, enforced);
    }

    /// <summary>
    /// Pone la sesión en solo lectura cuando el perfil lo pide.
    ///
    /// Devuelve si el motor se hizo cargo. Un fallo no cierra la conexión ni
    /// tumba la sesión: se responde que no está garantizado por el motor, que es
    /// la verdad, y la interfaz lo dirá tal cual. Fingir lo contrario sería peor
    /// que no tenerlo.
    /// </summary>
    private static async Task<bool> ApplyReadOnlyAsync(
        NpgsqlConnection connection,
        ConnectionProfile profile,
        CancellationToken cancellationToken)
    {
        if (!profile.ReadOnly)
        {
            return false;
        }

        try
        {
            await using var command = connection.CreateCommand();

            command.CommandText = "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;";

            await command.ExecuteNonQueryAsync(cancellationToken);

            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return false;
        }
    }

    public Task<IDatabaseSession> OpenDatabaseSessionAsync(
        IDatabaseSession source,
        string database,
        CancellationToken cancellationToken)
    {
        if (source is not PostgreSqlSession postgres || !postgres.IsOpen)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor PostgreSQL o ya está cerrada.",
                nameof(source));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(database);

        return OpenSessionAsync(
            postgres.Profile with { Database = database },
            postgres.Credentials,
            cancellationToken);
    }
}
