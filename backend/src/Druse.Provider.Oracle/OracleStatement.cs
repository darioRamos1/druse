namespace Druse.Provider.Oracle;

/// <summary>
/// Lo que hay que saber del texto de una instrucción antes de mandarla.
///
/// Oracle es el único de los cinco motores que **no admite el punto y coma
/// final**: `SELECT 1 FROM DUAL;` se rechaza con `ORA-00911: invalid character`.
/// No es una peculiaridad de ODP.NET, es el protocolo: el punto y coma es cosa
/// de SQL*Plus, que lo usa para saber dónde termina lo que el usuario escribe, y
/// no viaja al servidor.
///
/// Por eso aquí se quita. Suena a reescribir el SQL del usuario —que es algo que
/// Druse no hace— pero no lo es: no cambia lo que la instrucción significa, sino
/// que retira un terminador que este motor no acepta. Lo hacen igual SQL
/// Developer, DBeaver y cualquier otro cliente, porque la alternativa es que la
/// consulta que uno copia de cualquier sitio falle con un error que no explica
/// nada.
///
/// **En un bloque PL/SQL no se toca.** Ahí el punto y coma es parte del lenguaje
/// y quitar el último rompería el bloque.
/// </summary>
internal static partial class OracleStatement
{
    /// <summary>
    /// Con qué empieza algo que Oracle lee como PL/SQL.
    ///
    /// Un bloque suelto arranca por `DECLARE` o `BEGIN`. Los demás casos son los
    /// objetos que llevan **un cuerpo dentro**, con sus propios puntos y coma:
    /// recortar el último dejaría el cuerpo sin terminar. Un `CREATE VIEW` o un
    /// `CREATE TABLE` no llevan cuerpo, y por eso no están aquí aunque empiecen
    /// igual —incluido el `CREATE OR REPLACE VIEW`, que es el caso que hace que
    /// no valga mirar solo las dos primeras palabras—.
    /// </summary>
    [System.Text.RegularExpressions.GeneratedRegex(
        @"^\s*(DECLARE|BEGIN)\b|^\s*CREATE\s+(OR\s+REPLACE\s+)?(EDITIONABLE\s+|NONEDITIONABLE\s+)?(PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|LIBRARY)\b",
        System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex PlSqlStart();

    /// <summary>El SQL tal y como hay que mandarlo al servidor.</summary>
    public static string Prepare(string sql)
    {
        ArgumentNullException.ThrowIfNull(sql);

        var trimmed = sql.TrimEnd();

        if (trimmed.Length == 0 || IsPlSql(trimmed))
        {
            // La barra final de SQL*Plus tampoco viaja: es su forma de decir
            // «ejecuta el bloque», no parte del bloque.
            return trimmed.EndsWith('/') ? trimmed[..^1].TrimEnd() : trimmed;
        }

        return trimmed.EndsWith(';') ? trimmed[..^1].TrimEnd() : trimmed;
    }

    /// <summary>Si el texto es un bloque PL/SQL y no una instrucción suelta.</summary>
    public static bool IsPlSql(string sql)
    {
        ArgumentNullException.ThrowIfNull(sql);

        return PlSqlStart().IsMatch(Significant(sql));
    }

    /// <summary>
    /// Si queda algo que ejecutar una vez quitados espacios y comentarios.
    ///
    /// Lo usa <see cref="OracleScript"/> para no mandar al motor el fragmento que
    /// queda detrás del último punto y coma, que en un guion comentado es solo
    /// texto para leer.
    /// </summary>
    public static bool HasCode(string sql)
    {
        ArgumentNullException.ThrowIfNull(sql);

        return Significant(sql).Length > 0;
    }

    /// <summary>
    /// El texto sin los comentarios ni los espacios de delante.
    ///
    /// Sin esto, un bloque que empiece con un comentario —lo normal en un
    /// procedimiento que alguien documentó— no se reconocería como PL/SQL y
    /// perdería su último punto y coma.
    /// </summary>
    internal static string Significant(string sql)
    {
        var index = 0;

        while (index < sql.Length)
        {
            if (char.IsWhiteSpace(sql[index]))
            {
                index++;
                continue;
            }

            if (sql.AsSpan(index).StartsWith("--", StringComparison.Ordinal))
            {
                var end = sql.IndexOfAny(['\r', '\n'], index);

                if (end < 0)
                {
                    return string.Empty;
                }

                index = end + 1;
                continue;
            }

            if (sql.AsSpan(index).StartsWith("/*", StringComparison.Ordinal))
            {
                var end = sql.IndexOf("*/", index, StringComparison.Ordinal);

                if (end < 0)
                {
                    return string.Empty;
                }

                index = end + 2;
                continue;
            }

            break;
        }

        return sql[index..];
    }
}
