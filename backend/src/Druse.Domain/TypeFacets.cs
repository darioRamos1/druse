using System.Globalization;

namespace Druse.Domain;

/// <summary>
/// Lo que se puede saber de un tipo mirándolo, sin conocer el motor que lo
/// escribió.
///
/// Existe para traducir tipos entre motores **sin una tabla de todos contra
/// todos**. Con cuatro motores esa tabla tendría doce direcciones y crecería al
/// cuadrado; aquí en cambio cada motor solo tiene que saber dos cosas: clasificar
/// lo que lee —eso ya lo hace <see cref="ColumnValueParser.Classify"/>— y nombrar
/// su tipo para una familia con estas medidas.
///
/// **No pretende describir el tipo entero.** Guarda lo que sobrevive a un cambio
/// de motor: la familia y el tamaño. Lo que no sobrevive —que sea `jsonb` y no
/// texto, que sea un array— se anota aparte, precisamente para poder avisar de lo
/// que se pierde.
/// </summary>
/// <param name="Family">A qué se parece el tipo, según lo que Druse ya sabe leer.</param>
/// <param name="Length">Longitud declarada de un texto o un binario, si la lleva.</param>
/// <param name="Precision">Dígitos totales de un decimal, si los lleva.</param>
/// <param name="Scale">Dígitos decimales, si los lleva.</param>
/// <param name="IsUnbounded">El tipo no declara tamaño: `text`, `varchar(max)`, `clob`.</param>
/// <param name="IsJson">El motor lo trata como JSON y no como texto cualquiera.</param>
/// <param name="IsArray">Una columna que guarda varios valores. Solo PostgreSQL.</param>
public readonly record struct TypeFacets(
    ColumnFamily Family,
    int? Length = null,
    int? Precision = null,
    int? Scale = null,
    bool IsUnbounded = false,
    bool IsJson = false,
    bool IsArray = false)
{
    /// <summary>
    /// Lee las medidas de un tipo escrito por un motor.
    ///
    /// El texto llega tal y como lo devolvió el catálogo —`varchar(200)`,
    /// `numeric(18,2)`, `timestamp without time zone`, `text[]`— y de ahí sale
    /// todo lo que se necesita para pedirle a otro motor el suyo.
    /// </summary>
    public static TypeFacets Parse(string dataType)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataType);

        var type = dataType.Trim();
        var lower = type.ToLowerInvariant();

        var family = ColumnValueParser.Classify(type);
        var numbers = Numbers(type);

        var isArray = lower.EndsWith("[]", StringComparison.Ordinal) ||
            lower.StartsWith('_');

        var isJson = lower.Contains("json", StringComparison.Ordinal);

        // «Sin tamaño» es lo que hay que conservar al cruzar de motor: un `text`
        // de PostgreSQL tiene que llegar a SQL Server como `nvarchar(max)` y no
        // como un `nvarchar(1)` porque nadie declaró longitud.
        var isUnbounded =
            lower is "text" or "ntext" or "clob" or "blob" or "bytea" or "lvarchar" ||
            lower.Contains("max", StringComparison.Ordinal) ||
            lower.Contains("lob", StringComparison.Ordinal) ||
            (family is ColumnFamily.Text or ColumnFamily.Binary && numbers.Count == 0 && !isJson);

        return new TypeFacets(
            family,
            Length: family is ColumnFamily.Text or ColumnFamily.Binary && numbers.Count > 0
                ? numbers[0]
                : null,
            Precision: family == ColumnFamily.Fractional && numbers.Count > 0 ? numbers[0] : null,
            Scale: family == ColumnFamily.Fractional && numbers.Count > 1 ? numbers[1] : null,
            IsUnbounded: isUnbounded,
            IsJson: isJson,
            IsArray: isArray);
    }

    /// <summary>
    /// Los números entre paréntesis, en orden.
    ///
    /// Se leen del paréntesis y no del texto entero para no confundir el `8` de
    /// `int8` con una longitud. Lo que hay dentro son siempre medidas: longitud,
    /// o precisión y escala.
    /// </summary>
    private static IReadOnlyList<int> Numbers(string dataType)
    {
        var open = dataType.IndexOf('(', StringComparison.Ordinal);
        var close = dataType.IndexOf(')', StringComparison.Ordinal);

        if (open < 0 || close < open)
        {
            return [];
        }

        return
        [
            .. dataType[(open + 1)..close]
                .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Select(part =>
                    int.TryParse(part, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number)
                        ? number
                        : (int?)null)
                .Where(number => number is not null)
                .Select(number => number!.Value),
        ];
    }
}
