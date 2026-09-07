using Druse.Database.Abstractions;
using Druse.Domain;
using MySqlConnector;

namespace Druse.Provider.MySql;

/// <summary>
/// Traduce un perfil neutral a una cadena de conexión de MySqlConnector.
///
/// Es el único punto donde el perfil se convierte en algo específico de MySQL. La
/// cadena resultante contiene la contraseña, así que **no debe registrarse,
/// devolverse ni incluirse en mensajes de error** (plan §12).
/// </summary>
internal static class MySqlConnectionStringFactory
{
    /// <summary>Opciones del perfil que se ignoran por venir ya en campos propios.</summary>
    private static readonly HashSet<string> ReservedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "Server",
        "Host",
        "Port",
        "Database",
        "User ID",
        "UserID",
        "Username",
        "Password",
        "SSL Mode",
        "SslMode",
        "Connection Timeout",
        "ConnectionTimeout",
    };

    public static string Build(ConnectionProfile profile, DatabaseCredentials credentials)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var builder = new MySqlConnectionStringBuilder
        {
            Server = profile.Host,
            Port = (uint)profile.Port,
            Database = profile.Database,
            UserID = profile.Username,
            Password = credentials.Password,
            ConnectionTimeout = (uint)profile.ConnectTimeoutSeconds,
            // Aparece en SHOW PROCESSLIST: ayuda al administrador a saber qué está
            // conectado a su servidor.
            ApplicationName = "Druse",
            Pooling = true,

            // MySQL admite fechas cero ('0000-00-00'), que .NET no puede
            // representar. Sin esto, leer una tabla heredada que las contenga
            // lanza una excepción en mitad del resultado en lugar de mostrar el
            // dato. Un explorador tiene que poder abrir bases que no controla.
            ConvertZeroDateTime = true,

            // Por omisión, MySqlConnector interpreta toda columna CHAR(36) como
            // Guid y falla al leerla si el texto no lo es. Aquí se muestran datos
            // ajenos: un CHAR(36) con cualquier otro contenido es perfectamente
            // legítimo y debe verse tal cual.
            GuidFormat = MySqlGuidFormat.None,

            // MySQL no tiene tipo booleano: BOOL es un sinónimo de TINYINT(1). Con
            // esto, esas columnas llegan como bool y se muestran como `true` o
            // `false`, igual que el `boolean` de PostgreSQL y el `bit` de SQL
            // Server. Es el valor por omisión; se deja explícito porque de él
            // depende que los tres motores se lean igual.
            TreatTinyAsBoolean = true,

            // Un cliente SQL tiene que poder ejecutar `SET @total = 0; SELECT @total;`.
            // Los parámetros con nombre de las consultas de catálogo se siguen
            // sustituyendo, porque están declarados en el comando; lo que cambia es
            // que un `@algo` sin declarar deja de ser un error y viaja al servidor.
            AllowUserVariables = true,
        };

        Apply(builder, profile.SslMode);

        foreach (var (key, value) in profile.Options)
        {
            if (ReservedKeys.Contains(key))
            {
                continue;
            }

            builder[key] = value;
        }

        return builder.ConnectionString;
    }

    /// <summary>
    /// Traduce el modo SSL neutral.
    ///
    /// Los cinco valen y significan lo mismo que en el resto: `Required` exige
    /// cifrado pero **no** valida la cadena de confianza, y para comprobar con
    /// quién se habla están `VerifyCA` y `VerifyFull`. Sin certificado propio
    /// configurado, la validación se hace contra el almacén de confianza del
    /// sistema, que es lo que sirve para un servidor con certificado de verdad.
    /// </summary>
    private static void Apply(MySqlConnectionStringBuilder builder, Domain.SslMode mode) =>
        builder.SslMode = mode switch
        {
            Domain.SslMode.Disable => MySqlSslMode.Disabled,
            Domain.SslMode.Require => MySqlSslMode.Required,
            Domain.SslMode.VerifyCA => MySqlSslMode.VerifyCA,
            Domain.SslMode.VerifyFull => MySqlSslMode.VerifyFull,
            _ => MySqlSslMode.Preferred,
        };
}
