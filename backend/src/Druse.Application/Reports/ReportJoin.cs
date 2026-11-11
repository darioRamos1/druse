using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Reports;

public sealed record ReportJoinKey(string Left, string Right);

public enum ReportJoinKind
{
    Inner,
    Left,
}

public sealed record ReportJoinResult(
    IReadOnlyList<ResultColumn> Columns,
    IReadOnlyList<IReadOnlyList<object?>> Rows,
    int UnmatchedLeftRows,
    int UnmatchedRightRows);

/// <summary>Une dos resultados con cardinalidad uno a uno.</summary>
public static class ReportJoin
{
    private static readonly EqualityComparer<object[]> KeyComparer = EqualityComparer<object[]>.Create(
        (left, right) => left!.SequenceEqual(right!),
        key =>
        {
            var hash = new HashCode();
            foreach (var value in key)
            {
                hash.Add(value);
            }

            return hash.ToHashCode();
        });

    public static ReportJoinResult Combine(
        TypedQueryResult left,
        TypedQueryResult right,
        IReadOnlyList<ReportJoinKey> keys,
        ReportJoinKind kind,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        ArgumentNullException.ThrowIfNull(keys);
        cancellationToken.ThrowIfCancellationRequested();
        if (left.Truncated || right.Truncated)
        {
            throw new InvalidOperationException("Una fuente de BI quedó truncada. Reduce las filas o columnas de la consulta.");
        }

        if (keys.Count == 0)
        {
            throw new ArgumentException("Elige al menos una columna de unión.", nameof(keys));
        }

        if (!Enum.IsDefined(kind))
        {
            throw new ArgumentOutOfRangeException(nameof(kind));
        }

        var leftColumns = new int[keys.Count];
        var rightColumns = new int[keys.Count];
        for (var i = 0; i < keys.Count; i++)
        {
            var leftColumn = ResolveColumn(left.Columns, keys[i].Left);
            var rightColumn = ResolveColumn(right.Columns, keys[i].Right);
            if (leftColumn.ClrType != rightColumn.ClrType)
            {
                throw new InvalidOperationException(
                    $"Las columnas {leftColumn.Name} y {rightColumn.Name} tienen tipos distintos.");
            }

            if (leftColumn.ClrType is not (nameof(String) or nameof(DateOnly) or nameof(Boolean) or
                nameof(Byte) or nameof(Int16) or nameof(Int32) or nameof(Int64) or nameof(Decimal) or nameof(Guid)))
            {
                throw new InvalidOperationException($"El tipo de la columna {leftColumn.Name} requiere una conversión.");
            }

            leftColumns[i] = leftColumn.Ordinal;
            rightColumns[i] = rightColumn.Ordinal;
        }

        var rightIndex = new Dictionary<object[], IReadOnlyList<object?>>(KeyComparer);
        foreach (var row in right.Rows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var key = ReadKey(row, rightColumns);
            if (key is not null && !rightIndex.TryAdd(key, row))
            {
                throw new InvalidOperationException("La fuente derecha tiene claves de unión duplicadas.");
            }
        }

        var leftKeys = new HashSet<object[]>(KeyComparer);
        var rows = new List<IReadOnlyList<object?>>(left.Rows.Count);
        var emptyRight = new object?[right.Columns.Count];
        var unmatchedLeft = 0;
        var matchedRight = 0;
        foreach (var row in left.Rows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var key = ReadKey(row, leftColumns);
            if (key is not null && !leftKeys.Add(key))
            {
                throw new InvalidOperationException("La fuente izquierda tiene claves de unión duplicadas.");
            }

            if (key is not null && rightIndex.TryGetValue(key, out var match))
            {
                rows.Add([.. row, .. match]);
                matchedRight++;
            }
            else
            {
                unmatchedLeft++;
                if (kind == ReportJoinKind.Left)
                {
                    rows.Add([.. row, .. emptyRight]);
                }
            }
        }

        // Calificar los nombres conserva la identidad de las columnas cuando
        // los dos motores devuelven un alias igual, como fecha o municipio.
        var columns = left.Columns.Select(column => column with { Name = $"izquierda.{column.Name}" })
            .Concat(right.Columns.Select(column => column with
            {
                Name = $"derecha.{column.Name}",
                Ordinal = column.Ordinal + left.Columns.Count,
            })).ToArray();

        return new ReportJoinResult(columns, rows, unmatchedLeft, right.Rows.Count - matchedRight);
    }

    private static ResultColumn ResolveColumn(IReadOnlyList<ResultColumn> columns, string name)
    {
        var matches = columns.Where(column => column.Name == name).Take(2).ToArray();
        if (matches.Length != 1)
        {
            throw new InvalidOperationException($"La columna de unión {name} falta o es ambigua.");
        }

        return matches[0];
    }

    private static object[]? ReadKey(IReadOnlyList<object?> row, int[] ordinals)
    {
        var key = new object[ordinals.Length];
        for (var i = 0; i < ordinals.Length; i++)
        {
            // Igual que en una unión SQL, una clave nula queda sin coincidencia.
            if (row[ordinals[i]] is not { } value)
            {
                return null;
            }

            key[i] = value;
        }

        return key;
    }
}
