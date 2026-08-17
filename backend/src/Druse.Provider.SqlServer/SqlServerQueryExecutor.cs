using System.Data.Common;
using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.SqlClient;

namespace Druse.Provider.SqlServer;

/// <summary>
/// Ejecuta T-SQL arbitrario.
///
/// Igual que en PostgreSQL: `DbCommand` y `DbDataReader` directamente, sin
/// Entity Framework y sin reescribir el SQL del usuario. El límite de filas se
/// aplica al leer, nunca añadiendo `TOP` (plan §5).
/// </summary>
public sealed class SqlServerQueryExecutor : IQueryExecutor
{
    public DatabaseEngine Engine => DatabaseEngine.SqlServer;

    public async Task<QueryResult> ExecuteAsync(
        IDatabaseSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (session is not SqlServerSession sqlServer)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor SQL Server.",
                nameof(session));
        }

        var executionId = Guid.NewGuid();
        var stopwatch = Stopwatch.StartNew();
        var messages = new List<QueryMessage>();

        // PRINT y RAISERROR con severidad baja llegan por evento, no por el
        // lector. Sin esto se perderían, igual que los NOTICE de PostgreSQL.
        void OnInfoMessage(object sender, SqlInfoMessageEventArgs args)
        {
            foreach (SqlError error in args.Errors)
            {
                messages.Add(new QueryMessage
                {
                    Text = error.Message,
                    Severity = MapSeverity(error.Class),
                });
            }
        }

        sqlServer.Connection.InfoMessage += OnInfoMessage;

        try
        {
            await using var command = sqlServer.Connection.CreateCommand();
            command.CommandText = request.Sql;
            command.CommandTimeout = request.TimeoutSeconds;

            // Si el usuario abrió una transacción manual, esta consulta entra en
            // ella. Sin esto, los botones de confirmar y deshacer no gobernarían
            // nada: cada consulta iría por su cuenta en autocommit.
            // El comando concreto tipa `Transaction` con la clase del driver; se
            // asigna por el tipo base, que es lo mismo para los cuatro motores.
            ((DbCommand)command).Transaction = sqlServer.Transaction.Current;

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            var (resultSets, rowsAffected) = await ReadAllAsync(reader, request.MaxRows, cancellationToken);

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
        catch (OperationCanceledException)
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
        catch (SqlException exception) when (exception.Number == 0 && cancellationToken.IsCancellationRequested)
        {
            // Al cancelar, SqlClient a veces informa del corte como un error de
            // red en lugar de lanzar OperationCanceledException. Para el usuario
            // es una cancelación, no un fallo.
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
        {
            stopwatch.Stop();

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Failed,
                ResultSets = [],
                Messages = messages,
                Duration = stopwatch.Elapsed,
                Error = SqlServerErrorNormalizer.Normalize(exception),
            };
        }
        finally
        {
            sqlServer.Connection.InfoMessage -= OnInfoMessage;
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
                    rowsAffected = (rowsAffected ?? 0) + reader.RecordsAffected;
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
                    : SqlServerValueFormatter.Format(reader.GetValue(ordinal));
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

        if (session is not SqlServerSession sqlServer)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor SQL Server.",
                nameof(session));
        }

        return SqlServerResultReader.OpenAsync(sqlServer, request, cancellationToken);
    }

    /// <summary>
    /// Traduce la severidad de SQL Server.
    ///
    /// Clase 0-10 son mensajes informativos; a partir de 11 son errores. Los que
    /// llegan por InfoMessage nunca pasan de 10, pero el mapeo se deja completo
    /// por claridad.
    /// </summary>
    private static QueryMessageSeverity MapSeverity(byte severityClass) => severityClass switch
    {
        <= 9 => QueryMessageSeverity.Info,
        10 => QueryMessageSeverity.Warning,
        _ => QueryMessageSeverity.Error,
    };
}
