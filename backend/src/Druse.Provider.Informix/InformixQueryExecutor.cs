using System.Data.Common;
using System.Diagnostics;
using Druse.Database.Abstractions;
using Druse.Domain;
using IBM.Data.Db2;

namespace Druse.Provider.Informix;

/// <summary>
/// Ejecuta SQL de Informix arbitrario.
///
/// Igual que en los demás proveedores: `DbCommand` y `DbDataReader`
/// directamente, sin Entity Framework y sin reescribir el SQL del usuario. El
/// límite de filas se aplica al leer, nunca añadiendo `FIRST n` (plan §5).
/// </summary>
public sealed class InformixQueryExecutor : IQueryExecutor
{
    /// <summary>
    /// El motor al que sirve esta instancia.
    ///
    /// Hay una por transporte —DRDA y SQLI— porque el contrato exige que el
    /// ejecutor y el catálogo declaren el mismo motor que su proveedor. Lo que
    /// hacen es idéntico: es el mismo Informix.
    /// </summary>
    public InformixQueryExecutor(DatabaseEngine engine = DatabaseEngine.Informix) =>
        Engine = engine;

    public DatabaseEngine Engine { get; }

    public async Task<QueryResult> ExecuteAsync(
        IDatabaseSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(request);

        if (session is not InformixSession informix)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor Informix.",
                nameof(session));
        }

        var executionId = Guid.NewGuid();
        var stopwatch = Stopwatch.StartNew();
        var messages = new List<QueryMessage>();

        // Los avisos del servidor no viajan por el lector: llegan por este evento.
        void OnInfoMessage(object sender, DB2InfoMessageEventArgs args)
        {
            foreach (DB2Error error in args.Errors)
            {
                messages.Add(new QueryMessage
                {
                    Text = error.Message,
                    // El proveedor de IBM no clasifica la severidad como hace
                    // MySQL: todo lo que llega por aquí es informativo por
                    // definición, porque un error de verdad viene como excepción.
                    Severity = QueryMessageSeverity.Info,
                });
            }
        }

        // Los mensajes informativos del servidor solo llegan por DRDA: es un
        // evento del driver de IBM, y el puente JDBC no tiene equivalente —allí
        // los avisos se preguntan al terminar, que es otra conversación—. Sin
        // esto, la sección «Mensajes» queda vacía en SQLI; con un `as`, el resto
        // sigue funcionando igual en los dos.
        var conDrda = informix.Connection as DB2Connection;

        if (conDrda is not null)
        {
            conDrda.InfoMessage += OnInfoMessage;
        }

        // El plazo se controla aquí y no con `CommandTimeout`, por lo mismo que en
        // MySQL: así se distingue quién cortó la consulta. Si venció el reloj es un
        // fallo por tiempo; si canceló el usuario, una cancelación. Dejarlo en
        // manos del driver mezcla los dos casos en la misma excepción.
        using var deadline = request.TimeoutSeconds > 0
            ? new CancellationTokenSource(TimeSpan.FromSeconds(request.TimeoutSeconds))
            : new CancellationTokenSource();

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            deadline.Token);

        try
        {
            await using var command = informix.Connection.CreateCommand();
            command.CommandText = request.Sql;
            // 0 es «sin límite»: el límite lo pone `deadline`.
            command.CommandTimeout = 0;

            // Si el usuario abrió una transacción manual, esta consulta entra en
            // ella. Sin esto, los botones de confirmar y deshacer no gobernarían
            // nada: cada consulta iría por su cuenta en autocommit.
            // El comando concreto tipa `Transaction` con la clase del driver; se
            // asigna por el tipo base, que es lo mismo para los cuatro motores.
            ((DbCommand)command).Transaction = informix.Transaction.Current;

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
        // Cancelar corta la conexión desde fuera, así que el corte llega unas veces
        // como cancelación y otras como error del servidor. Lo que distingue una
        // cancelación de un fallo por tiempo no es el tipo de la excepción, sino
        // cuál de los dos tokens se disparó.
        catch (Exception exception)
            when (exception is OperationCanceledException or DB2Exception
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
            when (exception is OperationCanceledException or DB2Exception
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
                Error = InformixErrorNormalizer.Normalize(exception),
            };
        }
        finally
        {
            if (conDrda is not null)
            {
                conDrda.InfoMessage -= OnInfoMessage;
            }
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

            // El tope es del lote entero, no de cada resultado: una pulsación
            // de «Ejecutar» con diez `SELECT` traía diez veces el límite a la
            // memoria del proceso y del navegador. Cuando se agota, los
            // siguientes llegan vacíos y marcados como recortados, que es la
            // verdad: hay más y no se trajeron.
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
                    : InformixValueFormatter.Format(reader.GetValue(ordinal));
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

        if (session is not InformixSession informix)
        {
            throw new ArgumentException(
                "La sesión no pertenece al proveedor Informix.",
                nameof(session));
        }

        return InformixResultReader.OpenAsync(informix, request, cancellationToken);
    }
}
