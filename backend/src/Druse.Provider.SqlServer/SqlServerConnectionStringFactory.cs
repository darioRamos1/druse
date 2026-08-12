using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.SqlClient;

namespace Druse.Provider.SqlServer;

/// <summary>
/// Traduce un perfil neutral a una cadena de conexión de SqlClient.
///
/// Es el único punto donde el perfil se convierte en algo específico de SQL
/// Server. La cadena resultante contiene la contraseña, así que **no debe
/// registrarse, devolverse ni incluirse en mensajes de error** (plan §12).
/// </summary>
internal static class SqlServerConnectionStringFactory
{
    /// <summary>Opciones del perfil que se ignoran por venir ya en campos propios.</summary>
    private static readonly HashSet<string> ReservedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "Data Source",
        "Server",
        "Initial Catalog",
        "Database",
        "User ID",
        "Password",
        "Encrypt",
        "Connect Timeout",
    };

    public static string Build(ConnectionProfile profile, DatabaseCredentials credentials)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var builder = new SqlConnectionStringBuilder
        {
            // SQL Server admite instancias con nombre; el puerto se separa con coma,
            // no con dos puntos como en el resto de motores.
            DataSource = $"{profile.Host},{profile.Port}",
            InitialCatalog = profile.Database,
            UserID = profile.Username,
            Password = credentials.Password,
            ConnectTimeout = profile.ConnectTimeoutSeconds,
            ApplicationName = "Druse",
            Pooling = true,
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
    /// SqlClient 4 cambió el valor por omisión de `Encrypt` a `true`, lo que rompe
    /// la conexión contra servidores con certificado autofirmado —el caso de
    /// cualquier instalación de desarrollo—. Por eso, cuando el usuario no exige
    /// cifrado, se acepta explícitamente el certificado del servidor en lugar de
    /// fallar con un error de confianza que no explica nada.
    /// </summary>
    private static void Apply(SqlConnectionStringBuilder builder, Domain.SslMode mode)
    {
        switch (mode)
        {
            case Domain.SslMode.Disable:
                builder.Encrypt = false;
                break;

            case Domain.SslMode.Require:
                builder.Encrypt = true;
                builder.TrustServerCertificate = false;
                break;

            default:
                builder.Encrypt = true;
                builder.TrustServerCertificate = true;
                break;
        }
    }
}
