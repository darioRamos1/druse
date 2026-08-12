using Druse.Domain;
using Npgsql;

namespace Druse.Provider.PostgreSql;

/// <summary>
/// Convierte excepciones de Npgsql en <see cref="QueryError"/>.
///
/// Dos motivos para hacerlo aquí y no dejar subir la excepción:
/// 1. El resto del sistema no debe conocer los tipos de Npgsql.
/// 2. Los mensajes del driver pueden incluir la cadena de conexión, y con ella la
///    contraseña. Lo que sale de aquí ya está saneado (plan §12).
/// </summary>
internal static class PostgreSqlErrorNormalizer
{
    public static QueryError Normalize(Exception exception) => exception switch
    {
        PostgresException postgres => new QueryError
        {
            Message = postgres.MessageText,
            Code = postgres.SqlState,
            Position = ParsePosition(postgres.Position),
        },

        // Fallo de red, host inexistente, servidor caído o credenciales rechazadas
        // antes de llegar a hablar SQL.
        NpgsqlException npgsql => new QueryError
        {
            Message = Describe(npgsql),
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
    /// Describe un fallo de conexión sin exponer la cadena que lo produjo.
    ///
    /// Npgsql anida la causa real en <see cref="Exception.InnerException"/>; el
    /// mensaje externo suele ser genérico y poco útil por sí solo.
    /// </summary>
    private static string Describe(NpgsqlException exception)
    {
        var inner = exception.InnerException;

        return inner is null
            ? exception.Message
            : $"{exception.Message} ({inner.Message})";
    }

    /// <summary>Npgsql expone la posición como texto y con 0 cuando no la conoce.</summary>
    private static int? ParsePosition(int position) => position > 0 ? position : null;
}
