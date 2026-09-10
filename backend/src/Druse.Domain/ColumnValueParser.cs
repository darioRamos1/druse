using System.Globalization;

namespace Druse.Domain;

/// <summary>
/// Familia a la que pertenece un tipo del motor.
///
/// Se clasifica por el nombre porque los tres motores llaman parecido a lo
/// mismo: `int4`, `bigint` e `int` son enteros vengan de donde vengan. Es la
/// misma idea que usa la cuadrícula para decidir cómo pintar una columna.
/// </summary>
public enum ColumnFamily
{
    Text = 0,
    Integral = 1,
    Fractional = 2,
    Boolean = 3,
    Date = 4,
    Time = 5,
    Timestamp = 6,
    TimestampWithZone = 7,
    Binary = 8,
    Uuid = 9,
}

/// <summary>
/// Convierte el texto de una celda en el valor que espera el motor.
///
/// Es el camino inverso al de los formateadores de cada proveedor, y vive en el
/// dominio porque la regla no depende del motor: lo que el usuario escribe en la
/// cuadrícula significa lo mismo en los tres.
///
/// **Un valor que no se entiende no se convierte a la fuerza.** Mandar texto a
/// una columna numérica y dejar que el servidor lo interprete es la forma de que
/// un `1,5` acabe guardado como 15.
/// </summary>
public static class ColumnValueParser
{
    public static ColumnFamily Classify(string dataType)
    {
        ArgumentNullException.ThrowIfNull(dataType);

        var type = dataType.ToLowerInvariant();

        // El orden importa: `timestamptz` contiene «timestamp», y `datetimeoffset`
        // contiene «datetime».
        if (type.Contains("uuid", StringComparison.Ordinal) ||
            type.Contains("uniqueidentifier", StringComparison.Ordinal))
        {
            return ColumnFamily.Uuid;
        }

        if (type.Contains("bool", StringComparison.Ordinal) ||
            type == "bit" ||
            type.StartsWith("tinyint(1)", StringComparison.Ordinal))
        {
            return ColumnFamily.Boolean;
        }

        if (type.Contains("timestamptz", StringComparison.Ordinal) ||
            type.Contains("datetimeoffset", StringComparison.Ordinal) ||
            type.Contains("with time zone", StringComparison.Ordinal))
        {
            return ColumnFamily.TimestampWithZone;
        }

        if (type.Contains("timestamp", StringComparison.Ordinal) ||
            type.Contains("datetime", StringComparison.Ordinal))
        {
            return ColumnFamily.Timestamp;
        }

        if (type.StartsWith("date", StringComparison.Ordinal))
        {
            return ColumnFamily.Date;
        }

        if (type.StartsWith("time", StringComparison.Ordinal))
        {
            return ColumnFamily.Time;
        }

        if (type.Contains("bytea", StringComparison.Ordinal) ||
            type.Contains("binary", StringComparison.Ordinal) ||
            type.Contains("blob", StringComparison.Ordinal) ||
            // `RAW` y `LONG RAW` son los binarios de Oracle. Va por delante el
            // `binary` de arriba, que también atrapa su `BINARY_DOUBLE`, así que
            // este caso se mira con el nombre entero y no con una subcadena.
            type.StartsWith("raw", StringComparison.Ordinal) ||
            type.StartsWith("long raw", StringComparison.Ordinal))
        {
            return ColumnFamily.Binary;
        }

        // `NUMBER` es el único tipo numérico de Oracle: entero y decimal salen los
        // dos de ahí, y lo que los distingue es la escala. Sin escala declarada
        // admite decimales, así que se clasifica por lo que **puede** guardar y no
        // por lo que suela llevar dentro: dar por entero un `NUMBER` a secas
        // convertiría un 3,5 en 4 al releerlo.
        if (type.StartsWith("number", StringComparison.Ordinal))
        {
            return Scale(type) == 0 ? ColumnFamily.Integral : ColumnFamily.Fractional;
        }

        if (type.Contains("numeric", StringComparison.Ordinal) ||
            type.Contains("decimal", StringComparison.Ordinal) ||
            type.Contains("money", StringComparison.Ordinal) ||
            type.Contains("real", StringComparison.Ordinal) ||
            type.Contains("double", StringComparison.Ordinal) ||
            type.Contains("float", StringComparison.Ordinal))
        {
            return ColumnFamily.Fractional;
        }

        if (type.Contains("int", StringComparison.Ordinal) ||
            type.Contains("serial", StringComparison.Ordinal))
        {
            return ColumnFamily.Integral;
        }

        return ColumnFamily.Text;
    }

    /// <summary>
    /// La escala declarada entre paréntesis, o `null` si no se declaró ninguna.
    ///
    /// `NUMBER(10)` da cero —no hay decimales— y `NUMBER(10,2)` da dos. Un
    /// `NUMBER` a secas no declara nada, y eso no es lo mismo que declarar cero.
    /// </summary>
    private static int? Scale(string type)
    {
        var open = type.IndexOf('(', StringComparison.Ordinal);

        if (open < 0)
        {
            return null;
        }

        var close = type.IndexOf(')', open);
        var inside = close < 0 ? type[(open + 1)..] : type[(open + 1)..close];
        var comma = inside.IndexOf(',', StringComparison.Ordinal);

        return comma < 0
            ? 0
            : int.TryParse(inside[(comma + 1)..].Trim(), out var scale) ? scale : null;
    }

    /// <summary>
    /// Convierte, o explica por qué no puede.
    ///
    /// La cultura es invariante en todo: es la misma con la que se mostró el
    /// valor, y la única que no cambia según la máquina de quien edita.
    /// </summary>
    public static bool TryParse(string dataType, string? text, out object value, out string? error)
    {
        value = DBNull.Value;
        error = null;

        if (text is null)
        {
            return true;
        }

        var family = Classify(dataType);

        if (family == ColumnFamily.Text)
        {
            value = text;
            return true;
        }

        // Una cadena vacía en una columna que no es texto solo puede querer decir
        // nulo; guardarla como 0 o como 1900-01-01 sería inventar.
        if (text.Length == 0)
        {
            return true;
        }

        var invariant = CultureInfo.InvariantCulture;

        switch (family)
        {
            case ColumnFamily.Integral when long.TryParse(text, NumberStyles.Integer, invariant, out var entero):
                value = entero;
                return true;

            case ColumnFamily.Fractional when decimal.TryParse(text, NumberStyles.Float, invariant, out var numero):
                value = numero;
                return true;

            case ColumnFamily.Boolean:
                return TryParseBoolean(text, out value, out error);

            case ColumnFamily.Date when DateOnly.TryParse(text, invariant, out var fecha):
                value = fecha;
                return true;

            // MySQL, SQL Server e Informix devuelven una fecha con la hora a cero
            // —«2026-08-17 00:00:00»—, y ese texto es el que acaba dentro de un
            // CSV exportado. Volver a leerlo tiene que funcionar; con una hora
            // distinta de medianoche no, porque entonces el valor dice algo que la
            // columna no puede guardar y quedarse solo con la fecha sería
            // tirarlo sin avisar.
            case ColumnFamily.Date
                when DateTime.TryParse(text, invariant, DateTimeStyles.None, out var conHora) &&
                     conHora.TimeOfDay == TimeSpan.Zero:
                value = DateOnly.FromDateTime(conHora);
                return true;

            case ColumnFamily.Time when TimeSpan.TryParse(text, invariant, out var hora):
                value = hora;
                return true;

            case ColumnFamily.Timestamp when DateTime.TryParse(text, invariant, DateTimeStyles.None, out var momento):
                value = momento;
                return true;

            case ColumnFamily.TimestampWithZone when DateTimeOffset.TryParse(text, invariant, DateTimeStyles.None, out var conZona):
                value = conZona;
                return true;

            case ColumnFamily.Binary:
                return TryParseBinary(text, out value, out error);

            case ColumnFamily.Uuid when Guid.TryParse(text, out var uuid):
                value = uuid;
                return true;
        }

        error = $"«{text}» no es un valor válido para una columna {dataType}.";
        return false;
    }

    private static bool TryParseBoolean(string text, out object value, out string? error)
    {
        value = DBNull.Value;
        error = null;

        switch (text.Trim().ToLowerInvariant())
        {
            // `1` y `0` se aceptan porque es como los escriben SQL Server y MySQL.
            case "true" or "1" or "t" or "sí" or "si":
                value = true;
                return true;

            case "false" or "0" or "f" or "no":
                value = false;
                return true;

            default:
                error = $"«{text}» no es un valor booleano; usa true o false.";
                return false;
        }
    }

    private static bool TryParseBinary(string text, out object value, out string? error)
    {
        value = DBNull.Value;
        error = null;

        // Se acepta tal y como se muestra en la cuadrícula: `0x…` en SQL Server y
        // MySQL, `\x…` en PostgreSQL.
        var limpio = text.Trim();
        limpio = limpio.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? limpio[2..]
            : limpio.StartsWith("\\x", StringComparison.Ordinal) ? limpio[2..]
            : limpio;

        try
        {
            value = Convert.FromHexString(limpio);
            return true;
        }
        catch (FormatException)
        {
            error = "El valor binario debe escribirse en hexadecimal, como 0x00FF.";
            return false;
        }
    }

    /// <summary>
    /// Escribe un valor como literal SQL, **solo para enseñárselo al usuario**.
    ///
    /// Lo que se ejecuta va siempre por parámetros. Esto existe para que el SQL
    /// que se muestra antes de confirmar sea legible de un vistazo, y por eso
    /// escapa las comillas: un literal a medias en pantalla se lee mal.
    /// </summary>
    public static string ToLiteral(string dataType, string? text)
    {
        if (text is null)
        {
            return "NULL";
        }

        return Classify(dataType) switch
        {
            ColumnFamily.Integral or ColumnFamily.Fractional when text.Length > 0 => text,
            ColumnFamily.Boolean when text.Length > 0 => text,
            _ => $"'{text.Replace("'", "''", StringComparison.Ordinal)}'",
        };
    }
}
