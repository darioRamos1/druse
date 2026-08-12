using System.Data.Common;
using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using MySqlConnector;

namespace Druse.Provider.MySql;

/// <summary>
/// Ejecuta SQL de MySQL arbitrario.
///
/// Igual que en los demás proveedores: `DbCommand` y `DbDataReader`
/// directamente, sin Entity Framework y sin reescribir el SQL del usuario. El
/// límite de filas se aplica al leer, nunca añadiendo `LIMIT` (plan §5).
/// </summary>
public sealed class MySqlQueryExecutor : IQueryExecutor
{
    public DatabaseEngine Engine => DatabaseEngine.MySql;

    public async Task<QueryResult> ExecuteAsync(
        IDatabaseSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (session is not MySqlSession mysql)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor MySQL.",
                nameof(session));
        }

        var executionId = Guid.NewGuid();
        var stopwatch = Stopwatch.StartNew();
        var messages = new List<QueryMessage>();

        // Los avisos del servidor no viajan por el lector. MySqlConnector solo se
        // molesta en pedirlos —con SHOW WARNINGS— cuando hay alguien suscrito a
        // este evento, así que suscribirse es lo que hace que existan.
        void OnInfoMessage(object sender, MySqlInfoMessageEventArgs args)
        {
            foreach (var error in args.Errors)
            {
                messages.Add(new QueryMessage
                {
                    Text = error.Message,
                    Severity = MapSeverity(error.Level),
                });
            }
        }

        mysql.Connection.InfoMessage += OnInfoMessage;

        // El plazo se controla aquí y no con `CommandTimeout`.
        //
        // MySqlConnector agota el tiempo mandando `KILL QUERY` desde otra conexión,
        // pero **el servidor no siempre convierte esa interrupción en un error**:
        // `SELECT SLEEP(30)` interrumpido termina «bien» y devuelve una fila. La
        // consulta que el usuario dio por caducada se anunciaría entonces como
        // completada, que es la peor forma posible de fallar. Con un token propio
        // sí se sabe qué pasó: si venció el plazo es un fallo por tiempo, y si
        // canceló el usuario es una cancelación.
        using var deadline = request.TimeoutSeconds > 0
            ? new CancellationTokenSource(TimeSpan.FromSeconds(request.TimeoutSeconds))
            : new CancellationTokenSource();

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            deadline.Token);

        try
        {
            await using var command = mysql.Connection.CreateCommand();
            command.CommandText = request.Sql;
            // 0 es «sin límite»: el límite lo pone `deadline`.
            command.CommandTimeout = 0;

            await using var reader = await command.ExecuteReaderAsync(linked.Token);

            var (resultSets, rowsAffected) = await ReadAllAsync(reader, request.MaxRows, linked.Token);

            // Si el plazo venció durante la lectura, lo leído está incompleto
            // aunque el servidor no se haya quejado. Devolverlo como un resultado
            // correcto sería mentir sobre los datos, no solo sobre el estado.
            linked.Token.ThrowIfCancellationRequested();

            stopwatch.Stop();

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Succeeded,
                ResultSets = resultSets,
                Messages = messages,
                RowsAffected = rowsAffected,
                Duration = stopwatch.Elapsed,
            };
        }
        // Cancelar en MySQL es un `KILL QUERY` desde otra conexión, así que el corte
        // llega unas veces como cancelación y otras como error del servidor. Lo que
        // distingue una cancelación de un fallo por tiempo no es el tipo de la
        // excepción, sino cuál de los dos tokens se disparó.
        catch (Exception exception)
            when (exception is OperationCanceledException or MySqlException
                  && cancellationToken.IsCancellationRequested)
        {
            stopwatch.Stop();

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Canceled,
                ResultSets = [],
                Messages = messages,
                Duration = stopwatch.Elapsed,
            };
        }
        catch (Exception exception)
            when (exception is OperationCanceledException or MySqlException
                  && deadline.IsCancellationRequested)
        {
            stopwatch.Stop();

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Failed,
                ResultSets = [],
                Messages = messages,
                Duration = stopwatch.Elapsed,
                Error = new QueryError
                {
                    Message = $"La consulta superó el tiempo de espera de {request.TimeoutSeconds} s y se detuvo.",
                },
            };
        }
        catch (Exception exception)
        {
            stopwatch.Stop();

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Failed,
                ResultSets = [],
                Messages = messages,
                Duration = stopwatch.Elapsed,
                Error = MySqlErrorNormalizer.Normalize(exception),
            };
        }
        finally
        {
            mysql.Connection.InfoMessage -= OnInfoMessage;
        }
    }

    private static async Task<(List<ResultSet> ResultSets, long? RowsAffected)> ReadAllAsync(
        DbDataReader reader,
        int maxRows,
        CancellationToken cancellationToken)
    {
        var resultSets = new List<ResultSet>();
        long? rowsAffected = null;

        do
        {
            if (reader.FieldCount == 0)
            {
                if (reader.RecordsAffected >= 0)
                {
                    rowsAffected = reader.RecordsAffected;
                }

                continue;
            }

            resultSets.Add(await ReadResultSetAsync(reader, maxRows, cancellationToken));
        }
        while (await reader.NextResultAsync(cancellationToken));

        return (resultSets, rowsAffected);
    }

    private static async Task<ResultSet> ReadResultSetAsync(
        DbDataReader reader,
        int maxRows,
        CancellationToken cancellationToken)
    {
        var columns = new List<ResultColumn>(reader.FieldCount);

        for (var ordinal = 0; ordinal < reader.FieldCount; ordinal++)
        {
            columns.Add(new ResultColumn
            {
                Name = reader.GetName(ordinal),
                DataType = reader.GetDataTypeName(ordinal),
                ClrType = reader.GetFieldType(ordinal).Name,
                Ordinal = ordinal,
            });
        }

        var rows = new List<IReadOnlyList<string?>>();
        var truncated = false;

        while (await reader.ReadAsync(cancellationToken))
        {
            if (rows.Count >= maxRows)
            {
                truncated = true;
                break;
            }

            var values = new string?[reader.FieldCount];

            for (var ordinal = 0; ordinal < reader.FieldCount; ordinal++)
            {
                values[ordinal] = await reader.IsDBNullAsync(ordinal, cancellationToken)
                    ? null
                    : MySqlValueFormatter.Format(reader.GetValue(ordinal));
            }

            rows.Add(values);
        }

        return new ResultSet
        {
            Columns = columns,
            Rows = rows,
            Truncated = truncated,
        };
    }

    /// <inheritdoc />
    public Task<IQueryResultReader> OpenReaderAsync(
        IDatabaseSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (session is not MySqlSession mysql)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor MySQL.",
                nameof(session));
        }

        return MySqlResultReader.OpenAsync(mysql, request, cancellationToken);
    }

    /// <summary>
    /// Traduce la severidad que declara el propio servidor.
    ///
    /// `SHOW WARNINGS` clasifica cada línea como Note, Warning o Error. Ascender
    /// una nota —«la tabla ya existía»— a advertencia sería ruido.
    /// </summary>
    private static QueryMessageSeverity MapSeverity(string level) => level switch
    {
        "Error" => QueryMessageSeverity.Error,
        "Warning" => QueryMessageSeverity.Warning,
        _ => QueryMessageSeverity.Info,
    };
}
