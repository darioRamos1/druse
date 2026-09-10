using System.Data.Common;
using System.Runtime.CompilerServices;
using Druse.Database.Abstractions;
using Druse.Domain;
using Oracle.ManagedDataAccess.Client;

namespace Druse.Provider.Oracle;

/// <summary>
/// Lectura progresiva sobre un <see cref="OracleDataReader"/>.
///
/// Mantiene abiertos el comando y el lector mientras se consume, así que hay que
/// liberarlo siempre: de lo contrario la conexión quedaría ocupada por una
/// consulta que ya nadie está leyendo.
/// </summary>
internal sealed class OracleResultReader : IQueryResultReader
{
    private readonly DbCommand _command;
    private readonly OracleDataReader _reader;
    private readonly string?[] _buffer;

    private OracleResultReader(
        DbCommand command,
        OracleDataReader reader,
        IReadOnlyList<ResultColumn> columns)
    {
        _command = command;
        _reader = reader;
        Columns = columns;
        _buffer = new string?[columns.Count];
    }

    public IReadOnlyList<ResultColumn> Columns { get; }

    public static async Task<IQueryResultReader> OpenAsync(
        OracleSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        var command = session.Connection.CreateCommand();
        command.CommandText = OracleStatement.Prepare(request.Sql);
        command.CommandTimeout = request.TimeoutSeconds;

        // Cuántas filas trae el driver de una vez. De serie son 64 KB, que en una
        // exportación de un millón de filas son muchos viajes; con 1 MB se
        // reducen a la decimosexta parte sin que la memoria se note.
        command.FetchSize = 1024 * 1024;

        // Exportar lee por la misma conexión, así que con una transacción manual
        // abierta va dentro de ella: lo que se exporta es lo que el usuario ve,
        // incluidos sus cambios sin confirmar.
        ((DbCommand)command).Transaction = session.Transaction.Current;

        OracleDataReader? reader = null;

        try
        {
            // Sin `SequentialAccess`, al contrario que en los demás proveedores:
            // aquí los valores se leen con `GetOracleValue`, y un `CLOB` o un
            // `BLOB` llegan como objeto que se abre por su cuenta. En modo
            // secuencial ese objeto deja de poder leerse en cuanto se avanza.
            reader = (OracleDataReader)await command.ExecuteReaderAsync(cancellationToken);

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

            return new OracleResultReader(command, reader, columns);
        }
        catch (OperationCanceledException)
        {
            if (reader is not null)
            {
                await reader.DisposeAsync();
            }

            await command.DisposeAsync();
            throw;
        }
        catch (Exception exception)
        {
            if (reader is not null)
            {
                await reader.DisposeAsync();
            }

            await command.DisposeAsync();

            // Se cuenta lo que dijo el motor, igual que al abrir la conexión.
            // Por aquí pasa la exportación, y sin esto su error salía como «se
            // produjo un error inesperado».
            throw new DatabaseOperationException(OracleErrorNormalizer.Normalize(exception));
        }
    }

    public async IAsyncEnumerable<IReadOnlyList<string?>> ReadRowsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        while (await _reader.ReadAsync(cancellationToken))
        {
            for (var ordinal = 0; ordinal < _buffer.Length; ordinal++)
            {
                _buffer[ordinal] = await _reader.IsDBNullAsync(ordinal, cancellationToken)
                    ? null
                    : OracleValueFormatter.Format(_reader.GetOracleValue(ordinal));
            }

            yield return _buffer;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _reader.DisposeAsync();
        await _command.DisposeAsync();
    }
}
