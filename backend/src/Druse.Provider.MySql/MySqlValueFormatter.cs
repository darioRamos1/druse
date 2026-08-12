using System.Globalization;

namespace Druse.Provider.MySql;

/// <summary>
/// Convierte los valores que devuelve MySqlConnector a texto.
///
/// Los formatos coinciden a propósito con los de los demás proveedores: la misma
/// columna debe leerse igual venga del motor que venga, tanto en la cuadrícula
/// como en un archivo exportado. Lo único que cambia es la sintaxis de los
/// literales binarios, que se escribe como la escribiría cada motor para que el
/// valor pueda copiarse de vuelta a una consulta.
/// </summary>
internal static class MySqlValueFormatter
{
    public static string Format(object value) => value switch
    {
        string text => text,
        // MySQL no tiene tipo booleano; llega aquí porque BOOL es TINYINT(1) y el
        // driver lo convierte. Ver MySqlConnectionStringFactory.
        bool flag => flag ? "true" : "false",
        // MySQL guarda como mucho seis decimales de segundo.
        DateTime timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFF", CultureInfo.InvariantCulture),
        DateTimeOffset timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFzzz", CultureInfo.InvariantCulture),
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        TimeOnly time => time.ToString("HH:mm:ss.FFFFFF", CultureInfo.InvariantCulture),
        // El tipo TIME de MySQL admite rangos de más de un día y valores
        // negativos, así que no cabe en TimeOnly y llega como TimeSpan.
        TimeSpan interval => interval.ToString(),
        byte[] binary => $"0x{Convert.ToHexString(binary)}",
        Guid uuid => uuid.ToString(),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };
}
