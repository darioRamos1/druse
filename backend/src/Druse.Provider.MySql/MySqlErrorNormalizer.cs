using System.Globalization;
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
internal static class MySqlErrorNormalizer
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
}
