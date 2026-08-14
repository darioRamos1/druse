namespace Druse.Domain;

/// <summary>
/// Cómo se identifica Druse ante el servidor SSH intermedio.
///
/// Es independiente de cómo se identifica luego contra el motor: el servidor de
/// salto y la base de datos son dos sistemas distintos, con dos cuentas
/// distintas, y confundirlos es la forma más rápida de no entender por qué falla
/// una conexión.
/// </summary>
public enum SshAuthenticationMode
{
    /// <summary>Contraseña del usuario SSH.</summary>
    Password = 0,

    /// <summary>Archivo de clave privada, con o sin passphrase.</summary>
    PrivateKey = 1,

    /// <summary>
    /// El servidor pregunta y el cliente responde. Es lo que usan los servidores
    /// con segundo factor: contraseña y, acto seguido, un código de un solo uso.
    /// </summary>
    KeyboardInteractive = 2,
}

/// <summary>
/// Servidor intermedio por el que viaja la conexión a la base.
///
/// Existe para las bases que no son alcanzables desde donde está el usuario: se
/// abre una sesión SSH contra una máquina que sí las ve y el tráfico del motor
/// viaja por dentro de esa sesión.
///
/// **No lleva contraseña ni passphrase.** Igual que <see cref="ConnectionProfile"/>,
/// los secretos viven en el almacén del sistema operativo y se recuperan al
/// abrir el túnel (plan §12).
/// </summary>
public sealed record SshTunnelSettings
{
    /// <summary>Servidor SSH al que conectarse. No es el servidor de la base.</summary>
    public required string Host { get; init; }

    public int Port { get; init; } = 22;

    /// <summary>Usuario de la máquina intermedia, no de la base de datos.</summary>
    public required string Username { get; init; }

    public SshAuthenticationMode Authentication { get; init; } = SshAuthenticationMode.Password;

    /// <summary>
    /// Ruta del archivo de clave privada, solo con
    /// <see cref="SshAuthenticationMode.PrivateKey"/>.
    ///
    /// Se guarda la ruta y no el contenido: la clave es del usuario y del sistema
    /// que la protege, y copiarla dentro de la base de Druse sería hacer una
    /// segunda copia de un secreto que ya estaba a buen recaudo.
    /// </summary>
    public string PrivateKeyPath { get; init; } = string.Empty;

    /// <summary>Segundos de espera al abrir la sesión SSH.</summary>
    public int ConnectTimeoutSeconds { get; init; } = 15;

    /// <summary>La clave privada necesita un archivo que abrir.</summary>
    public bool UsesPrivateKey => Authentication == SshAuthenticationMode.PrivateKey;
}
