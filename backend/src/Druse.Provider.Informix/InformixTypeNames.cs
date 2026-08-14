using System.Globalization;

namespace Druse.Provider.Informix;

/// <summary>
/// Descodifica el tipo de una columna a partir de `syscolumns`.
///
/// Informix no guarda el tipo como texto: guarda un número en `coltype` y una
/// longitud en `collength` cuyo significado **depende del tipo**. Es la mayor
/// diferencia con los otros tres motores, donde el catálogo ya da el nombre
/// escrito o algo muy parecido.
///
/// Lo que se devuelve es el tipo tal y como se escribiría en un `CREATE TABLE`,
/// porque es lo que el usuario ve en el explorador y lo que el diseñador de
/// tablas vuelve a mandar.
/// </summary>
internal static class InformixTypeNames
{
    /// <summary>
    /// El bit 0x100 de `coltype` no es parte del tipo: indica que la columna no
    /// admite nulos. Hay que quitarlo antes de mirar de qué tipo se trata.
    /// </summary>
    private const int NotNullFlag = 0x100;

    /// <summary>El bit 0x200 marca columnas de tipo distribuido; tampoco es el tipo.</summary>
    private const int HostVariableFlag = 0x200;

    public static bool IsNullable(int coltype) => (coltype & NotNullFlag) == 0;

    /// <summary>
    /// Los tipos que el motor rellena solo: `SERIAL`, `SERIAL8` y `BIGSERIAL`.
    ///
    /// En Informix la identidad **es el tipo de la columna**, no una cláusula que
    /// se añade detrás como `IDENTITY` o `AUTO_INCREMENT`. De ahí que el
    /// diseñador de tablas tenga que sustituir el tipo en vez de añadir palabras.
    /// </summary>
    public static bool IsSerial(int coltype) => Base(coltype) is 6 or 18 or 53;

    public static string Format(int coltype, int collength)
    {
        var type = Base(coltype);

        return type switch
        {
            0 => $"CHAR({collength})",
            1 => "SMALLINT",
            2 => "INTEGER",
            3 => "FLOAT",
            4 => "SMALLFLOAT",
            5 => Decimal(collength),
            6 => "SERIAL",
            7 => "DATE",
            8 => Money(collength),
            10 => "DATETIME",
            11 => "BYTE",
            12 => "TEXT",
            13 => $"VARCHAR({VarcharMax(collength)})",
            14 => "INTERVAL",
            15 => $"NCHAR({collength})",
            16 => $"NVARCHAR({VarcharMax(collength)})",
            17 => "INT8",
            18 => "SERIAL8",
            19 => "SET",
            20 => "MULTISET",
            21 => "LIST",
            40 => "LVARCHAR",
            41 => "CLOB",
            43 => $"LVARCHAR({collength})",
            45 => "BOOLEAN",
            52 => "BIGINT",
            53 => "BIGSERIAL",
            _ => $"TIPO {type}",
        };
    }

    /// <summary>Quita las banderas para quedarse con el tipo.</summary>
    private static int Base(int coltype) => coltype & ~(NotNullFlag | HostVariableFlag);

    /// <summary>
    /// `DECIMAL` empaqueta precisión y escala en un solo número: la precisión en
    /// el byte alto y la escala en el bajo. Una escala de 255 significa que la
    /// columna se declaró sin escala, es decir, coma flotante.
    /// </summary>
    private static string Decimal(int collength)
    {
        var precision = collength / 256;
        var scale = collength % 256;

        if (precision <= 0)
        {
            return "DECIMAL";
        }

        return scale == 255
            ? $"DECIMAL({precision.ToString(CultureInfo.InvariantCulture)})"
            : $"DECIMAL({precision.ToString(CultureInfo.InvariantCulture)},{scale.ToString(CultureInfo.InvariantCulture)})";
    }

    private static string Money(int collength)
    {
        var precision = collength / 256;
        var scale = collength % 256;

        return precision <= 0
            ? "MONEY"
            : $"MONEY({precision.ToString(CultureInfo.InvariantCulture)},{scale.ToString(CultureInfo.InvariantCulture)})";
    }

    /// <summary>
    /// En `VARCHAR`, el byte bajo es el tamaño máximo y el alto el mínimo
    /// reservado. Se muestra el máximo, que es lo que se escribe al declararla.
    /// </summary>
    private static int VarcharMax(int collength) => collength % 256;
}
