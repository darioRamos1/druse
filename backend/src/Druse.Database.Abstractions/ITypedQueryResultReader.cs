using System.Data.Common;
using System.Globalization;
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

    /// <summary>
    /// Los tipos que un resultado de BI sabe guardar y volver a leer. Lo que
    /// entregue un proveedor fuera de esta lista se convierte a uno de ellos al
    /// leer, para que el cruce y el guardado traten igual a todos los motores.
    /// </summary>
    public static readonly IReadOnlySet<string> SupportedTypes = new HashSet<string>(StringComparer.Ordinal)
    {
        nameof(String), nameof(Boolean), nameof(Byte), nameof(Int16), nameof(Int32), nameof(Int64),
        nameof(Single), nameof(Double), nameof(Decimal), nameof(Guid), nameof(DateOnly), nameof(TimeOnly),
        nameof(DateTime), nameof(DateTimeOffset), nameof(TimeSpan), "Byte[]",
    };

    /// <summary>
    /// Lee un conjunto con sus valores originales y deja cada columna con un
    /// solo tipo, uno de <see cref="SupportedTypes"/>.
    ///
    /// Cada motor tiene sus rarezas, y aquí se igualan:
    ///
    /// - SQL Server y MySQL devuelven `DATE` como `DateTime`; se guarda como
    ///   fecha sin hora. Oracle llama `DATE` a una fecha **con** hora: solo se
    ///   pasa a fecha sin hora si todas las filas caen a medianoche.
    /// - MySQL tiene enteros sin signo; se suben al tipo con signo que los
    ///   contiene (`BIGINT UNSIGNED` a decimal).
    /// - SQLite no tiene tipos de columna, solo de valor: una columna puede
    ///   mezclar enteros y reales (se lee como real) o números y texto (como
    ///   texto). Una columna declarada `DATE` con fechas ISO se lee como fecha.
    /// - Un `NUMBER` de Oracle con más de 28 cifras no cabe en un decimal de
    ///   .NET: se lee como texto antes que perderlo.
    /// </summary>
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
            throw new ReportProblemException(ReportMessages.NoResultSet());
        }

        var rows = new List<object?[]>();
        var availableBytes = MaxBufferedBytes;
        var truncated = false;
        while (await ReadRowAsync(reader, cancellationToken))
        {
            // Se limita lo que conserva Druse. El proveedor puede materializar
            // una celda por su cuenta antes de entregarla.
            availableBytes -= 32L + 8L * columns.Count;
            if (rows.Count == maxRows || availableBytes < 0)
            {
                truncated = true;
                break;
            }

            var row = new object?[columns.Count];
            for (var ordinal = 0; ordinal < row.Length; ordinal++)
            {
                if (await reader.IsDBNullAsync(ordinal, cancellationToken))
                {
                    continue;
                }

                var value = Normalize(ReadValue(reader, ordinal));
                availableBytes -= value switch
                {
                    string text => 24L + 2L * text.Length,
                    byte[] bytes => 24L + bytes.Length,
                    _ => 32L,
                };
                if (availableBytes < 0)
                {
                    truncated = true;
                    break;
                }

                row[ordinal] = value;
            }

            if (truncated)
            {
                break;
            }

            rows.Add(row);
        }

        if (!truncated && await reader.NextResultAsync(cancellationToken))
        {
            throw new ReportProblemException(ReportMessages.SingleResultSet());
        }

        var typedColumns = columns.Select((column, ordinal) => Reconcile(column, ordinal, rows)).ToArray();
        return new TypedQueryResult(typedColumns, rows, truncated);
    }

    /// <summary>
    /// Avanza una fila y cancela igual en todos los motores.
    ///
    /// Npgsql sirve las filas de su búfer sin mirar el token, y el proveedor
    /// de IBM (Informix) envuelve la cancelación en una AggregateException:
    /// sin esto, cancelar no cortaría en uno y saldría como error en el otro.
    /// </summary>
    private static async Task<bool> ReadRowAsync(DbDataReader reader, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            return await reader.ReadAsync(cancellationToken);
        }
        catch (AggregateException exception)
            when (exception.Flatten().InnerExceptions.Any(inner => inner is OperationCanceledException))
        {
            throw new OperationCanceledException(exception.Message, exception, cancellationToken);
        }
    }

    private static object ReadValue(DbDataReader reader, int ordinal)
    {
        try
        {
            return reader.GetValue(ordinal);
        }
        catch (Exception exception) when (exception is InvalidCastException or OverflowException)
        {
            // Un número que no cabe en el tipo de .NET: el valor propio del
            // proveedor sabe escribirse entero.
            var text = System.Convert.ToString(reader.GetProviderSpecificValue(ordinal), CultureInfo.InvariantCulture)
                ?? string.Empty;
            return decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
                ? number
                : text;
        }
    }

    /// <summary>Lleva un valor a uno de los tipos que se saben guardar.</summary>
    private static object Normalize(object value) => value switch
    {
        sbyte number => (short)number,
        ushort number => (int)number,
        uint number => (long)number,
        ulong number => (decimal)number,
        char character => character.ToString(),
        byte[] bytes => bytes,
        Array array => "[" + string.Join(", ", array.Cast<object?>()
            .Select(item => System.Convert.ToString(item, CultureInfo.InvariantCulture))) + "]",
        _ when SupportedTypes.Contains(value.GetType().Name) => value,
        _ => System.Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty,
    };

    /// <summary>
    /// Elige el tipo de la columna por lo que de verdad trae y convierte las
    /// filas que no lo cumplan. Sin filas, manda lo que declaró el proveedor.
    /// </summary>
    private static ResultColumn Reconcile(ResultColumn column, int ordinal, List<object?[]> rows)
    {
        var declaredDate = column.DataType.Equals("date", StringComparison.OrdinalIgnoreCase);
        var types = rows.Select(row => row[ordinal]?.GetType()).OfType<Type>().Distinct().ToArray();

        if (types.Length == 0)
        {
            return column with { ClrType = declaredDate ? nameof(DateOnly) : DeclaredType(column.ClrType) };
        }

        if (declaredDate && types.All(type => type == typeof(DateTime))
            && rows.All(row => row[ordinal] is not DateTime date || date.TimeOfDay == TimeSpan.Zero))
        {
            ConvertColumn(rows, ordinal, value => DateOnly.FromDateTime((DateTime)value));
            return column with { ClrType = nameof(DateOnly) };
        }

        if (declaredDate && types.All(type => type == typeof(string))
            && rows.All(row => row[ordinal] is not string text || IsIsoDate(text)))
        {
            ConvertColumn(rows, ordinal, value => DateOnly.ParseExact((string)value, "yyyy-MM-dd", CultureInfo.InvariantCulture));
            return column with { ClrType = nameof(DateOnly) };
        }

        if (types.Length == 1)
        {
            return column with { ClrType = TypeName(types[0]) };
        }

        if (types.All(IsNumber))
        {
            // Un real en la mezcla manda: un decimal no guarda 1e300. Sin reales,
            // el entero más ancho, o decimal si hay decimales.
            var target = types.Any(type => type == typeof(double) || type == typeof(float))
                ? typeof(double)
                : types.Any(type => type == typeof(decimal)) ? typeof(decimal) : typeof(long);
            ConvertColumn(rows, ordinal, value => System.Convert.ChangeType(value, target, CultureInfo.InvariantCulture));
            return column with { ClrType = target.Name };
        }

        ConvertColumn(rows, ordinal, value => value switch
        {
            DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            DateTime date => date.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            byte[] bytes => System.Convert.ToHexString(bytes),
            _ => System.Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty,
        });
        return column with { ClrType = nameof(String) };
    }

    private static void ConvertColumn(List<object?[]> rows, int ordinal, Func<object, object> convert)
    {
        foreach (var row in rows)
        {
            if (row[ordinal] is { } value)
            {
                row[ordinal] = convert(value);
            }
        }
    }

    private static string DeclaredType(string clrType) => clrType switch
    {
        nameof(SByte) => nameof(Int16),
        nameof(UInt16) => nameof(Int32),
        nameof(UInt32) => nameof(Int64),
        nameof(UInt64) => nameof(Decimal),
        _ when SupportedTypes.Contains(clrType) => clrType,
        _ => nameof(String),
    };

    private static string TypeName(Type type) => type == typeof(byte[]) ? "Byte[]" : type.Name;

    private static bool IsNumber(Type type) =>
        type == typeof(byte) || type == typeof(short) || type == typeof(int) || type == typeof(long)
        || type == typeof(float) || type == typeof(double) || type == typeof(decimal);

    private static bool IsIsoDate(string text) =>
        DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
}
