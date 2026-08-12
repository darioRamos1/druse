using System.Data.Common;
using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Npgsql;

namespace Druse.Provider.PostgreSql;

/// <summary>
/// Ejecuta SQL arbitrario contra PostgreSQL.
///
/// Se apoya en <c>DbCommand</c> y <c>DbDataReader</c> directamente: el texto del
/// usuario llega al servidor tal y como lo escribió. No se añade <c>LIMIT</c> ni
/// se reescribe nada; el límite de filas se aplica al leer, no al SQL, porque
/// modificar la consulta cambiaría su significado y sus planes de ejecución
/// (plan §5).
/// </summary>
public sealed class PostgreSqlQueryExecutor : IQueryExecutor
{
    public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

    public async Task<QueryResult> ExecuteAsync(
        IDatabaseSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (session is not PostgreSqlSession postgres)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor PostgreSQL.",
                nameof(session));
        }

        var executionId = Guid.NewGuid();
        var stopwatch = Stopwatch.StartNew();
        var messages = new List<QueryMessage>();

        // Los avisos del servidor (RAISE NOTICE y similares) llegan por evento, no
        // por el lector. Sin esto se perderían.
        void OnNotice(object? sender, NpgsqlNoticeEventArgs args) =>
            messages.Add(new QueryMessage
            {
                Text = args.Notice.MessageText,
                Severity = MapSeverity(args.Notice.Severity),
            });

        postgres.Connection.Notice += OnNotice;

        try
        {
            await using var command = postgres.Connection.CreateCommand();
            command.CommandText = request.Sql;
            command.CommandTimeout = request.TimeoutSeconds;

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
                Error = PostgreSqlErrorNormalizer.Normalize(exception),
            };
        }
        finally
        {
            postgres.Connection.Notice -= OnNotice;
        }
    }

    /// <summary>
    /// Lee todos los conjuntos de resultados que devuelva el lote.
    ///
    /// Una sola pulsación de «Ejecutar» puede contener varias instrucciones, y
    /// cada una puede producir filas, un recuento de afectadas, o nada.
    /// </summary>
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
                // Instrucción sin filas: INSERT, UPDATE, DELETE o DDL.
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
                // Se deja de leer, pero se avisa: una tabla recortada en silencio
                // lleva a conclusiones equivocadas.
                truncated = true;
                break;
            }

            var values = new string?[reader.FieldCount];

            for (var ordinal = 0; ordinal < reader.FieldCount; ordinal++)
            {
                values[ordinal] = await reader.IsDBNullAsync(ordinal, cancellationToken)
                    ? null
                    : PostgreSqlValueFormatter.Format(reader.GetValue(ordinal));
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

        if (session is not PostgreSqlSession postgres)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor PostgreSQL.",
                nameof(session));
        }

        return PostgreSqlResultReader.OpenAsync(postgres, request, cancellationToken);
    }

    private static QueryMessageSeverity MapSeverity(string severity) =>
        severity.ToUpperInvariant() switch
        {
            "WARNING" => QueryMessageSeverity.Warning,
            "ERROR" or "FATAL" or "PANIC" => QueryMessageSeverity.Error,
            _ => QueryMessageSeverity.Info,
        };
}
