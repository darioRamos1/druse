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

    /// <summary>
    /// Si el **motor** está impidiendo escribir por esta conexión.
    ///
    /// `Profile.ReadOnly` dice lo que pidió el usuario; esto dice si además hay
    /// algo real detrás. En PostgreSQL y MySQL sí: la sesión se pone en solo
    /// lectura y el servidor rechaza cualquier escritura, venga por donde venga
    /// —una función con efectos laterales, un `SELECT INTO`, un procedimiento—.
    /// SQL Server e Informix no tienen un modo de sesión equivalente, así que ahí
    /// lo único que hay es el aviso del analizador, **que no es una frontera**:
    /// la garantía definitiva sigue siendo un usuario con permisos restringidos
    /// en el servidor.
    ///
    /// Se expone para poder decir la verdad en la interfaz. Enseñar el mismo
    /// candado en los cuatro motores sería prometer lo que solo dos cumplen.
    /// </summary>
    bool ReadOnlyEnforcedByEngine { get; }

    string ServerVersion { get; }

    bool IsOpen { get; }

    /// <summary>
    /// La transacción manual de esta conexión.
    ///
    /// Una transacción pertenece a la conexión, no a la pestaña: si el usuario
    /// abre una y ejecuta algo desde otra pestaña del mismo perfil, ese trabajo
    /// **también entra en ella**. No es una decisión de diseño, es cómo funciona
    /// una conexión, y por eso la interfaz lo dice aquí en lugar de dejar que
    /// cada capa lo suponga.
    /// </summary>
    SessionTransaction Transaction { get; }
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

    /// <summary>
    /// Lo que este motor sabe hacer.
    ///
    /// Es lo que permite que el validador, el traductor de tipos y el formulario
    /// de conexión dejen de preguntar «¿y si es MySQL?»: preguntan aquí y
    /// trabajan con la respuesta. Un motor nuevo no puede olvidarse de
    /// contestar, porque la propiedad es del contrato y las familias de datos que
    /// conserva son <c>required</c>.
    /// </summary>
    EngineCapabilities Capabilities { get; }

    /// <summary>Puerto habitual del motor, para rellenar el formulario de conexión.</summary>
    int DefaultPort { get; }

    /// <summary>
    /// Base desde la que se pregunta **qué bases hay**, cuando el perfil no dice
    /// ninguna.
    ///
    /// Para preguntar hay que estar conectado a algo, y ese algo es distinto en
    /// cada motor: `postgres` en PostgreSQL, `master` en SQL Server, `sysmaster`
    /// en Informix. Vacío significa que el motor admite conectarse **sin nombrar
    /// base**, que es el caso de MySQL.
    /// </summary>
    string DefaultDatabase { get; }

    /// <summary>
    /// Bases que son del propio motor y no se eligen solas.
    ///
    /// Cuando el perfil no dice a cuál conectarse, Druse toma la primera a la que
    /// el usuario tenga acceso, y estas se dejan para el final: quien abre una
    /// conexión quiere ver sus datos, no el catálogo del servidor. Si no hay
    /// ninguna otra sí se usa una de estas, que es mejor que no conectar.
    /// </summary>
    IReadOnlyList<string> SystemDatabases { get; }

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
