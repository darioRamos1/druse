using System.Globalization;
using Druse.Domain;
using Oracle.ManagedDataAccess.Client;

namespace Druse.Provider.Oracle;

/// <summary>
/// Convierte excepciones de ODP.NET en <see cref="QueryError"/>.
///
/// Dos motivos para hacerlo aquí y no dejar subir la excepción:
/// 1. El resto del sistema no debe conocer los tipos de ODP.NET.
/// 2. Los mensajes del driver pueden incluir la cadena de conexión, y con ella la
///    contraseña. Lo que sale de aquí ya está saneado (plan §12).
/// </summary>
internal static class OracleErrorNormalizer
{
    public static QueryError Normalize(Exception exception) => exception switch
    {
        OracleException oracle => new QueryError
        {
            Message = Text(oracle),
            // El número de `ORA-00942`, sin el prefijo ni los ceros: es lo que se
            // busca en la documentación y lo mismo que transportan SQL Server y
            // MySQL. El prefijo se conserva dentro del mensaje, que es donde el
            // usuario lo reconoce.
            Code = $"ORA-{oracle.Number.ToString("00000", CultureInfo.InvariantCulture)}",
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
    /// El texto del error, sin la cadena de conexión que a veces cuelga detrás.
    ///
    /// Cuando el fallo es de red, ODP.NET añade al mensaje el descriptor con el
    /// que intentó conectar. Ese descriptor no lleva contraseña —va en su propio
    /// campo de la cadena— pero sí el host, el puerto y el servicio, y es ruido
    /// para quien solo necesita leer que el servidor no responde.
    ///
    /// Se corta por el salto de línea porque Oracle escribe el detalle debajo:
    /// la primera línea es el `ORA-…` y lo que sigue es el desglose.
    /// </summary>
    private static string Text(OracleException exception)
    {
        var message = exception.Message;
        var salto = message.IndexOfAny(['\r', '\n']);

        return salto > 0 ? message[..salto].TrimEnd() : message;
    }
}
