using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>Credenciales necesarias para abrir una conexión, separadas del perfil.</summary>
/// <param name="Password">
/// Nunca se persiste con el perfil ni se registra. El proveedor puede conservarla
/// dentro de una sesión abierta para conectar a otra base del mismo servidor.
/// </param>
public readonly record struct DatabaseCredentials(string? Password);

/// <summary>Resultado de probar una conexión sin guardarla.</summary>
public sealed record TestConnectionResult
{
    public required bool Succeeded { get; init; }

    /// <summary>Versión del servidor cuando la prueba funciona.</summary>
    public string? ServerVersion { get; init; }

    /// <summary>Motivo del fallo, ya normalizado y sin datos sensibles.</summary>
    public QueryError? Error { get; init; }

    public required TimeSpan Duration { get; init; }

    public static TestConnectionResult Success(string serverVersion, TimeSpan duration) =>
        new() { Succeeded = true, ServerVersion = serverVersion, Duration = duration };

    public static TestConnectionResult Failure(QueryError error, TimeSpan duration) =>
        new() { Succeeded = false, Error = error, Duration = duration };
}

/// <summary>
/// Conexión abierta contra un motor.
///
/// Es propiedad de quien la abre y debe liberarse al cerrarla. Encapsula la
/// conexión concreta del driver, que nunca sale de su proveedor.
/// </summary>
public interface IDatabaseSession : IAsyncDisposable
{
    Guid Id { get; }

    DatabaseEngine Engine { get; }

    /// <summary>Perfil con el que se abrió. No contiene la contraseña.</summary>
    ConnectionProfile Profile { get; }

    string ServerVersion { get; }

    bool IsOpen { get; }
}

/// <summary>
/// Punto de entrada de un motor.
///
/// Cada proveedor encapsula por completo su driver y su dialecto. Ni
/// <c>Application</c> ni el host conocen Npgsql, SqlClient ni MySqlConnector.
/// </summary>
public interface IDatabaseProvider
{
    DatabaseEngine Engine { get; }

    /// <summary>Puerto habitual del motor, para rellenar el formulario de conexión.</summary>
    int DefaultPort { get; }

    Task<TestConnectionResult> TestConnectionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken);

    Task<IDatabaseSession> OpenSessionAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken);

    /// <summary>
    /// Abre una sesión auxiliar en otra base del mismo servidor y con la misma
    /// identidad. Se usa para que el explorador navegue todas las bases permitidas
    /// sin exponer las credenciales fuera del proveedor.
    /// </summary>
    Task<IDatabaseSession> OpenDatabaseSessionAsync(
        IDatabaseSession source,
        string database,
        CancellationToken cancellationToken);
}
