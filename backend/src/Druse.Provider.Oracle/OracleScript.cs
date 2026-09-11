namespace Druse.Provider.Oracle;

/// <summary>Una instrucción encontrada dentro de un guion, con dónde estaba.</summary>
/// <param name="Text">El texto listo para mandar, ya sin el terminador.</param>
/// <param name="StartOffset">Dónde empieza dentro del guion completo. Base 0.</param>
internal readonly record struct OracleScriptStatement(string Text, int StartOffset);

/// <summary>
/// Parte un guion de Oracle en las instrucciones que hay que mandar **de una en
/// una**.
///
/// Existe porque Oracle es el único de los seis motores que no encadena: donde
/// PostgreSQL, MySQL, SQL Server y SQLite aceptan `SELECT 1; SELECT 2;` en un
/// solo comando, aquí eso es `ORA-00911: invalid character`. No es cosa de
/// ODP.NET sino del protocolo —el punto y coma es de SQL*Plus, que lo usa para
/// saber dónde acaba lo que uno escribe, y no viaja al servidor—, así que
/// **partir el guion es trabajo de Druse**: quien pega dos consultas y pulsa
/// Ejecutar espera que se ejecuten las dos.
///
/// El punto y coma solo separa cuando está fuera de todo lo demás. Dentro de un
/// literal —`'O''Donnell; 12'`—, de un identificador citado, de un comentario o
/// de un literal alternativo `q'[…]'` es un carácter más, y cortar ahí manda al
/// servidor media instrucción. Es el mismo criterio que `SqlStatementReader`
/// aplica al leer un respaldo y que `sql-statements.ts` aplica para «Ejecutar
/// actual»; lo que cambia es el dialecto, que aquí sí se conoce.
///
/// **Un bloque PL/SQL no se parte por sus puntos y coma**: ahí son parte del
/// lenguaje. Lo que lo termina es la barra sola en su línea, que es la orden de
/// SQL*Plus para ejecutarlo, y así lo entienden también SQL Developer y DBeaver.
/// Un bloque sin barra se lleva el resto del guion —que es justo lo que hacen
/// esos clientes— y es la razón de que la barra no sea opcional cuando detrás
/// viene algo más.
/// </summary>
internal static class OracleScript
{
    /// <summary>
    /// Las instrucciones del guion, en orden y ya preparadas para el motor.
    ///
    /// Los fragmentos que solo tienen espacios o comentarios se descartan: un
    /// guion que termina en un comentario no lleva una instrucción vacía detrás,
    /// y mandarla sería un error donde no había nada que hacer.
    /// </summary>
    public static IReadOnlyList<OracleScriptStatement> Split(string sql)
    {
        ArgumentNullException.ThrowIfNull(sql);

        var statements = new List<OracleScriptStatement>();
        var index = 0;

        while (index < sql.Length)
        {
            var start = index;

            // Dónde acaba el contenido y por dónde sigue el guion. No son lo
            // mismo: el terminador se queda fuera de lo que se manda.
            var (contentEnd, next) = OracleStatement.IsPlSql(sql[start..])
                ? EndOfBlock(sql, start)
                : EndOfStatement(sql, start);

            var fragment = sql[start..contentEnd];

            // Los espacios de delante se van y el comentario se queda: el
            // comentario de cabecera de un procedimiento es parte de lo que
            // Oracle guarda en `ALL_SOURCE`, y quitarlo cambiaría lo que el
            // usuario verá mañana al abrir ese objeto.
            var text = fragment.TrimStart();

            if (OracleStatement.HasCode(text))
            {
                statements.Add(new OracleScriptStatement(
                    OracleStatement.Prepare(text),
                    start + (fragment.Length - text.Length)));
            }

            index = next;
        }

        return statements;
    }

    /// <summary>
    /// Hasta dónde llega una instrucción normal: el primer `;` que sea de verdad.
    /// </summary>
    private static (int ContentEnd, int Next) EndOfStatement(string sql, int start)
    {
        var index = start;

        while (index < sql.Length)
        {
            if (TrySkipNonCode(sql, ref index))
            {
                continue;
            }

            if (sql[index] == ';')
            {
                return (index, index + 1);
            }

            index++;
        }

        return (sql.Length, sql.Length);
    }

    /// <summary>
    /// Hasta dónde llega un bloque PL/SQL: la barra sola en su línea.
    ///
    /// Dentro del bloque se sigue saltando literales y comentarios, porque una
    /// barra dentro de un texto —o de una división escrita en una línea suya— no
    /// termina nada.
    /// </summary>
    private static (int ContentEnd, int Next) EndOfBlock(string sql, int start)
    {
        var index = start;

        while (index < sql.Length)
        {
            if (TrySkipNonCode(sql, ref index))
            {
                continue;
            }

            if (sql[index] == '/' && IsAlone(sql, index))
            {
                return (index, EndOfLine(sql, index));
            }

            index++;
        }

        return (sql.Length, sql.Length);
    }

    /// <summary>La barra está sola en su línea, que es lo que la hace terminador.</summary>
    private static bool IsAlone(string sql, int index)
    {
        for (var before = index - 1; before >= 0; before--)
        {
            if (sql[before] is '\n')
            {
                break;
            }

            if (!char.IsWhiteSpace(sql[before]))
            {
                return false;
            }
        }

        for (var after = index + 1; after < sql.Length; after++)
        {
            if (sql[after] is '\n')
            {
                break;
            }

            if (!char.IsWhiteSpace(sql[after]))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Dónde sigue el guion después de la línea de la barra.</summary>
    private static int EndOfLine(string sql, int index)
    {
        var end = sql.IndexOf('\n', index);

        return end < 0 ? sql.Length : end + 1;
    }

    /// <summary>
    /// Si en `index` empieza algo que no es código, lo salta entero y dice que sí.
    ///
    /// Es la pieza de la que depende todo lo demás: lo que hay dentro de un
    /// literal, de un identificador citado o de un comentario no separa ni
    /// termina nada.
    /// </summary>
    private static bool TrySkipNonCode(string sql, ref int index)
    {
        var rest = sql.AsSpan(index);

        if (rest.StartsWith("--"))
        {
            var end = sql.IndexOf('\n', index);

            index = end < 0 ? sql.Length : end + 1;

            return true;
        }

        if (rest.StartsWith("/*"))
        {
            var end = sql.IndexOf("*/", index + 2, StringComparison.Ordinal);

            index = end < 0 ? sql.Length : end + 2;

            return true;
        }

        if (TrySkipAlternativeQuote(sql, ref index))
        {
            return true;
        }

        if (sql[index] is '\'' or '"')
        {
            index = EndOfQuoted(sql, index);

            return true;
        }

        return false;
    }

    /// <summary>
    /// Salta un literal `'…'` o un identificador `"…"`.
    ///
    /// La comilla repetida no cierra: `'O''Donnell'` es un solo texto, y tratar
    /// la segunda como cierre dejaría el resto del guion leyéndose al revés —lo
    /// que está fuera pasaría a estar dentro—.
    /// </summary>
    private static int EndOfQuoted(string sql, int index)
    {
        var quote = sql[index];
        var scan = index + 1;

        while (scan < sql.Length)
        {
            if (sql[scan] != quote)
            {
                scan++;
                continue;
            }

            if (scan + 1 < sql.Length && sql[scan + 1] == quote)
            {
                scan += 2;
                continue;
            }

            return scan + 1;
        }

        return sql.Length;
    }

    /// <summary>
    /// Salta un literal alternativo `q'[…]'`, que es de Oracle y de nadie más.
    ///
    /// Existe justo para escribir textos llenos de comillas y de puntos y coma
    /// sin doblar nada, así que es el sitio donde más daño haría partir mal. El
    /// delimitador lo elige quien escribe, y los cuatro pares que abren y cierran
    /// cierran con su pareja; cualquier otro carácter cierra consigo mismo.
    /// </summary>
    private static bool TrySkipAlternativeQuote(string sql, ref int index)
    {
        if (sql[index] is not ('q' or 'Q') || index + 2 >= sql.Length || sql[index + 1] != '\'')
        {
            return false;
        }

        // `abcq'…'` no es un literal alternativo: la `q` es parte del nombre de
        // al lado.
        if (index > 0 && (char.IsLetterOrDigit(sql[index - 1]) || sql[index - 1] == '_'))
        {
            return false;
        }

        var opening = sql[index + 2];
        var closing = opening switch
        {
            '[' => ']',
            '{' => '}',
            '(' => ')',
            '<' => '>',
            _ => opening,
        };

        var end = sql.IndexOf(closing + "'", index + 3, StringComparison.Ordinal);

        index = end < 0 ? sql.Length : end + 2;

        return true;
    }
}
