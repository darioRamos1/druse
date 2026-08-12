namespace Druse.Domain;

/// <summary>Entorno al que apunta una conexión. Determina el color y las advertencias.</summary>
public enum ConnectionEnvironment
{
    Development = 0,
    Testing = 1,
    Production = 2,
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

    public required string Username { get; init; }

    public ConnectionEnvironment Environment { get; init; } = ConnectionEnvironment.Development;

    /// <summary>Impide ejecutar instrucciones que modifican datos.</summary>
    public bool ReadOnly { get; init; }

    /// <summary>Cifrado del transporte. Cada proveedor lo traduce a su dialecto.</summary>
    public SslMode SslMode { get; init; } = SslMode.Prefer;

    /// <summary>Segundos de espera al abrir la conexión.</summary>
    public int ConnectTimeoutSeconds { get; init; } = 15;

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
