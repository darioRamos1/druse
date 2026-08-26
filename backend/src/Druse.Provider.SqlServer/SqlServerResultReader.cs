using System.Data.Common;
using System.Runtime.CompilerServices;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.SqlServer;

/// <summary>
/// Lectura progresiva sobre un <see cref="DbDataReader"/> de SqlClient.
///
/// Mantiene abiertos el comando y el lector mientras se consume, así que hay que
/// liberarlo siempre: de lo contrario la conexión quedaría ocupada por una
/// consulta que ya nadie está leyendo.
/// </summary>
internal sealed class SqlServerResultReader : IQueryResultReader
{
    private readonly DbCommand _command;
    private readonly DbDataReader _reader;
    private readonly string?[] _buffer;

    private SqlServerResultReader(
        DbCommand command,
        DbDataReader reader,
        IReadOnlyList<ResultColumn> columns)
    {
        _command = command;
        _reader = reader;
        Columns = columns;
        _buffer = new string?[columns.Count];
    }

    public IReadOnlyList<ResultColumn> Columns { get; }

    public static async Task<IQueryResultReader> OpenAsync(
        SqlServerSession session,
        QueryRequest request,
        CancellationToken cancellationToken)
    {
        var command = session.Connection.CreateCommand();
        command.CommandText = request.Sql;
        command.CommandTimeout = request.TimeoutSeconds;

        // Exportar lee por la misma conexión, así que con una transacción manual
        // abierta va dentro de ella: lo que se exporta es lo que el usuario ve,
        // incluidos sus cambios sin confirmar.
        ((DbCommand)command).Transaction = session.Transaction.Current;

        DbDataReader? reader = null;

        try
        {
            reader = await command.ExecuteReaderAsync(
                System.Data.CommandBehavior.SequentialAccess,
                cancellationToken);

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

            return new SqlServerResultReader(command, reader, columns);
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
            // produjo un error inesperado»: el usuario veía fallar el archivo
            // sin saber que el problema estaba en su SQL.
            throw new DatabaseOperationException(SqlServerErrorNormalizer.Normalize(exception));
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
                    : SqlServerValueFormatter.Format(_reader.GetValue(ordinal));
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
