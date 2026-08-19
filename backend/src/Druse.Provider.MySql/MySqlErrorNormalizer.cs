using System.Globalization;
using System.Text.RegularExpressions;
using Druse.Domain;
using MySqlConnector;

namespace Druse.Provider.MySql;

/// <summary>
/// Convierte excepciones de MySqlConnector en <see cref="QueryError"/>.
///
/// Dos motivos para hacerlo aquí y no dejar subir la excepción:
/// 1. El resto del sistema no debe conocer los tipos de MySqlConnector.
/// 2. Los mensajes del driver pueden incluir la cadena de conexión, y con ella la
///    contraseña. Lo que sale de aquí ya está saneado (plan §12).
/// </summary>
internal static partial class MySqlErrorNormalizer
{
    public static QueryError Normalize(Exception exception) => exception switch
    {
        MySqlException mysql => new QueryError
        {
            Message = mysql.Message,
            // MySQL da dos identificadores: un número propio (1064) y un SQLSTATE
            // estándar (42000). Se transporta el número, igual que en SQL Server,
            // porque es el que sale en los mensajes del servidor y el que se busca
            // en su documentación.
            Code = ((int)mysql.ErrorCode).ToString(CultureInfo.InvariantCulture),
            Line = LineOf(mysql.Message),
        },

        TimeoutException => new QueryError
        {
            Message = "La operación superó el tiempo de espera.",
        },

        OperationCanceledException => new QueryError
        {
            Message = "La operación se canceló.",
        },

        _ => new QueryError
        {
            // Se usa el mensaje sin la traza: el detalle va al log del servidor,
            // no a la interfaz.
            Message = exception.Message,
        },
    };

    /// <summary>
    /// La línea del error, que MySQL **solo cuenta dentro del texto**.
    ///
    /// A diferencia de PostgreSQL, que da la posición, y de SQL Server, que da la
    /// línea en un campo propio, aquí el único sitio donde aparece es el final
    /// del mensaje: «…near 'FROM tabla_x' at line 3». Sin esto, el editor no
    /// tenía nada que señalar en MySQL y el error se leía sin saber dónde miraba.
    ///
    /// Es un heurístico y se comporta como tal: si el servidor responde en otro
    /// idioma —MySQL traduce sus mensajes— o el error no es de sintaxis y no
    /// lleva línea, no se devuelve ninguna y el editor no marca nada. Es
    /// preferible a señalar una línea inventada.
    /// </summary>
    internal static int? LineOf(string message)
    {
        var match = LinePattern().Match(message);

        return match.Success
            && int.TryParse(match.Groups[1].Value, CultureInfo.InvariantCulture, out var line)
            && line > 0
            ? line
            : null;
    }

    /// <summary>
    /// Se ancla al final porque ahí es donde MySQL la escribe, y el SQL del
    /// usuario puede contener ese mismo texto dentro de un literal.
    /// </summary>
    [GeneratedRegex(@"\bat line (\d+)\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex LinePattern();
}
