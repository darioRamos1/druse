using System.Collections.Concurrent;
using System.Globalization;
using System.Text.RegularExpressions;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.Informix;

/// <summary>
/// El locale de cada base, para que el driver JDBC lea bien su texto.
///
/// **El driver de SQLI no pregunta en qué codificación está la base**: supone
/// `en_US.819` —Latin-1— salvo que se le diga otra cosa con `DB_LOCALE`. Contra
/// una base creada en UTF-8 o en la página de Windows (`en_US.1252`), el servidor
/// responde «Database locale information mismatch» y la conexión no se abre.
/// Por DRDA no pasa: allí el servidor convierte al cliente por su cuenta.
///
/// Comprobado contra el contenedor de pruebas con bases en `en_US.819`,
/// `es_ES.819`, `en_US.1252` y `en_US.utf8`: con el locale correcto las cuatro
/// devuelven «canción» y «Ñandú» por SQLI, igual que por DRDA; sin él, las dos
/// últimas no conectan.
///
/// **Se averigua solo cuando hace falta.** Las bases en Latin-1 conectan a la
/// primera, que es el caso de siempre, y no pagan una conexión de más. Solo ante
/// el rechazo se lee el catálogo, y lo leído se recuerda para no repetirlo cada
/// vez que se abre una pestaña contra la misma base.
/// </summary>
internal static partial class InformixSqliLocale
{
    /// <summary>«Database locale information mismatch».</summary>
    internal const int Mismatch = -23197;

    /// <summary>
    /// Lo ya averiguado, por servidor y base.
    ///
    /// Vive lo que vive el proceso: el locale de una base no cambia sin
    /// recrearla, y si alguien lo hiciera, el siguiente rechazo lo vuelve a leer.
    /// </summary>
    private static readonly ConcurrentDictionary<string, string> Recordados =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Abre la conexión con el locale de la base, averiguándolo si el servidor
    /// rechaza el que se le dio.
    /// </summary>
    public static async Task<Druse.Jdbc.JdbcConnection> AbrirAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        var clave = Clave(profile);
        var conocido = Recordados.TryGetValue(clave, out var recordado) ? recordado : null;

        try
        {
            return await IntentarAsync(profile, credentials, conocido, cancellationToken);
        }
        catch (Druse.Jdbc.JdbcException exception) when (exception.ErrorCode == Mismatch)
        {
            var real = await LeerAsync(profile, credentials, cancellationToken);

            // Si el catálogo no lo sabe, o dice lo mismo que ya se probó, volver a
            // intentarlo daría el mismo rechazo: se cuenta el original.
            if (real is null || string.Equals(real, conocido, StringComparison.OrdinalIgnoreCase))
            {
                throw;
            }

            var conexion = await IntentarAsync(profile, credentials, real, cancellationToken);

            Recordados[clave] = real;

            return conexion;
        }
    }

    /// <summary>
    /// Deja pasar solo lo que tiene forma de locale de Informix.
    ///
    /// El valor acaba dentro de la URL de JDBC, donde un `;` abriría un parámetro
    /// nuevo. Sale del catálogo del servidor y no del usuario, pero la URL lleva
    /// la contraseña, y no se pega en ella nada que no se haya mirado antes.
    /// </summary>
    public static string Validar(string locale)
    {
        var limpio = locale.Trim();

        if (!FormaDeLocale().IsMatch(limpio))
        {
            throw new ArgumentException(
                $"«{limpio}» no tiene la forma de un locale de Informix.",
                nameof(locale));
        }

        return limpio;
    }

    /// <summary>Solo para las pruebas: olvida lo averiguado.</summary>
    internal static void Olvidar() => Recordados.Clear();

    private static async Task<Druse.Jdbc.JdbcConnection> IntentarAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        string? locale,
        CancellationToken cancellationToken)
    {
        var conexion = new Druse.Jdbc.JdbcConnection(
            InformixSqliConnectionStringFactory.Build(profile, credentials, profile.Database, locale));

        try
        {
            await conexion.OpenAsync(cancellationToken);

            return conexion;
        }
        catch
        {
            await conexion.DisposeAsync();
            throw;
        }
    }

    /// <summary>
    /// Pregunta al servidor con qué locale se creó la base.
    ///
    /// Se pregunta desde `sysmaster` porque es la única base a la que se puede
    /// entrar sin saber nada: el driver no conecta sin nombrar una (-349), y en
    /// el servidor de pruebas `sysmaster` está en `en_US.819`, que es justo lo
    /// que el driver da por hecho. Si en otro servidor tampoco ahí se puede
    /// entrar, se devuelve `null` y el rechazo original llega tal cual.
    /// </summary>
    private static async Task<string?> LeerAsync(
        ConnectionProfile profile,
        DatabaseCredentials credentials,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var conexion = new Druse.Jdbc.JdbcConnection(
                InformixSqliConnectionStringFactory.Build(profile, credentials, "sysmaster"));

            await conexion.OpenAsync(cancellationToken);

            await using var comando = conexion.CreateCommand();

            comando.CommandText =
                "SELECT TRIM(dbs_collate) FROM sysmaster:sysdbslocale WHERE dbs_dbsname = ?";

            var parametro = comando.CreateParameter();
            parametro.Value = profile.Database;
            comando.Parameters.Add(parametro);

            var valor = await comando.ExecuteScalarAsync(cancellationToken);
            var texto = Convert.ToString(valor, CultureInfo.InvariantCulture);

            return string.IsNullOrWhiteSpace(texto) || !FormaDeLocale().IsMatch(texto.Trim())
                ? null
                : texto.Trim();
        }
        catch (Druse.Jdbc.JdbcException)
        {
            return null;
        }
    }

    private static string Clave(ConnectionProfile profile) =>
        string.Join(
            '|',
            profile.Host,
            profile.Port.ToString(CultureInfo.InvariantCulture),
            profile.InformixServer,
            profile.Database);

    /// <summary>`idioma_PAÍS.codificación`, con la codificación en nombre o en número.</summary>
    [GeneratedRegex(@"^[A-Za-z]{2,3}_[A-Za-z]{2}\.[A-Za-z0-9_@-]{1,32}$")]
    private static partial Regex FormaDeLocale();
}
