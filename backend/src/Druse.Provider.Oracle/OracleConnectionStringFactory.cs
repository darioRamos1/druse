using Druse.Database.Abstractions;
using Druse.Domain;
using Oracle.ManagedDataAccess.Client;

namespace Druse.Provider.Oracle;

/// <summary>
/// Traduce un perfil neutral a una cadena de conexión de ODP.NET.
///
/// Es el único punto donde el perfil se convierte en algo específico de Oracle.
/// La cadena resultante contiene la contraseña, así que **no debe registrarse,
/// devolverse ni incluirse en mensajes de error** (plan §12).
///
/// Lo que aquí cambia respecto de los otros motores es el destino. Oracle no
/// tiene «una base» a la que conectarse: se conecta a un **servicio**, y el
/// mismo servidor puede publicar varios. Lo que el perfil llama `Database` es
/// ese nombre de servicio.
/// </summary>
internal static class OracleConnectionStringFactory
{
    /// <summary>Servicio al que ir cuando el perfil no dice ninguno.</summary>
    internal const string DefaultService = "FREEPDB1";

    /// <summary>
    /// Opción del perfil con la que se pide hablar con un SID en vez de con un
    /// servicio.
    ///
    /// Los SID son el modo antiguo, anterior a Oracle 9, y siguen vivos en
    /// instalaciones que nadie ha migrado. No se ofrece como campo del formulario
    /// porque confundiría a la mayoría, pero quien lo necesita puede escribirlo
    /// en las opciones y no queda sin salida.
    /// </summary>
    internal const string SidOption = "Sid";

    /// <summary>Opciones que se ignoran por venir ya en campos propios.</summary>
    private static readonly HashSet<string> ReservedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "Data Source",
        "DataSource",
        "User ID",
        "UserID",
        "Username",
        "Password",
        "Connection Timeout",
        "ConnectionTimeout",
        SidOption,
    };

    public static string Build(ConnectionProfile profile, DatabaseCredentials credentials)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var builder = new OracleConnectionStringBuilder
        {
            DataSource = Descriptor(profile),
            UserID = profile.Username,
            Password = credentials.Password,
            ConnectionTimeout = profile.ConnectTimeoutSeconds,
            Pooling = true,
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

    /// <summary>
    /// El descriptor de conexión, escrito entero en lugar de con la forma corta
    /// `host:puerto/servicio`.
    ///
    /// La forma corta no sabe decir que el transporte va cifrado —para eso hace
    /// falta `PROTOCOL=TCPS`— ni permite pedir un SID. Escribirlo completo cuesta
    /// unas líneas y cubre los tres casos con la misma plantilla, en vez de
    /// componer una cadena distinta según lo que haya pedido el usuario.
    ///
    /// **El cifrado se pide por el protocolo, no por una opción.** En Oracle,
    /// TCPS es un puerto y un escuchador distintos, así que exigir cifrado no es
    /// una bandera sobre la misma conexión: es conectarse a otro sitio. Por eso
    /// `Prefer` no puede «intentarlo y seguir si no»; se queda en TCP, que es lo
    /// que responde el escuchador corriente.
    /// </summary>
    internal static string Descriptor(ConnectionProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var protocol = profile.SslMode is SslMode.Require or SslMode.VerifyCA or SslMode.VerifyFull
            ? "TCPS"
            : "TCP";

        var target = profile.Options.TryGetValue(SidOption, out var sid)
            && !string.IsNullOrWhiteSpace(sid)
            ? $"(SID={sid.Trim()})"
            : $"(SERVICE_NAME={Service(profile)})";

        return "(DESCRIPTION=" +
            $"(ADDRESS=(PROTOCOL={protocol})(HOST={profile.Host})(PORT={profile.Port}))" +
            $"(CONNECT_DATA={target}))";
    }

    /// <summary>
    /// El servicio al que apunta el perfil.
    ///
    /// Un perfil sin base significa «la primera a la que tenga acceso» en los
    /// otros motores, y allí se resuelve preguntando al catálogo. Aquí no se
    /// puede preguntar sin estar conectado, y no se puede conectar sin nombrar el
    /// destino, así que hay que poner algo: el servicio de la instalación de
    /// serie, que es el que tiene delante quien todavía no sabe qué escribir.
    /// </summary>
    private static string Service(ConnectionProfile profile) =>
        string.IsNullOrWhiteSpace(profile.Database) ? DefaultService : profile.Database.Trim();
}
