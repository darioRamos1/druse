using System.Globalization;

using Druse.Domain;

namespace Druse.Application.Connections;

/// <summary>Resultado de validar un perfil antes de intentar conectarse.</summary>
/// <param name="Messages">Vacío cuando el perfil es válido.</param>
public readonly record struct ValidationResult(IReadOnlyList<UserMessage> Messages)
{
    /// <summary>Solo los textos, para lo que no traduce: registros y pruebas.</summary>
    public IReadOnlyList<string> Errors => [.. Messages.Select(message => message.Text)];

    public bool IsValid => Messages.Count == 0;

    public static ValidationResult Valid => new([]);

    /// <summary>Un resultado a partir de textos sueltos, mientras queden sin clave.</summary>
    public static ValidationResult FromTexts(IEnumerable<string> texts) =>
        new([.. texts.Select(text => new UserMessage(string.Empty, text))]);
}

/// <summary>
/// Comprueba que un perfil tiene sentido antes de abrir una conexión.
///
/// Detectar aquí un puerto fuera de rango o un host vacío ahorra al usuario
/// esperar a que expire un intento de conexión para leer un error del driver que
/// no le dice qué escribió mal.
/// </summary>
public static class ConnectionProfileValidator
{
    private const int MaxNameLength = 120;

    /// <summary>
    /// Lo que se supone de un motor del que no se sabe nada.
    ///
    /// Se usa cuando nadie pasa capacidades —las pruebas que solo miran el
    /// nombre o el puerto, y un motor cuyo proveedor no está registrado en esta
    /// compilación—. Describe al motor corriente: un servidor con host y
    /// usuario. Suponer lo contrario dejaría pasar perfiles vacíos.
    /// </summary>
    private static readonly EngineCapabilities Corriente = new() { NativeFamilies = [] };

    public static ValidationResult Validate(ConnectionProfile? profile) =>
        Validate(profile, capabilities: null);

    /// <summary>
    /// Comprueba el perfil contra lo que el motor dice de sí mismo.
    /// </summary>
    /// <param name="capabilities">
    /// Lo que este motor necesita para conectar. Es lo que permite que la misma
    /// función valga para un servidor y para un motor que es un archivo: sin
    /// esto habría que preguntar aquí por el motor, y cada motor nuevo añadiría
    /// su condicional.
    /// </param>
    public static ValidationResult Validate(
        ConnectionProfile? profile,
        EngineCapabilities? capabilities)
    {
        if (profile is null)
        {
            return new ValidationResult(
                [new UserMessage(MessageKeys.Connection.Required, "El perfil de conexión es obligatorio.")]);
        }

        var motor = capabilities ?? Corriente;

        var errors = new List<UserMessage>();

        if (string.IsNullOrWhiteSpace(profile.Name))
        {
            errors.Add(new UserMessage(MessageKeys.Connection.Name, "El nombre de la conexión es obligatorio."));
        }
        else if (profile.Name.Length > MaxNameLength)
        {
            errors.Add(UserMessage.With(
                MessageKeys.Connection.NameTooLong,
                $"El nombre no puede superar {MaxNameLength} caracteres.",
                "max",
                MaxNameLength.ToString(CultureInfo.InvariantCulture)));
        }

        if (motor.RequiresHost && string.IsNullOrWhiteSpace(profile.Host))
        {
            errors.Add(new UserMessage(MessageKeys.Connection.Host, "El servidor es obligatorio."));
        }

        var namedSqlServerInstance =
            profile.Engine == DatabaseEngine.SqlServer
            && profile.Host.Contains('\\')
            // Un túnel reenvía un puerto TCP concreto; sin puerto no hay nada que
            // reenviar, por mucho que la instancia tenga nombre.
            && !profile.UsesSshTunnel;

        // El puerto solo tiene sentido donde hay un servidor al que llegar: un
        // motor que es un archivo no tiene ninguno, y exigirle uno le pediría un
        // dato que no existe.
        if (motor.RequiresHost
            && profile.Port is < 1 or > 65535
            && !(namedSqlServerInstance && profile.Port == 0))
        {
            errors.Add(new UserMessage(
                MessageKeys.Connection.Port,
                "El puerto debe estar entre 1 y 65535, salvo en una instancia con nombre de SQL Server."));
        }

        // La base **no** es obligatoria en un servidor. Vacía significa «la
        // primera a la que tenga acceso»: quien abre una conexión a un servidor
        // ajeno rara vez se sabe de memoria el nombre de su base, y exigírselo
        // antes de dejarle conectar es pedirle el dato que venía a buscar.
        //
        // En un motor que es un archivo sí lo es: sin la ruta no hay nada que
        // abrir, y «la primera a la que tenga acceso» no significa nada.
        if (motor.RequiresDatabase && string.IsNullOrWhiteSpace(profile.Database))
        {
            errors.Add(motor.UsesFilePath
                ? new UserMessage(
                    MessageKeys.Connection.DatabaseFile,
                    "Indica el archivo de la base de datos.")
                : new UserMessage(
                    MessageKeys.Connection.Database,
                    "La base de datos es obligatoria."));
        }

        // Con autenticación de Windows la identidad la pone la sesión del sistema,
        // así que exigir un usuario obligaría a inventarse uno que nadie usa.
        if (motor.RequiresUsername
            && !profile.UsesIntegratedSecurity
            && string.IsNullOrWhiteSpace(profile.Username))
        {
            errors.Add(new UserMessage(MessageKeys.Connection.Username, "El usuario es obligatorio."));
        }

        if (!Enum.IsDefined(profile.Authentication))
        {
            errors.Add(new UserMessage(
                MessageKeys.Connection.Authentication,
                "El método de autenticación indicado no es válido."));
        }
        else if (profile.UsesIntegratedSecurity && !motor.SupportsIntegratedSecurity)
        {
            errors.Add(new UserMessage(
                MessageKeys.Connection.WindowsOnSqlServer,
                "La autenticación de Windows solo está disponible en SQL Server."));
        }
        else if (profile.UsesIntegratedSecurity && !OperatingSystem.IsWindows())
        {
            // Fuera de Windows no hay sesión de dominio de la que colgarse: el
            // driver fallaría mucho más tarde y con un error del sistema.
            errors.Add(new UserMessage(
                MessageKeys.Connection.WindowsOnWindows,
                "La autenticación de Windows solo está disponible en Windows."));
        }

        if (!Enum.IsDefined(profile.Engine))
        {
            errors.Add(new UserMessage(MessageKeys.Connection.Engine, "El motor indicado no es válido."));
        }

        if (motor.RequiresLogicalServer && string.IsNullOrWhiteSpace(profile.InformixServer))
        {
            errors.Add(new UserMessage(
                MessageKeys.Connection.InformixServer,
                "El Server de Informix (INFORMIXSERVER) es obligatorio para una conexión SQLI."));
        }

        if (profile.ConnectTimeoutSeconds is < 1 or > 300)
        {
            errors.Add(new UserMessage(
                MessageKeys.Connection.Timeout,
                "El tiempo de espera de conexión debe estar entre 1 y 300 segundos."));
        }

        if (profile.SshTunnel is { } tunnel)
        {
            Validate(tunnel, errors);
        }

        return new ValidationResult(errors);
    }

    /// <summary>
    /// Comprueba el servidor intermedio.
    ///
    /// Sus errores se nombran como «del túnel» para que no se confundan con los
    /// del motor: son dos máquinas distintas y el usuario tiene que saber en cuál
    /// se equivocó.
    /// </summary>
    private static void Validate(SshTunnelSettings tunnel, List<UserMessage> errors)
    {
        if (string.IsNullOrWhiteSpace(tunnel.Host))
        {
            errors.Add(new UserMessage(MessageKeys.Tunnel.Host, "El servidor del túnel SSH es obligatorio."));
        }

        if (tunnel.Port is < 1 or > 65535)
        {
            errors.Add(new UserMessage(
                MessageKeys.Tunnel.Port,
                "El puerto del túnel SSH debe estar entre 1 y 65535."));
        }

        if (string.IsNullOrWhiteSpace(tunnel.Username))
        {
            errors.Add(new UserMessage(
                MessageKeys.Tunnel.Username,
                "El usuario del túnel SSH es obligatorio."));
        }

        if (!Enum.IsDefined(tunnel.Authentication))
        {
            errors.Add(new UserMessage(
                MessageKeys.Tunnel.Authentication,
                "El método de autenticación del túnel SSH no es válido."));
        }
        else if (tunnel.UsesPrivateKey && string.IsNullOrWhiteSpace(tunnel.PrivateKeyPath))
        {
            errors.Add(new UserMessage(
                MessageKeys.Tunnel.PrivateKey,
                "Indica el archivo de clave privada del túnel SSH."));
        }

        if (tunnel.ConnectTimeoutSeconds is < 1 or > 300)
        {
            errors.Add(new UserMessage(
                MessageKeys.Tunnel.Timeout,
                "El tiempo de espera del túnel SSH debe estar entre 1 y 300 segundos."));
        }
    }
}
