using System.Data.Common;
using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.Sqlite;

namespace Druse.Provider.Sqlite;

/// <summary>
/// Ejecuta SQL de SQLite arbitrario.
///
/// Igual que en los demás proveedores: `DbCommand` y `DbDataReader` directamente,
/// sin Entity Framework y sin reescribir el SQL del usuario. El límite de filas
/// se aplica al leer, nunca añadiendo `LIMIT` (plan §5).
///
/// Aquí sí se admite un lote con varias instrucciones separadas por punto y coma
/// —al contrario que en Oracle—: el driver las recorre y cada una devuelve su
/// propio resultado.
/// </summary>
public sealed class SqliteQueryExecutor : IQueryExecutor
{
    public DatabaseEngine Engine => DatabaseEngine.Sqlite;

    public async Task<QueryResult> ExecuteAsync(
        IDatabaseSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (session is not SqliteSession sqlite)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor SQLite.",
                nameof(session));
        }

        var executionId = Guid.NewGuid();
        var stopwatch = Stopwatch.StartNew();

        // El plazo se controla aquí y no con `CommandTimeout`, por lo mismo que en
        // los demás: hace falta saber **cuál** de los dos motivos cortó la
        // consulta, y el tipo de la excepción no lo distingue.
        //
        // En SQLite `CommandTimeout` además significa otra cosa: es lo que se
        // espera a que **otro** suelte la base, no lo que se le da a la consulta
        // para terminar.
        using var deadline = request.TimeoutSeconds > 0
            ? new CancellationTokenSource(TimeSpan.FromSeconds(request.TimeoutSeconds))
            : new CancellationTokenSource();

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            deadline.Token);

        try
        {
            await using var command = sqlite.Connection.CreateCommand();
            command.CommandText = request.Sql;

            // Si el usuario abrió una transacción manual, esta consulta entra en
            // ella. Sin esto, los botones de confirmar y deshacer no gobernarían
            // nada.
            command.Transaction = (SqliteTransaction?)sqlite.Transaction.Current;

            // Lo que corta una consulta en marcha es `sqlite3_interrupt`, y hay
            // que llamarlo **sobre la conexión**. Sin esto, el token solo se
            // miraría entre una fila y la siguiente: una consulta que tarda en
            // devolver la primera —un recuento, una ordenación, un recorrido
            // entero— llega hasta el final aunque nadie la espere ya.
            await using var registration = linked.Token.Register(Interrumpir, sqlite.Connection);

            await using var reader = await command.ExecuteReaderAsync(linked.Token);

            var (resultSets, rowsAffected) = await ReadAllAsync(
                reader,
                request.MaxRows,
                linked.Token);

            // Si el plazo venció durante la lectura, lo leído está incompleto
            // aunque el motor no se haya quejado.
            linked.Token.ThrowIfCancellationRequested();

            stopwatch.Stop();

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Succeeded,
                ResultSets = resultSets,
                Messages = [],
                RowsAffected = rowsAffected,
                Duration = stopwatch.Elapsed,
            };
        }
        // Interrumpir llega como `SQLITE_INTERRUPT`, que el driver envuelve en su
        // propia excepción. El tipo no distingue una cancelación de un plazo
        // vencido; lo hace cuál de los dos tokens se disparó.
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

            return new QueryResult
            {
                ExecutionId = executionId,
                State = QueryExecutionState.Failed,
                ResultSets = [],
                Messages = [],
                Duration = stopwatch.Elapsed,
                Error = SqliteErrorNormalizer.Normalize(exception),
            };
        }
    }

    /// <summary>
    /// Le pide al motor que corte lo que está haciendo, de verdad.
    ///
    /// **`SqliteCommand.Cancel()` no hace nada**: el driver lo declara y lo
    /// cumple, así que llamarlo dejaba la consulta corriendo hasta el final. Con
    /// un plazo de un segundo, una consulta pesada tardaba **285 segundos** en
    /// darse por vencida, y ninguna prueba lo veía porque las del contrato de
    /// SQLite se estaban saltando enteras.
    ///
    /// Lo que sí corta es `sqlite3_interrupt`, que es de la biblioteca nativa y
    /// va sobre la conexión, no sobre el comando. Deja la conexión utilizable: la
    /// instrucción en curso devuelve `SQLITE_INTERRUPT` y ahí se acaba.
    ///
    /// Va aparte porque puede fallar por su cuenta —si el comando ya terminó— y
    /// esa excepción saltaría dentro del registro del token, donde no la
    /// recogería nadie.
    /// </summary>
    private static void Interrumpir(object? state)
    {
        try
        {
            if (state is SqliteConnection { Handle: { } handle })
            {
                SQLitePCL.raw.sqlite3_interrupt(handle);
            }
        }
        catch (Exception)
        {
            // Ya había terminado. No hay nada que hacer.
        }
    }

    private static async Task<(List<ResultSet> ResultSets, long? RowsAffected)> ReadAllAsync(
        DbDataReader reader,
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

            var set = await ReadResultSetAsync(reader, remaining, cancellationToken);

            remaining -= set.Rows.Count;
            resultSets.Add(set);
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
                // En SQLite el tipo de una columna del resultado puede no
                // existir: una expresión no lo declara. Se dice así en vez de
                // dejarlo vacío, que en la cabecera se leería como un fallo.
                DataType = Declared(reader, ordinal),
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
                    : SqliteValueFormatter.Format(reader.GetValue(ordinal));
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

    /// <summary>
    /// El tipo declarado de una columna del resultado, o el que se le supone.
    ///
    /// `GetDataTypeName` devuelve el tipo con el que se declaró la columna en su
    /// tabla, y **vacío cuando el valor no viene de una tabla**: un `SELECT 1 + 1`
    /// no tiene tipo declarado en ninguna parte. En ese caso se dice el de la
    /// clase de almacenamiento, que es lo que el motor sí sabe.
    /// </summary>
    private static string Declared(DbDataReader reader, int ordinal)
    {
        var declared = reader.GetDataTypeName(ordinal);

        return string.IsNullOrEmpty(declared) ? reader.GetFieldType(ordinal).Name : declared;
    }

    /// <inheritdoc />
    public Task<IQueryResultReader> OpenReaderAsync(
        IDatabaseSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (session is not SqliteSession sqlite)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor SQLite.",
                nameof(session));
        }

        return SqliteResultReader.OpenAsync(sqlite, request, cancellationToken);
    }
}
