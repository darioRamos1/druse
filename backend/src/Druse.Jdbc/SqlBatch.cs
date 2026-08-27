namespace Druse.Jdbc;

/// <summary>
/// Parte un texto SQL en las sentencias que lo componen.
///
/// Hace falta porque **JDBC ejecuta una sentencia por statement**, mientras que
/// ADO.NET admite mandar varias de una vez y recorrer sus resultados con
/// `NextResult`. Sin esto, un guion tan corriente como tres `INSERT` seguidos
/// falla entero, y el motor devuelve un error de sintaxis que apunta al `;`
/// —o peor, no devuelve nada— dejando al usuario buscando una falta que no
/// existe.
///
/// El corte respeta lo que un `;` puede tener dentro sin ser un separador:
/// literales, identificadores citados y comentarios de línea y de bloque.
/// </summary>
public static class SqlBatch
{
    /// <summary>
    /// Las sentencias del texto, sin las vacías.
    ///
    /// Devuelve una sola entrada cuando no hay `;` fuera de literal, que es el
    /// caso normal y el que no debe pagar nada por esto.
    /// </summary>
    public static IReadOnlyList<string> Split(string sql)
    {
        if (string.IsNullOrWhiteSpace(sql))
        {
            return [];
        }

        var sentencias = new List<string>();
        var actual = new System.Text.StringBuilder(sql.Length);
        var indice = 0;

        while (indice < sql.Length)
        {
            var caracter = sql[indice];

            // Comentario de línea: hasta el salto, y el salto se conserva porque
            // separa palabras.
            if (caracter == '-' && Siguiente(sql, indice) == '-')
            {
                while (indice < sql.Length && sql[indice] != '\n')
                {
                    actual.Append(sql[indice]);
                    indice++;
                }

                continue;
            }

            // Comentario de bloque.
            if (caracter == '/' && Siguiente(sql, indice) == '*')
            {
                actual.Append(sql[indice]).Append(sql[indice + 1]);
                indice += 2;

                while (indice < sql.Length && !(sql[indice] == '*' && Siguiente(sql, indice) == '/'))
                {
                    actual.Append(sql[indice]);
                    indice++;
                }

                for (var cierre = 0; cierre < 2 && indice < sql.Length; cierre++, indice++)
                {
                    actual.Append(sql[indice]);
                }

                continue;
            }

            // Literales y nombres citados. Un `;` aquí dentro es texto, no un
            // separador, y cortar por él partiría la sentencia por la mitad.
            if (caracter is '\'' or '"')
            {
                var cierre = caracter;

                actual.Append(caracter);
                indice++;

                while (indice < sql.Length)
                {
                    // Comilla doblada: escape del propio literal, no su final.
                    if (sql[indice] == cierre && Siguiente(sql, indice) == cierre)
                    {
                        actual.Append(cierre).Append(cierre);
                        indice += 2;
                        continue;
                    }

                    var termina = sql[indice] == cierre;

                    actual.Append(sql[indice]);
                    indice++;

                    if (termina)
                    {
                        break;
                    }
                }

                continue;
            }

            // Un bloque de rutina no se corta por sus `;`.
            //
            // En Informix la firma termina en `;` y el cuerpo lleva uno por
            // línea: partir por ahí deja un `CREATE PROCEDURE` a medias, que el
            // motor acepta o rechaza de formas difíciles de leer. El bloque va
            // entero hasta su `END`.
            if (EmpiezaBloque(sql, indice, out var fin))
            {
                actual.Append(sql, indice, fin - indice);
                indice = fin;
                continue;
            }

            if (caracter == ';')
            {
                Guardar(sentencias, actual);
                indice++;
                continue;
            }

            actual.Append(caracter);
            indice++;
        }

        Guardar(sentencias, actual);

        return sentencias;
    }

    /// <summary>
    /// ¿Empieza aquí un `CREATE PROCEDURE` o `CREATE FUNCTION`?
    ///
    /// Si empieza, <paramref name="fin"/> queda justo detrás de su `END`. Se
    /// busca el `END PROCEDURE` o `END FUNCTION` que lo cierra; si no aparece
    /// —texto incompleto—, se toma hasta el final, que es mejor que trocearlo.
    /// </summary>
    private static bool EmpiezaBloque(string sql, int indice, out int fin)
    {
        fin = indice;

        if (!EsPalabraEn(sql, indice, "CREATE"))
        {
            return false;
        }

        var despues = SaltarPalabraYEspacios(sql, indice + "CREATE".Length);

        // `CREATE DBA PROCEDURE` existe y es lo mismo con otros permisos.
        if (EsPalabraEn(sql, despues, "DBA"))
        {
            despues = SaltarPalabraYEspacios(sql, despues + "DBA".Length);
        }

        var tipo = EsPalabraEn(sql, despues, "PROCEDURE")
            ? "PROCEDURE"
            : EsPalabraEn(sql, despues, "FUNCTION") ? "FUNCTION" : null;

        if (tipo is null)
        {
            return false;
        }

        var cierre = sql.IndexOf($"END {tipo}", despues, StringComparison.OrdinalIgnoreCase);

        fin = cierre < 0 ? sql.Length : cierre + $"END {tipo}".Length;

        return true;
    }

    /// <summary>La palabra empieza aquí y no es parte de un identificador mayor.</summary>
    private static bool EsPalabraEn(string sql, int indice, string palabra)
    {
        if (indice + palabra.Length > sql.Length)
        {
            return false;
        }

        if (string.Compare(sql, indice, palabra, 0, palabra.Length, StringComparison.OrdinalIgnoreCase) != 0)
        {
            return false;
        }

        var siguiente = indice + palabra.Length;

        return siguiente >= sql.Length
            || (!char.IsLetterOrDigit(sql[siguiente]) && sql[siguiente] != '_');
    }

    private static int SaltarPalabraYEspacios(string sql, int indice)
    {
        while (indice < sql.Length && char.IsWhiteSpace(sql[indice]))
        {
            indice++;
        }

        return indice;
    }

    private static char Siguiente(string sql, int indice) =>
        indice + 1 < sql.Length ? sql[indice + 1] : '\0';

    /// <summary>Cierra la sentencia en curso, si tiene algo que no sea espacio.</summary>
    private static void Guardar(List<string> sentencias, System.Text.StringBuilder actual)
    {
        var texto = actual.ToString().Trim();

        if (texto.Length > 0)
        {
            sentencias.Add(texto);
        }

        actual.Clear();
    }
}
