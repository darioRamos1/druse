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
    /// Nombre del servidor lógico de Informix, el `INFORMIXSERVER`.
    ///
    /// Solo lo usa <see cref="DatabaseEngine.InformixSqli"/>. Es el alias del
    /// `sqlhosts` —`vehi_tcp`, `ol_informix1210`— y **no es el nombre de la
    /// máquina**: un mismo servidor publica varios, uno por protocolo, y el de
    /// SQLI no tiene por qué parecerse al de DRDA.
    ///
    /// En SQLI es obligatorio; sin él, el driver no sabe con cuál de las
    /// instancias del servidor quiere hablar.
    /// </summary>
    public string? InformixServer { get; init; }

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
    /// <summary>Sin cifrado. La contraseña y los datos viajan en claro.</summary>
    Disable = 0,

    /// <summary>Cifra si el servidor lo ofrece, y sigue adelante si no.</summary>
    Prefer = 1,

    /// <summary>
    /// Exige cifrado, **pero no comprueba con quién se está hablando**.
    ///
    /// Protege de quien escucha el cable, no de quien se hace pasar por el
    /// servidor: un certificado autofirmado, caducado o de otro dominio vale
    /// igual. Es lo que quiere una instalación de desarrollo, y por eso no se
    /// llama «seguro» en ningún sitio de la interfaz.
    /// </summary>
    Require = 2,

    /// <summary>
    /// Exige cifrado y que el certificado lo firme una autoridad de confianza.
    ///
    /// Ya no vale un autofirmado. Lo que **no** comprueba es que el nombre del
    /// certificado sea el del servidor al que se pidió conectar: para eso está
    /// <see cref="VerifyFull"/>.
    /// </summary>
    VerifyCA = 3,

    /// <summary>
    /// Cifrado, certificado de confianza **y** nombre que coincide con el
    /// servidor. Es el único modo que protege de un intermediario.
    /// </summary>
    VerifyFull = 4,
}
