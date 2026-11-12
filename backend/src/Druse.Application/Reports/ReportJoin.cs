using System.Globalization;
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
    int UnmatchedRightRows)
{
    /// <summary>
    /// Columnas numéricas del lado «uno» que aparecen en varias filas. Sumarlas
    /// tal cual contaría la misma meta varias veces: hay que agregarlas a su nivel.
    /// </summary>
    public IReadOnlyList<string> RepeatedColumns { get; init; } = [];
}

/// <summary>La unión se detuvo por claves repetidas donde no se esperaban.</summary>
public sealed class ReportJoinDuplicateKeysException(UserMessage localized, IReadOnlyList<string> sampleKeys)
    : InvalidOperationException(localized.Text)
{
    /// <summary>El motivo con su clave, para decirlo en el idioma de la ventana.</summary>
    public UserMessage Localized { get; } = localized;

    /// <summary>Hasta tres claves repetidas, para que se puedan buscar en el origen.</summary>
    public IReadOnlyList<string> SampleKeys { get; } = sampleKeys;
}

/// <summary>Une dos resultados uno a uno o muchos a uno.</summary>
public static class ReportJoin
{
    private const int DuplicateSamples = 3;

    private static readonly HashSet<string> NumericTypes =
    [
        nameof(Byte), nameof(Int16), nameof(Int32), nameof(Int64), nameof(Single), nameof(Double), nameof(Decimal),
    ];

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
        CancellationToken cancellationToken) =>
        Combine(left, right, keys, kind, ReportJoinCardinality.OneToOne, cancellationToken);

    public static ReportJoinResult Combine(
        TypedQueryResult left,
        TypedQueryResult right,
        IReadOnlyList<ReportJoinKey> keys,
        ReportJoinKind kind,
        ReportJoinCardinality cardinality,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        ArgumentNullException.ThrowIfNull(keys);
        cancellationToken.ThrowIfCancellationRequested();
        if (left.Truncated || right.Truncated)
        {
            throw new ReportProblemException(ReportMessages.JoinTruncated());
        }

        if (keys.Count == 0)
        {
            throw new ArgumentException("Elige al menos una columna de unión.", nameof(keys));
        }

        if (!Enum.IsDefined(kind))
        {
            throw new ArgumentOutOfRangeException(nameof(kind));
        }

        if (!Enum.IsDefined(cardinality))
        {
            throw new ArgumentOutOfRangeException(nameof(cardinality));
        }

        var leftColumns = new int[keys.Count];
        var rightColumns = new int[keys.Count];
        for (var i = 0; i < keys.Count; i++)
        {
            var leftColumn = ResolveColumn(left.Columns, keys[i].Left);
            var rightColumn = ResolveColumn(right.Columns, keys[i].Right);
            if (leftColumn.ClrType != rightColumn.ClrType)
            {
                throw new ReportProblemException(ReportMessages.JoinTypesDiffer(leftColumn.Name, rightColumn.Name));
            }

            if (leftColumn.ClrType is not (nameof(String) or nameof(DateOnly) or nameof(Boolean) or
                nameof(Byte) or nameof(Int16) or nameof(Int32) or nameof(Int64) or nameof(Decimal) or nameof(Guid)))
            {
                throw new ReportProblemException(ReportMessages.JoinNeedsConversion(leftColumn.Name));
            }

            leftColumns[i] = leftColumn.Ordinal;
            rightColumns[i] = rightColumn.Ordinal;
        }

        var rightIndex = new Dictionary<object[], RightEntry>(KeyComparer);
        var duplicates = new List<string>();
        var rightWithoutKey = 0;
        foreach (var row in right.Rows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var key = ReadKey(row, rightColumns);
            if (key is null)
            {
                rightWithoutKey++;
            }
            else if (!rightIndex.TryAdd(key, new RightEntry(row)) && duplicates.Count < DuplicateSamples)
            {
                duplicates.Add(FormatKey(key));
            }
        }

        // En las dos cardinalidades la derecha es el lado «uno»: repetirla
        // multiplicaría filas sin que nadie lo hubiera pedido (N:N).
        if (duplicates.Count > 0)
        {
            throw new ReportJoinDuplicateKeysException(ReportMessages.JoinRightDuplicates(), duplicates);
        }

        var leftKeys = cardinality == ReportJoinCardinality.OneToOne
            ? new HashSet<object[]>(KeyComparer)
            : null;
        var rows = new List<IReadOnlyList<object?>>(left.Rows.Count);
        var emptyRight = new object?[right.Columns.Count];
        var unmatchedLeft = 0;
        var repeated = false;
        foreach (var row in left.Rows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var key = ReadKey(row, leftColumns);
            if (key is not null && leftKeys is not null && !leftKeys.Add(key) && duplicates.Count < DuplicateSamples)
            {
                duplicates.Add(FormatKey(key));
            }

            if (key is not null && rightIndex.TryGetValue(key, out var match))
            {
                rows.Add([.. row, .. match.Row]);
                match.Matches++;
                repeated |= match.Matches > 1;
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

        if (duplicates.Count > 0)
        {
            throw new ReportJoinDuplicateKeysException(ReportMessages.JoinLeftDuplicates(), duplicates);
        }

        // Calificar los nombres conserva la identidad de las columnas cuando
        // los dos motores devuelven un alias igual, como fecha o municipio.
        var columns = left.Columns.Select(column => column with { Name = $"izquierda.{column.Name}" })
            .Concat(right.Columns.Select(column => column with
            {
                Name = $"derecha.{column.Name}",
                Ordinal = column.Ordinal + left.Columns.Count,
            })).ToArray();

        var unmatchedRight = rightWithoutKey + rightIndex.Values.Count(entry => entry.Matches == 0);
        var keyOrdinals = rightColumns.ToHashSet();
        return new ReportJoinResult(columns, rows, unmatchedLeft, unmatchedRight)
        {
            // Las claves se repiten por definición; lo que no se puede sumar
            // son las cifras que acompañan a cada fila del lado «uno».
            RepeatedColumns = repeated
                ? right.Columns
                    .Where(column => !keyOrdinals.Contains(column.Ordinal) && NumericTypes.Contains(column.ClrType))
                    .Select(column => $"derecha.{column.Name}")
                    .ToArray()
                : [],
        };
    }

    // Fechas en ISO: la clave se copia para buscarla en el origen, y «01/02/2026»
    // no dice si es enero o febrero.
    private static string FormatKey(object[] key) => string.Join(" · ", key.Select(value => value switch
    {
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTime date => date.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
        DateTimeOffset date => date.ToString("yyyy-MM-dd HH:mm:ss zzz", CultureInfo.InvariantCulture),
        _ => Convert.ToString(value, CultureInfo.InvariantCulture),
    }));

    private sealed class RightEntry(IReadOnlyList<object?> row)
    {
        public IReadOnlyList<object?> Row { get; } = row;

        public int Matches { get; set; }
    }

    private static ResultColumn ResolveColumn(IReadOnlyList<ResultColumn> columns, string name)
    {
        var matches = columns.Where(column => column.Name == name).Take(2).ToArray();
        if (matches.Length != 1)
        {
            throw new ReportProblemException(ReportMessages.JoinColumnMissing(name));
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
