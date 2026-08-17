using System.Globalization;
using Druse.Domain;
using IBM.Data.Db2;

namespace Druse.Provider.Informix;

/// <summary>
/// Convierte excepciones del proveedor de IBM en <see cref="QueryError"/>.
///
/// Dos motivos para hacerlo aquí y no dejar subir la excepción:
/// 1. El resto del sistema no debe conocer los tipos de IBM.Data.Db2.
/// 2. Los mensajes del driver pueden incluir la cadena de conexión, y con ella la
///    contraseña. Lo que sale de aquí ya está saneado (plan §12).
/// </summary>
internal static class InformixErrorNormalizer
{
    public static QueryError Normalize(Exception exception) => exception switch
    {
        DB2Exception db2 => FromDb2(db2),

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
    /// Traduce un error del servidor.
    ///
    /// Informix numera sus errores en negativo (-201 es un error de sintaxis) y
    /// el proveedor los transporta junto al SQLSTATE del estándar. Se conserva el
    /// número tal cual, incluido el signo, porque es lo que aparece en los
    /// mensajes del servidor y lo que se busca en la documentación de IBM.
    /// </summary>
    private static QueryError FromDb2(DB2Exception exception)
    {
        var code = exception.Errors.Count > 0
            ? exception.Errors[0].NativeError
            : exception.ErrorCode;

        return new QueryError
        {
            Message = Explain(code) ?? exception.Message,
            Code = code.ToString(CultureInfo.InvariantCulture),
        };
    }

    /// <summary>
    /// Explica los fallos que un usuario puede arreglar por su cuenta.
    ///
    /// Solo se reescriben los que el mensaje original cuenta mal. El resto pasa
    /// tal cual: el servidor suele explicarse mejor de lo que lo haría una
    /// traducción, y sustituirlo escondería información al que sabe leerla.
    ///
    /// El caso de DRDA merece mención aparte: contra un Informix sin ese
    /// escuchador configurado, el error que llega es de conexión rechazada, y sin
    /// esta pista el usuario buscaría el fallo en su contraseña.
    /// </summary>
    private static string? Explain(int code) => code switch
    {
        -951 => "El servidor rechazó la conexión. Comprueba que Informix tenga un " +
                "escuchador DRDA activo en ese puerto: Druse se conecta por DRDA, " +
                "no por el protocolo nativo.",
        -908 => "El servidor no admite más conexiones en este momento.",
        -329 => "No se encontró la base de datos indicada en ese servidor.",
        -387 => "El usuario no tiene permiso para conectarse a esta base de datos.",
        _ => null,
    };
}
