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
            Message = Explain(postgres),
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
    /// Explica los fallos de conexión que el servidor cuenta en inglés y en sus
    /// propios términos.
    ///
    /// Los demás se dejan tal cual: PostgreSQL escribe buenos mensajes de error
    /// de SQL —dice qué columna, qué tipo, qué restricción— y reescribirlos sería
    /// perder información. Lo que no explica bien es **por qué no te deja
    /// entrar**, porque habla de su configuración y no de lo que el usuario ve.
    ///
    /// El texto original se conserva al final: es lo que hay que enseñarle a
    /// quien administra el servidor.
    /// </summary>
    private static string Explain(PostgresException postgres)
    {
        var original = postgres.MessageText;

        return postgres.SqlState switch
        {
            // Ninguna regla de pg_hba.conf casa con esta combinación de origen,
            // usuario, base y cifrado.
            "28000" when original.Contains("pg_hba.conf", StringComparison.OrdinalIgnoreCase) =>
                original.Contains("no encryption", StringComparison.OrdinalIgnoreCase)
                    ? "El servidor rechazó la conexión por llegar sin cifrar: su configuración de " +
                      "acceso no admite conexiones en claro desde esta dirección. Prueba a poner el " +
                      "cifrado en «Requerir». Si aun así falla, es que la dirección no está " +
                      $"autorizada y hay que añadirla en el servidor. ({original})"
                    : "El servidor no tiene autorizada esta combinación de dirección, usuario y base " +
                      "en su configuración de acceso. No es la contraseña: hay que añadir la regla " +
                      $"en el servidor y recargar su configuración. ({original})",

            "28P01" => $"La contraseña no es correcta para este usuario. ({original})",

            "3D000" => $"Esa base de datos no existe en el servidor. ({original})",

            // El servidor está arrancando o recuperándose y todavía no acepta
            // conexiones: esperar y reintentar es lo único que hay que hacer.
            "57P03" => $"El servidor todavía no acepta conexiones. Inténtalo en unos segundos. ({original})",

            _ => original,
        };
    }

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
