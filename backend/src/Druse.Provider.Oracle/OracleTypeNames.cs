using System.Globalization;

namespace Druse.Provider.Oracle;

/// <summary>
/// Escribe el tipo completo de una columna a partir de lo que guarda el
/// catálogo.
///
/// Oracle es el único de los cinco motores que **no guarda el tipo escrito**.
/// PostgreSQL da `varchar(200)` y MySQL da `decimal(10,2)`; aquí el catálogo
/// reparte el dato en cinco columnas —el nombre, la longitud, si esa longitud
/// son caracteres o bytes, la precisión y la escala— y hay que volver a juntarlo.
///
/// Importa más de lo que parece: ese texto es lo que se enseña al lado de cada
/// columna, lo que se copia al diseñar una tabla y lo que lee el traductor de
/// tipos para llevarla a otro motor. Un `NUMBER` a secas y un `NUMBER(10,2)` no
/// son lo mismo, y quedarse con «NUMBER» perdería la mitad de la información.
/// </summary>
internal static class OracleTypeNames
{
    /// <summary>Lo que el catálogo sabe de una columna, sin interpretar.</summary>
    /// <param name="Length">Caracteres, para los tipos de texto.</param>
    /// <param name="Bytes">
    /// Bytes, que es lo único que declara un `RAW`: su longitud no aparece en
    /// `CHAR_LENGTH`, que vale cero en todo lo que no sea texto.
    /// </param>
    public readonly record struct RawType(
        string Name,
        int? Length,
        string? LengthUnit,
        int? Precision,
        int? Scale,
        int? Bytes = null);

    public static string Compose(RawType raw)
    {
        var name = raw.Name;

        return name switch
        {
            // El texto lleva su longitud, y **con la unidad**: `VARCHAR2(50
            // CHAR)` y `VARCHAR2(50 BYTE)` no admiten lo mismo, y en una base con
            // acentos la diferencia es de la mitad de los caracteres.
            "VARCHAR2" or "NVARCHAR2" or "CHAR" or "NCHAR" or "VARCHAR" =>
                raw.Length is { } length
                    ? $"{name}({length}{Unit(raw.LengthUnit, name)})"
                    : name,

            // Un `NUMBER` sin precisión es el de coma flotante de 38 dígitos, y
            // se escribe a secas. Con escala cero se escribe solo la precisión,
            // que es como lo escribiría cualquiera.
            "NUMBER" => raw.Precision is not { } precision
                ? name
                : raw.Scale is > 0
                    ? $"NUMBER({precision},{raw.Scale.Value.ToString(CultureInfo.InvariantCulture)})"
                    : $"NUMBER({precision})",

            "FLOAT" => raw.Precision is { } floatPrecision ? $"FLOAT({floatPrecision})" : name,

            "RAW" => raw.Bytes is { } rawBytes and > 0 ? $"RAW({rawBytes})" : name,

            // Las marcas de tiempo y los intervalos ya vienen escritos enteros
            // desde el catálogo —`TIMESTAMP(6) WITH TIME ZONE`— y tocarlos solo
            // podría estropearlos.
            _ => name,
        };
    }

    /// <summary>
    /// La unidad de la longitud, y solo cuando aporta algo.
    ///
    /// `CHAR` es la que hay que decir siempre: es la que cambia el
    /// comportamiento. `BYTE` es la de serie, así que escribirla sería ruido en
    /// el noventa por ciento de las columnas.
    /// </summary>
    private static string Unit(string? unit, string typeName) =>
        unit == "C" && typeName is not ("NVARCHAR2" or "NCHAR") ? " CHAR" : string.Empty;
}
