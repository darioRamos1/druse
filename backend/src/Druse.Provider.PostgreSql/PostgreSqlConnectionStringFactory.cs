using Druse.Database.Abstractions;
using Druse.Domain;
using Npgsql;

namespace Druse.Provider.PostgreSql;

/// <summary>
/// Traduce un perfil neutral a una cadena de conexión de Npgsql.
///
/// Es el único punto donde el perfil se convierte en algo específico de
/// PostgreSQL. La cadena resultante contiene la contraseña, así que **no debe
/// registrarse, devolverse ni incluirse en mensajes de error** (plan §12).
/// </summary>
internal static class PostgreSqlConnectionStringFactory
{
    /// <summary>Opciones del perfil que se ignoran por venir ya en campos propios.</summary>
    private static readonly HashSet<string> ReservedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "Host",
        "Port",
        "Database",
        "Username",
        "Password",
        "SSL Mode",
        "SslMode",
        "Timeout",
    };

    public static string Build(ConnectionProfile profile, DatabaseCredentials credentials)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = profile.Host,
            Port = profile.Port,
            Database = profile.Database,
            Username = profile.Username,
            Password = credentials.Password,
            SslMode = Translate(profile.SslMode),
            Timeout = profile.ConnectTimeoutSeconds,
            // El nombre aparece en pg_stat_activity: ayuda al administrador a saber
            // qué está conectado a su servidor.
            ApplicationName = "Druse",
            // El pool lo administra la sesión, que vive mientras el usuario la tenga
            // abierta. Sin esto, cancelar y reabrir dejaría conexiones colgando.
            Pooling = true,
            IncludeErrorDetail = true,
        };

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

    private static Npgsql.SslMode Translate(Domain.SslMode mode) => mode switch
    {
        Domain.SslMode.Disable => Npgsql.SslMode.Disable,
        Domain.SslMode.Require => Npgsql.SslMode.Require,
        _ => Npgsql.SslMode.Prefer,
    };
}
