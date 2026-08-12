using Druse.Domain;
using Microsoft.Data.SqlClient;

namespace Druse.Provider.SqlServer;

/// <summary>
/// Convierte excepciones de SqlClient en <see cref="QueryError"/>.
///
/// Dos motivos para hacerlo aquí y no dejar subir la excepción:
/// 1. El resto del sistema no debe conocer los tipos de SqlClient.
/// 2. Los mensajes del driver pueden incluir la cadena de conexión, y con ella la
///    contraseña. Lo que sale de aquí ya está saneado (plan §12).
/// </summary>
internal static class SqlServerErrorNormalizer
{
    public static QueryError Normalize(Exception exception) => exception switch
    {
        SqlException sql => new QueryError
        {
            Message = FirstError(sql),
            // SQL Server usa códigos numéricos propios en lugar de SQLSTATE; se
            // transportan como texto para no obligar al contrato a distinguir
            // entre el formato de cada motor.
            Code = sql.Number.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Line = FirstLine(sql),
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
    /// Primer error real del lote.
    ///
    /// SqlException agrupa varios errores y su `Message` los concatena todos, lo
    /// que produce mensajes larguísimos. El primero suele ser la causa.
    /// </summary>
    private static string FirstError(SqlException exception)
    {
        foreach (SqlError error in exception.Errors)
        {
            if (!string.IsNullOrWhiteSpace(error.Message))
            {
                return error.Message;
            }
        }

        return exception.Message;
    }

    /// <summary>Línea del SQL donde falló, si el servidor la reporta.</summary>
    private static int? FirstLine(SqlException exception)
    {
        foreach (SqlError error in exception.Errors)
        {
            if (error.LineNumber > 0)
            {
                return error.LineNumber;
            }
        }

        return null;
    }
}
