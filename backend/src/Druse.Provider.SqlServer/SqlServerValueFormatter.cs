using System.Globalization;

namespace Druse.Provider.SqlServer;

/// <summary>
/// Convierte los valores que devuelve SqlClient a texto.
///
/// Los formatos coinciden a propósito con los del proveedor PostgreSQL: la misma
/// columna debe leerse igual venga del motor que venga, tanto en la cuadrícula
/// como en un archivo exportado.
/// </summary>
internal static class SqlServerValueFormatter
{
    public static string Format(object value) => value switch
    {
        string text => text,
        bool flag => flag ? "true" : "false",
        DateTime timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture),
        DateTimeOffset timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFFzzz", CultureInfo.InvariantCulture),
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        TimeOnly time => time.ToString("HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture),
        TimeSpan interval => interval.ToString(),
        byte[] binary => $"0x{Convert.ToHexString(binary)}",
        Guid uuid => uuid.ToString(),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };
}
