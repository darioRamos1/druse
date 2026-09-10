using System.Data;
using Druse.Domain;
using Oracle.ManagedDataAccess.Client;

namespace Druse.Provider.Oracle;

/// <summary>
/// Los mensajes que el servidor escribe con `DBMS_OUTPUT`.
///
/// Es el equivalente en Oracle al `RAISE NOTICE` de PostgreSQL y al `PRINT` de
/// SQL Server, y funciona distinto de los dos: **el servidor no los manda, los
/// guarda**. Se acumulan en un búfer de la sesión y hay que ir a buscarlos
/// después de ejecutar; si nadie los recoge, se quedan ahí hasta que el búfer se
/// llena y el siguiente `PUT_LINE` falla.
///
/// Además hay que pedirlos: sin `DBMS_OUTPUT.ENABLE`, el búfer no existe y todo
/// lo que se escriba en él se descarta en silencio. Por eso se activa al abrir
/// la sesión y no al ejecutar: es una propiedad de la conexión.
/// </summary>
internal static class OracleServerOutput
{
    /// <summary>
    /// Cuánto se trae de una vez. Son 32 KB, el máximo de un `VARCHAR2` de
    /// PL/SQL: lo que pase de ahí se queda para la siguiente ejecución en lugar
    /// de perderse.
    /// </summary>
    private const int BufferSize = 32767;

    /// <summary>
    /// Abre el búfer de la sesión.
    ///
    /// `NULL` significa sin límite de tamaño, que es lo que se quiere en un
    /// cliente: el límite pequeño de serie —20 000 caracteres— hace fallar el
    /// procedimiento que escribe de más, y ese fallo no es del usuario.
    ///
    /// Si no se puede, no pasa nada grave: se pierden los mensajes, no la
    /// sesión. Por eso no propaga.
    /// </summary>
    public static async Task EnableAsync(
        OracleConnection connection,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var command = connection.CreateCommand();

            command.CommandText = "BEGIN DBMS_OUTPUT.ENABLE(NULL); END;";

            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Sin `DBMS_OUTPUT` se ejecuta igual; lo único que falta son los
            // mensajes informativos.
        }
    }

    /// <summary>
    /// Vacía el búfer y devuelve lo que había, una línea por mensaje.
    ///
    /// Se hace en **un solo viaje**: el bucle vive dentro del bloque PL/SQL. La
    /// forma evidente —llamar a `GET_LINE` desde el cliente hasta que diga que no
    /// hay más— cuesta un viaje por línea, y un procedimiento hablador dejaría la
    /// consulta esperando más tiempo del que tardó en ejecutarse.
    /// </summary>
    public static async Task<IReadOnlyList<QueryMessage>> DrainAsync(
        OracleConnection connection,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var command = connection.CreateCommand();

            command.CommandText = """
                DECLARE
                  linea  VARCHAR2(32767);
                  estado INTEGER;
                  todo   VARCHAR2(32767) := '';
                BEGIN
                  LOOP
                    DBMS_OUTPUT.GET_LINE(linea, estado);
                    EXIT WHEN estado != 0;
                    EXIT WHEN LENGTHB(todo) + LENGTHB(NVL(linea, '')) + 1 > 32000;
                    todo := todo || NVL(linea, '') || CHR(10);
                  END LOOP;
                  :salida := todo;
                END;
                """;

            var salida = new OracleParameter("salida", OracleDbType.Varchar2, BufferSize)
            {
                Direction = ParameterDirection.Output,
            };

            command.Parameters.Add(salida);

            await command.ExecuteNonQueryAsync(cancellationToken);

            var text = salida.Value?.ToString();

            if (string.IsNullOrEmpty(text) || text == "null")
            {
                return [];
            }

            return
            [
                .. text
                    .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                    .Select(line => new QueryMessage
                    {
                        Text = line.TrimEnd('\r'),
                        Severity = QueryMessageSeverity.Info,
                    }),
            ];
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Recoger los mensajes nunca puede tumbar una consulta que sí
            // funcionó.
            return [];
        }
    }
}
