using System.Globalization;

namespace Druse.Provider.Informix;

/// <summary>
/// Convierte los valores que devuelve el proveedor de IBM a texto.
///
/// Los formatos coinciden a propósito con los de los demás proveedores: la misma
/// columna debe leerse igual venga del motor que venga, tanto en la cuadrícula
/// como en un archivo exportado. Lo único que cambia es la sintaxis de los
/// literales binarios, que se escribe como la escribiría cada motor para que el
/// valor pueda copiarse de vuelta a una consulta.
/// </summary>
internal static class InformixValueFormatter
{
    public static string Format(object value) => value switch
    {
        string text => text,

        // Si el driver entrega un bool, se muestra como en los otros motores.
        //
        // Por DRDA no ocurre: comprobado contra el servidor, un `BOOLEAN` llega
        // como `SMALLINT` de valor 1 o 0 y el tipo original se pierde por el
        // camino. No se normaliza a `true` porque para hacerlo habría que
        // convertir todos los `SMALLINT`, y una columna de cantidades pasaría a
        // leerse como booleana. Se enseña el número que manda el motor.
        bool flag => flag ? "true" : "false",

        // DATETIME de Informix llega hasta cinco decimales de segundo
        // (FRACTION(5)); el formato admite los que haya sin inventar ceros.
        DateTime timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFF", CultureInfo.InvariantCulture),
        DateTimeOffset timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFzzz", CultureInfo.InvariantCulture),
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        TimeOnly time => time.ToString("HH:mm:ss.FFFFF", CultureInfo.InvariantCulture),

        // Los INTERVAL de Informix pueden superar el día, así que llegan como
        // TimeSpan y no como TimeOnly.
        TimeSpan interval => interval.ToString(),

        // Informix escribe los literales binarios en hexadecimal sin prefijo,
        // pero se conserva `0x` por coherencia con los otros tres motores: lo que
        // se copia de la cuadrícula debe leerse igual en cualquiera de ellos.
        byte[] binary => $"0x{Convert.ToHexString(binary)}",

        Guid uuid => uuid.ToString(),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };
}
