using System.Data.Common;
using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>Lectura de valores originales para cálculos y cruces entre motores.</summary>
public interface ITypedQueryResultReader : IQueryResultReader
{
    Task<TypedQueryResult> ReadTypedAsync(int maxRows, CancellationToken cancellationToken);
}

public sealed record TypedQueryResult(
    IReadOnlyList<ResultColumn> Columns,
    IReadOnlyList<IReadOnlyList<object?>> Rows,
    bool Truncated)
{
    private const long MaxBufferedBytes = 32L * 1024 * 1024;

    public static async Task<TypedQueryResult> ReadAsync(
        DbDataReader reader,
        IReadOnlyList<ResultColumn> columns,
        int maxRows,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(reader);
        ArgumentNullException.ThrowIfNull(columns);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxRows);

        if (columns.Count == 0)
        {
            throw new InvalidOperationException("La consulta de BI debe devolver un conjunto de datos.");
        }

        // SQL Server devuelve DATE como DateTime. El cruce necesita la misma
        // fecha sin hora que se usaría para un DATE de PostgreSQL.
        var typedColumns = columns.Select(column =>
            column.DataType.Equals("date", StringComparison.OrdinalIgnoreCase)
                ? column with { ClrType = nameof(DateOnly) }
                : column).ToArray();
        var rows = new List<IReadOnlyList<object?>>();
        var availableBytes = MaxBufferedBytes;
        while (await reader.ReadAsync(cancellationToken))
        {
            // Se limita lo que conserva Druse. El proveedor puede materializar
            // una celda por su cuenta antes de entregarla.
            availableBytes -= 32L + 8L * typedColumns.Length;
            if (rows.Count == maxRows || availableBytes < 0)
            {
                return new TypedQueryResult(typedColumns, rows, Truncated: true);
            }

            var row = new object?[typedColumns.Length];
            for (var ordinal = 0; ordinal < row.Length; ordinal++)
            {
                if (!await reader.IsDBNullAsync(ordinal, cancellationToken))
                {
                    var value = reader.GetValue(ordinal);
                    availableBytes -= value switch
                    {
                        string text => 24L + 2L * text.Length,
                        byte[] bytes => 24L + bytes.Length,
                        Array array => 24L + 16L * array.LongLength,
                        _ => 32L,
                    };
                    if (availableBytes < 0)
                    {
                        return new TypedQueryResult(typedColumns, rows, Truncated: true);
                    }

                    row[ordinal] = value is DateTime date && typedColumns[ordinal].ClrType == nameof(DateOnly)
                        ? DateOnly.FromDateTime(date)
                        : value;
                }
            }

            rows.Add(row);
        }

        if (await reader.NextResultAsync(cancellationToken))
        {
            throw new InvalidOperationException("Cada fuente de BI debe devolver un solo conjunto de datos.");
        }

        return new TypedQueryResult(typedColumns, rows, Truncated: false);
    }
}
