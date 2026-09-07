using System.Text.RegularExpressions;

namespace Druse.Host.LocalApi.Diagnostics;

/// <summary>
/// Quita del registro lo que no puede quedar escrito en el disco.
///
/// **No es una opción, es el único camino**: cada línea que va al archivo pasa
/// por aquí. Un registro con la contraseña de la base del usuario dentro es peor
/// que no tener registro, porque además invita a mandarlo por correo cuando algo
/// falla.
///
/// Lo que se limpia no son cosas que Druse escriba a propósito —eso ya se evita—
/// sino lo que **viene de fuera**: los drivers ponen la cadena de conexión entera
/// en sus mensajes de error, y ahí va la contraseña. Pasó de verdad y por eso
/// existe `PostgreSqlErrorNormalizer` y sus hermanos; esto es la segunda red,
/// para lo que se escape de la primera.
///
/// Es una limpieza por patrones y se dice lo que eso significa: reconoce las
/// formas conocidas, no todas las imaginables. Por eso el criterio de arriba
/// sigue siendo el que manda: **no registrar SQL, ni filas, ni credenciales**, en
/// lugar de registrarlos y confiar en el filtro.
/// </summary>
public static partial class LogRedaction
{
    /// <summary>Lo que se pone en el sitio de lo que se quita.</summary>
    private const string Hidden = "···";

    /// <summary>
    /// `Password=algo`, `Pwd=algo` y sus variantes, tal y como aparecen dentro de
    /// una cadena de conexión de cualquiera de los cuatro drivers.
    ///
    /// El valor termina en `;` o al acabar la cadena, que es como se delimita en
    /// una cadena de conexión.
    /// </summary>
    [GeneratedRegex(
        @"\b(password|pwd|user\s*id|uid|token|api[_-]?key|secret)\s*=\s*[^;""']*",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex KeyValue { get; }

    /// <summary>
    /// El token de la API local: base64 de 32 bytes, tal y como se publica en
    /// `endpoint.json`. Quien lo lea puede abrir sesiones contra las bases del
    /// usuario, así que no puede quedar en un archivo de texto.
    /// </summary>
    [GeneratedRegex(
        @"\b[A-Za-z0-9+/]{40,}={0,2}\b",
        RegexOptions.CultureInvariant)]
    private static partial Regex LongSecret { get; }

    /// <summary>El texto listo para escribirse en el registro.</summary>
    public static string Clean(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        var clean = KeyValue.Replace(text, match => $"{Key(match.Value)}={Hidden}");

        return LongSecret.Replace(clean, Hidden);
    }

    /// <summary>El nombre del parámetro, para que la línea siga diciendo qué se quitó.</summary>
    private static string Key(string pair)
    {
        var separator = pair.IndexOf('=', StringComparison.Ordinal);

        return separator > 0 ? pair[..separator].TrimEnd() : pair;
    }
}
