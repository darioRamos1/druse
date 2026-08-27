using System.Globalization;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.Informix;

/// <summary>
/// Compone la URL de JDBC para hablar SQLI con Informix.
///
/// La forma es la misma que usa cualquier herramienta con este driver:
///
///     jdbc:informix-sqli://host:puerto/base:INFORMIXSERVER=nombre;user=u;password=p
///
/// Los dos puntos antes de `INFORMIXSERVER` no son un error de escritura: en
/// esta URL los parámetros van detrás de la base separados por `:`, y entre
/// ellos por `;`. Escribirlo con `?` como en otras URL de JDBC hace que el
/// driver no encuentre el servidor y responda algo que suena a red.
///
/// La URL lleva la contraseña, así que **no debe registrarse ni devolverse en
/// ningún mensaje de error** (plan §12).
/// </summary>
internal static class InformixSqliConnectionStringFactory
{
    public static string Build(ConnectionProfile profile, DatabaseCredentials credentials) =>
        Build(profile, credentials, profile.Database);

    /// <summary>
    /// Construye la URL apuntando a la base indicada.
    ///
    /// Como en DRDA, una conexión de Informix pertenece a **una** base y no se
    /// cambia con un `USE`: navegar a otra exige abrir otra conexión, y por eso
    /// la base es un parámetro y no se toma siempre del perfil.
    /// </summary>
    public static string Build(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        string? database)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var servidor = profile.InformixServer?.Trim();

        if (string.IsNullOrEmpty(servidor))
        {
            // Se dice aquí y no se deja fallar al driver: su error habla de red y
            // manda a mirar el cortafuegos, cuando lo que falta es un dato del
            // formulario.
            throw new DatabaseOperationException(new QueryError
            {
                Message = "Falta el servidor Informix. Es el nombre del `sqlhosts` "
                    + "—como `vehi_tcp`—, no el de la máquina, y en SQLI es obligatorio.",
            });
        }

        var puerto = profile.Port.ToString(CultureInfo.InvariantCulture);
        var baseElegida = database ?? profile.Database;

        var url = new System.Text.StringBuilder()
            .Append("jdbc:informix-sqli://")
            .Append(profile.Host)
            .Append(':')
            .Append(puerto)
            .Append('/')
            .Append(baseElegida)
            .Append(':')
            .Append("INFORMIXSERVER=")
            .Append(servidor);

        // Con autenticación de Windows no hay usuario que mandar: el driver de
        // Java no la habla, pero el formulario tampoco la ofrece para este motor.
        if (!string.IsNullOrEmpty(profile.Username))
        {
            url.Append(";user=").Append(profile.Username);
        }

        if (!string.IsNullOrEmpty(credentials.Password))
        {
            url.Append(";password=").Append(credentials.Password);
        }

        // `DELIMIDENT` hace que las comillas dobles delimiten identificadores y no
        // cadenas. Todo el SQL que genera Druse cita así, y sin esto una tabla
        // llamada `order` o con acentos sería inconsultable. Es lo mismo que se
        // fuerza por DRDA, escrito como lo espera este driver.
        url.Append(";DELIMIDENT=Y");

        if (profile.SslMode == SslMode.Require)
        {
            url.Append(";SSLCONNECTION=true");
        }

        foreach (var (clave, valor) in profile.Options)
        {
            if (Reservadas.Contains(clave))
            {
                continue;
            }

            url.Append(';').Append(clave).Append('=').Append(valor);
        }

        return url.ToString();
    }

    /// <summary>Lo que ya gobierna Druse y un perfil no debe poder pisar.</summary>
    private static readonly HashSet<string> Reservadas = new(StringComparer.OrdinalIgnoreCase)
    {
        "INFORMIXSERVER",
        "user",
        "password",
        "DELIMIDENT",
        "SSLCONNECTION",
    };
}
