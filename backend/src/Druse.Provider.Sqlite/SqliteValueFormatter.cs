using System.Globalization;

namespace Druse.Provider.Sqlite;

/// <summary>
/// Convierte a texto los valores que devuelve Microsoft.Data.Sqlite.
///
/// Los formatos coinciden a propósito con los de los demás proveedores: la misma
/// columna debe leerse igual venga del motor que venga.
///
/// Lo que aquí no hay es de dónde deducir más. SQLite guarda **cinco clases de
/// almacenamiento** —nulo, entero, real, texto y binario— y nada más: una fecha
/// es un texto o un número según quien la escribiera, y una marca de tiempo
/// también. Así que se devuelve lo que hay, sin interpretarlo: convertir un
/// entero en fecha porque la columna se llame `creado_en` sería inventarse el
/// dato.
/// </summary>
internal static class SqliteValueFormatter
{
    public static string Format(object value) => value switch
    {
        string text => text,
        byte[] binary => $"0x{Convert.ToHexString(binary)}",
        bool flag => flag ? "true" : "false",
        // Un `REAL` se escribe con todos sus dígitos significativos: `R` es lo
        // que garantiza que vuelva a leerse como el mismo número.
        double number => number.ToString("R", CultureInfo.InvariantCulture),
        DateTime timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture),
        DateTimeOffset timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFFzzz", CultureInfo.InvariantCulture),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };
}
