using System.Data.Common;
using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Oracle.ManagedDataAccess.Client;

namespace Druse.Provider.Oracle;

/// <summary>
/// Ejecuta SQL de Oracle arbitrario.
///
/// Igual que en los demás proveedores: `DbCommand` y `DbDataReader` directamente,
/// sin Entity Framework y sin reescribir el SQL del usuario. El límite de filas
/// se aplica al leer, nunca añadiendo `FETCH FIRST` (plan §5).
///
/// Lo único que se toca del texto es el punto y coma final, que este motor no
/// acepta; el porqué está en <see cref="OracleStatement"/>.
/// </summary>
public sealed class OracleQueryExecutor : IQueryExecutor
{
    public DatabaseEngine Engine => DatabaseEngine.Oracle;

    public async Task<QueryResult> ExecuteAsync(
        IDatabaseSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (session is not OracleSession oracle)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor Oracle.",
                nameof(session));
        }

        var executionId = Guid.NewGuid();
        var stopwatch = Stopwatch.StartNew();

        // El plazo se controla aquí y no con `CommandTimeout`, por lo mismo que en
        // MySQL: hace falta saber **cuál** de los dos motivos cortó la consulta,
        // y el tipo de la excepción no lo distingue.
        using var deadline = request.TimeoutSeconds > 0
            ? new CancellationTokenSource(TimeSpan.FromSeconds(request.TimeoutSeconds))
            : new CancellationTokenSource();

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            deadline.Token);

        try
        {
            await using var command = oracle.Connection.CreateCommand();
            command.CommandText = OracleStatement.Prepare(request.Sql);
            command.CommandTimeout = 0;

            // Si el usuario abrió una transacción manual, esta consulta entra en
            // ella. En Oracle **toda** instrucción abre transacción de todas
            // formas —no hay autocommit por debajo— así que sin esto los botones
            // de confirmar y deshacer gobernarían una transacción distinta de la
            // que el usuario cree estar viendo.
            ((DbCommand)command).Transaction = oracle.Transaction.Current;

            // ODP.NET no atiende el token mientras espera al servidor: hay que
            // decirle que cancele el comando, que es lo que manda el aviso por la
            // conexión.
            await using var registration = linked.Token.Register(Cancelar, command);

            await using var reader = await command.ExecuteReaderAsync(linked.Token);

            var (resultSets, rowsAffected) = await ReadAllAsync(
                (OracleDataReader)reader,
                request.MaxRows,
                linked.Token);

            // Si el plazo venció durante la lectura, lo leído está incompleto
            // aunque el servidor no se haya quejado.
            linked.Token.ThrowIfCancellationRequested();

            var messages = await OracleServerOutput.DrainAsync(oracle.Connection, cancellationToken);

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
        // Cancelar en Oracle llega de varias formas: como cancelación, como
        // `ORA-01013: user requested cancel`, y a veces envuelta en otra cosa por
        // el driver. **El tipo de la excepción no dice nada**; lo que distingue
        // una cancelación de un fallo por tiempo es cuál de los dos tokens se
        // disparó, así que se mira eso y solo eso.
        catch (Exception) when (cancellationToken.IsCancellationRequested)
        {
            stopwatch.Stop();

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Canceled,
                ResultSets = [],
                Messages = [],
                Duration = stopwatch.Elapsed,
            };
        }
        catch (Exception) when (deadline.IsCancellationRequested)
        {
            stopwatch.Stop();

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Failed,
                ResultSets = [],
                Messages = [],
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

            // Lo que el procedimiento alcanzara a escribir antes de fallar sigue
            // siendo información útil sobre por qué falló.
            var messages = await OracleServerOutput.DrainAsync(oracle.Connection, CancellationToken.None);

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Failed,
                ResultSets = [],
                Messages = messages,
                Duration = stopwatch.Elapsed,
                Error = OracleErrorNormalizer.Normalize(exception),
            };
        }
    }

    /// <summary>
    /// Le pide al driver que corte lo que está esperando.
    ///
    /// Va aparte porque cancelar puede fallar por su cuenta —si el comando ya
    /// terminó, por ejemplo— y esa excepción saltaría dentro del registro del
    /// token, donde no la recogería nadie.
    /// </summary>
    private static void Cancelar(object? state)
    {
        try
        {
            (state as OracleCommand)?.Cancel();
        }
        catch (Exception)
        {
            // Ya había terminado, o la conexión se fue. No hay nada que hacer.
        }
    }

    private static async Task<(List<ResultSet> ResultSets, long? RowsAffected)> ReadAllAsync(
        OracleDataReader reader,
        int maxRows,
        CancellationToken cancellationToken)
    {
        var resultSets = new List<ResultSet>();
        long? rowsAffected = null;

        // Lo que queda del tope para todo el lote.
        var remaining = maxRows;

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

            // El tope es del lote entero, no de cada resultado.
            var set = await ReadResultSetAsync(reader, remaining, cancellationToken);

            remaining -= set.Rows.Count;
            resultSets.Add(set);
        }
        while (await reader.NextResultAsync(cancellationToken));

        return (resultSets, rowsAffected);
    }

    private static async Task<ResultSet> ReadResultSetAsync(
        OracleDataReader reader,
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
                    // `GetOracleValue` y no `GetValue`: un `NUMBER` admite 38
                    // dígitos y no cabe en `decimal`. Convertirlo redondearía en
                    // silencio, o reventaría con un desbordamiento en mitad del
                    // resultado.
                    : OracleValueFormatter.Format(reader.GetOracleValue(ordinal));
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

        if (session is not OracleSession oracle)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor Oracle.",
                nameof(session));
        }

        return OracleResultReader.OpenAsync(oracle, request, cancellationToken);
    }
}
