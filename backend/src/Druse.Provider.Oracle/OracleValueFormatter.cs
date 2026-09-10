using System.Globalization;
using Oracle.ManagedDataAccess.Types;

namespace Druse.Provider.Oracle;

/// <summary>
/// Convierte los valores que devuelve ODP.NET a texto.
///
/// Los formatos coinciden a propósito con los de los demás proveedores: la misma
/// columna debe leerse igual venga del motor que venga, tanto en la cuadrícula
/// como en un archivo exportado.
///
/// Oracle añade un caso que los otros no tienen: **sus números no caben en
/// ninguno de .NET**. Un `NUMBER` admite 38 dígitos significativos, más que
/// `decimal`, así que ODP.NET los entrega envueltos en `OracleDecimal` y
/// convertirlos a `decimal` redondea en silencio. Aquí se lee el texto que trae
/// el propio tipo, que es el valor exacto tal y como lo guarda el motor.
/// </summary>
internal static class OracleValueFormatter
{
    public static string Format(object value) => value switch
    {
        string text => text,

        // El número tal y como lo tiene el motor, sin pasar por `decimal`: un
        // identificador de 30 dígitos se leería mal si se convirtiera.
        OracleDecimal number => number.IsNull ? string.Empty : number.ToString(),

        OracleString text => text.IsNull ? string.Empty : text.Value,

        // `DATE` de Oracle siempre lleva hora, aunque sea cero. Se escribe como
        // en los demás motores, y las cero horas se recortan solas.
        OracleDate date => date.IsNull
            ? string.Empty
            : date.Value.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),

        OracleTimeStampTZ timestamp => timestamp.IsNull
            ? string.Empty
            : timestamp.Value.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture)
              + " " + timestamp.TimeZone,

        OracleTimeStampLTZ timestamp => timestamp.IsNull
            ? string.Empty
            : timestamp.Value.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture),

        OracleTimeStamp timestamp => timestamp.IsNull
            ? string.Empty
            : timestamp.Value.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture),

        // Los intervalos se leen como los escribe Oracle, que es lo que se puede
        // copiar de vuelta a una consulta.
        OracleIntervalDS interval => interval.IsNull ? string.Empty : interval.ToString(),
        OracleIntervalYM interval => interval.IsNull ? string.Empty : interval.ToString(),

        OracleBinary binary => binary.IsNull
            ? string.Empty
            : $"0x{Convert.ToHexString(binary.Value)}",

        OracleBlob blob => $"0x{Convert.ToHexString(blob.Value)}",
        OracleClob clob => clob.Value,

        bool flag => flag ? "true" : "false",
        DateTime timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture),
        DateTimeOffset timestamp => timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFFzzz", CultureInfo.InvariantCulture),
        TimeSpan interval => interval.ToString(),
        byte[] binary => $"0x{Convert.ToHexString(binary)}",
        Guid uuid => uuid.ToString(),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };
}
