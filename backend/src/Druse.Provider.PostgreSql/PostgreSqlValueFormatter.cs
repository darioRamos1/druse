using System.Globalization;

namespace Druse.Provider.PostgreSql;

/// <summary>
/// Convierte los valores que devuelve Npgsql a texto.
///
/// Se usa cultura invariante a propósito: lo que se muestra debe ser el dato del
/// servidor, no una interpretación local. Formatear un `numeric` con la coma
/// decimal de la máquina haría imposible copiar el valor de vuelta a una
/// consulta, y rompería los archivos exportados en cuanto cambiara de equipo.
/// </summary>
internal static class PostgreSqlValueFormatter
{
    public static string Format(object value) => value switch
    {
        string text => text,
        bool flag => flag ? "true" : "false",
        DateTime timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFF", CultureInfo.InvariantCulture),
        DateTimeOffset timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFzzz", CultureInfo.InvariantCulture),
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        TimeOnly time => time.ToString("HH:mm:ss.FFFFFF", CultureInfo.InvariantCulture),
        TimeSpan interval => interval.ToString(),
        byte[] binary => $"\\x{Convert.ToHexString(binary).ToLowerInvariant()}",
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };
}
