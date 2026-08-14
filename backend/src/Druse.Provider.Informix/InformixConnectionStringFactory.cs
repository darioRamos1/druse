using Druse.Database.Abstractions;
using Druse.Domain;
using IBM.Data.Db2;

namespace Druse.Provider.Informix;

/// <summary>
/// Traduce un perfil neutral a una cadena de conexión del proveedor de IBM.
///
/// Es el único punto donde el perfil se convierte en algo específico de Informix.
/// La cadena resultante contiene la contraseña, así que **no debe registrarse,
/// devolverse ni incluirse en mensajes de error** (plan §12).
/// </summary>
internal static class InformixConnectionStringFactory
{
    /// <summary>Opciones del perfil que se ignoran por venir ya en campos propios.</summary>
    private static readonly HashSet<string> ReservedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "Server",
        "Host",
        "Port",
        "Database",
        "DBName",
        "UID",
        "User ID",
        "UserID",
        "PWD",
        "Password",
        "Security",
        "Connect Timeout",
        "ConnectTimeout",
    };

    public static string Build(ConnectionProfile profile, DatabaseCredentials credentials) =>
        Build(profile, credentials, profile.Database);

    /// <summary>
    /// Construye la cadena apuntando a la base indicada.
    ///
    /// En Informix una conexión pertenece a **una** base y no se puede cambiar
    /// con un `USE`: navegar a otra base exige abrir otra conexión. Por eso la
    /// base es un parámetro y no se toma siempre del perfil.
    /// </summary>
    public static string Build(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        string? database)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var builder = new DB2ConnectionStringBuilder
        {
            Server = $"{profile.Host}:{profile.Port}",
            Database = database ?? profile.Database,
            UserID = profile.Username,
            Password = credentials.Password,
            Connect_Timeout = profile.ConnectTimeoutSeconds,
            Pooling = true,

            // Le dice al proveedor que al otro lado hay un Informix (IDS) y no un
            // DB2. El protocolo es DRDA en ambos casos, pero no todo se comporta
            // igual, y declararlo evita que el driver tenga que adivinarlo.
            ServerType = "IDS",
        };

        // Sin DELIMIDENT, Informix trata las comillas dobles como delimitador de
        // cadena y no de identificador: `SELECT "nombre" FROM t` devolvería la
        // palabra literal en vez de la columna. Todo el DDL y el SQL generado de
        // Druse cita con comillas dobles, así que esto es lo que hace que una
        // tabla llamada `order` o con acentos pueda consultarse siquiera.
        builder["DELIMIDENT"] = "Y";

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
    /// El proveedor de IBM no tiene un modo «cifra si puedes»: o se pide SSL o no.
    /// `Prefer` se resuelve como sin cifrado porque pedirlo contra un servidor que
    /// no lo tiene configurado **falla la conexión** en lugar de degradarse, y un
    /// explorador debe poder abrir servidores que no controla.
    /// </summary>
    private static void Apply(DB2ConnectionStringBuilder builder, Domain.SslMode mode)
    {
        if (mode == Domain.SslMode.Require)
        {
            builder.Security = "SSL";
        }
    }
}
