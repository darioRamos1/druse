namespace Druse.Domain;

/// <summary>Entorno al que apunta una conexión. Determina el color y las advertencias.</summary>
public enum ConnectionEnvironment
{
    Development = 0,
    Testing = 1,
    Production = 2,
}

/// <summary>
/// Cómo se identifica el usuario ante el motor.
///
/// <see cref="Windows"/> delega la identidad en la sesión de Windows en la que
/// corre Druse: no hay usuario ni contraseña que escribir ni que guardar, y por
/// eso ninguno de los dos se pide cuando está activa.
/// </summary>
public enum AuthenticationMode
{
    /// <summary>Usuario y contraseña del propio motor.</summary>
    Password = 0,

    /// <summary>Identidad de la sesión de Windows. Solo la admite SQL Server.</summary>
    Windows = 1,
}

/// <summary>
/// Datos de acceso a un motor, sin la contraseña.
///
/// La contraseña nunca forma parte de esta entidad: vive en el almacén seguro
/// del sistema operativo y se recupera por <see cref="Id"/> en el momento de
/// abrir la conexión. Así no puede acabar por accidente en un log, en SQLite ni
/// en una respuesta de la API (plan §12).
/// </summary>
public sealed record ConnectionProfile
{
    public required Guid Id { get; init; }

    /// <summary>Nombre que ve el usuario. No puede estar vacío.</summary>
    public required string Name { get; init; }

    public required DatabaseEngine Engine { get; init; }

    public required string Host { get; init; }

    public required int Port { get; init; }

    /// <summary>Base a la que conectarse inicialmente.</summary>
    public required string Database { get; init; }

    /// <summary>Vacío cuando la autenticación es <see cref="AuthenticationMode.Windows"/>.</summary>
    public required string Username { get; init; }

    /// <summary>Cómo se identifica el usuario. Por omisión, usuario y contraseña.</summary>
    public AuthenticationMode Authentication { get; init; } = AuthenticationMode.Password;

    /// <summary>La identidad la pone el sistema: no hay contraseña que pedir ni guardar.</summary>
    public bool UsesIntegratedSecurity => Authentication == AuthenticationMode.Windows;

    public ConnectionEnvironment Environment { get; init; } = ConnectionEnvironment.Development;

    /// <summary>Impide ejecutar instrucciones que modifican datos.</summary>
    public bool ReadOnly { get; init; }

    /// <summary>Cifrado del transporte. Cada proveedor lo traduce a su dialecto.</summary>
    public SslMode SslMode { get; init; } = SslMode.Prefer;

    /// <summary>Segundos de espera al abrir la conexión.</summary>
    public int ConnectTimeoutSeconds { get; init; } = 15;

    /// <summary>
    /// Servidor intermedio por el que llegar al motor, o `null` para ir directo.
    ///
    /// Cuando está presente, <see cref="Host"/> y <see cref="Port"/> siguen siendo
    /// los del motor **vistos desde el servidor intermedio**: quien abre el túnel
    /// es quien traduce esa dirección a la local que acaba usando el driver.
    /// </summary>
    public SshTunnelSettings? SshTunnel { get; init; }

    /// <summary>La conexión no va directa: pasa por un servidor intermedio.</summary>
    public bool UsesSshTunnel => SshTunnel is not null;

    /// <summary>
    /// Opciones específicas del motor que no encajan en los campos anteriores.
    /// Nunca deben usarse para transportar credenciales.
    /// </summary>
    public IReadOnlyDictionary<string, string> Options { get; init; } =
        new Dictionary<string, string>();
}

/// <summary>Modo de cifrado del transporte, neutral respecto del motor.</summary>
public enum SslMode
{
    Disable = 0,
    Prefer = 1,
    Require = 2,
}
