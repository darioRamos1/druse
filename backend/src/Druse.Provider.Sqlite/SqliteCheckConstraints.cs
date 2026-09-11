using Druse.Domain;

namespace Druse.Provider.Sqlite;

/// <summary>
/// Las condiciones de comprobación de una tabla, sacadas del texto de su
/// `CREATE TABLE`.
///
/// **Es el único sitio donde están.** SQLite admite condiciones de comprobación y
/// las aplica, pero no las publica en ningún `PRAGMA` ni en ninguna vista: lo
/// único que guarda es el `CREATE TABLE` tal como alguien lo escribió. Los otros
/// cinco motores las devuelven desde su catálogo; aquí hay que leerlas del texto o
/// no hay nada que leer.
///
/// Y hace falta leerlas, no es un lujo para la pantalla: reconstruir una tabla
/// —lo que hace el diseñador al cambiar el tipo de una columna— la vuelve a
/// escribir desde lo que se sepa de ella, así que **lo que no se lee se pierde**.
/// Una condición que desaparece no rompe nada el día que se pierde: deja entrar
/// meses después la fila que existía para impedir, y entonces ya no hay forma de
/// saber cuándo fue.
///
/// Lo que esto hace **no es interpretar SQL**, y la distinción importa porque
/// interpretarlo a medias produciría condiciones inventadas. Solo recorre el texto
/// buscando la palabra `CHECK` y se queda con lo que hay dentro de su paréntesis,
/// contando paréntesis para saber dónde cierra. La expresión se copia **literal**:
/// no se entiende, no se normaliza y no se reescribe. Lo que sí hay que saber es
/// dónde *no* mirar —dentro de una cadena, de un identificador citado o de un
/// comentario—, porque un `CHECK` escrito ahí es texto y no una restricción.
/// </summary>
internal static class SqliteCheckConstraints
{
    /// <summary>
    /// Las condiciones que declara ese `CREATE TABLE`, en el orden en que aparecen.
    ///
    /// Las que no tienen nombre vuelven con el nombre vacío, que es lo que son:
    /// SQLite no les inventa uno. Quien las vuelva a escribir las escribe igual,
    /// sin nombre, porque ponerles uno cambiaría la tabla por el camino.
    /// </summary>
    public static IReadOnlyList<DatabaseCheckConstraint> Read(string? createTable) =>
        Scan(createTable).Checks;

    /// <summary>
    /// Las restricciones de unicidad **con nombre** que declara ese `CREATE
    /// TABLE`, con las columnas sobre las que van.
    ///
    /// Por lo mismo que las condiciones: el nombre solo está aquí. Lo que SQLite
    /// publica de una restricción de unicidad es el índice que la sostiene, y ese
    /// se llama siempre `sqlite_autoindex_<tabla>_<n>` por más que quien la
    /// escribió le pusiera `uq_pedidos_codigo`. Leerlo del texto es lo que hace
    /// que el nombre sobreviva a releer la tabla —y a reconstruirla, que es
    /// cuando de verdad se pierde lo que no se lee—.
    ///
    /// Solo se reconocen las de la tabla, que son las que llevan sus columnas
    /// entre paréntesis. Un `codigo TEXT CONSTRAINT uq UNIQUE` escrito en la
    /// columna no se recoge: no dice columnas, así que no hay con qué emparejarlo
    /// sin interpretar el resto de la definición.
    /// </summary>
    public static IReadOnlyList<DeclaredConstraint> ReadUnique(string? createTable) =>
        Scan(createTable).Unique;

    /// <summary>
    /// Las claves foráneas **con nombre**, con las columnas de las que salen.
    ///
    /// Lo mismo que con la unicidad: `PRAGMA foreign_key_list` numera las claves
    /// de una tabla pero no dice cómo se llaman, así que sin leer el texto la
    /// clave `fk_pedidos_cliente` se relee como `fk_pedidos_0` —y con ese nombre
    /// se vuelve a escribir al reconstruir la tabla—.
    /// </summary>
    public static IReadOnlyList<DeclaredConstraint> ReadForeignKeys(string? createTable) =>
        Scan(createTable).ForeignKeys;

    private static (
        IReadOnlyList<DatabaseCheckConstraint> Checks,
        IReadOnlyList<DeclaredConstraint> Unique,
        IReadOnlyList<DeclaredConstraint> ForeignKeys)
        Scan(string? createTable)
    {
        if (string.IsNullOrWhiteSpace(createTable))
        {
            return ([], [], []);
        }

        var text = createTable;
        var found = new List<DatabaseCheckConstraint>();
        var unique = new List<DeclaredConstraint>();
        var foreignKeys = new List<DeclaredConstraint>();

        // La profundidad de paréntesis. Una condición vive dentro del cuerpo de la
        // tabla, nunca en el nivel cero.
        var depth = 0;

        // El nombre de un `CONSTRAINT` que se acaba de leer y todavía no se sabe de
        // qué restricción es: puede ser de esta condición o de una clave foránea.
        string? pending = null;
        var expectingName = false;

        var i = 0;

        while (i < text.Length)
        {
            var c = text[i];

            if (c == '-' && i + 1 < text.Length && text[i + 1] == '-')
            {
                while (i < text.Length && text[i] != '\n')
                {
                    i++;
                }

                continue;
            }

            if (c == '/' && i + 1 < text.Length && text[i + 1] == '*')
            {
                i += 2;

                while (i + 1 < text.Length && !(text[i] == '*' && text[i + 1] == '/'))
                {
                    i++;
                }

                i = Math.Min(text.Length, i + 2);

                continue;
            }

            // Cadenas e identificadores citados. Se salta el contenido entero: un
            // `CHECK` escrito dentro es una palabra, no una restricción. Y si lo
            // que se esperaba era un nombre, esto lo es —`CONSTRAINT "mi check"`—.
            if (c is '\'' or '"' or '`' or '[')
            {
                var start = i;

                i = SkipQuoted(text, i);

                if (expectingName)
                {
                    pending = Unquote(text[start..i]);
                    expectingName = false;
                }

                continue;
            }

            if (c == '(')
            {
                depth++;
                i++;
                continue;
            }

            if (c == ')')
            {
                depth--;
                i++;
                continue;
            }

            // Una coma en el cuerpo de la tabla cierra una definición y abre otra,
            // así que un nombre que siguiera esperando ya no es de nadie.
            if (c == ',' && depth == 1)
            {
                pending = null;
                expectingName = false;
                i++;
                continue;
            }

            if (char.IsLetter(c) || c == '_')
            {
                var start = i;

                while (i < text.Length && (char.IsLetterOrDigit(text[i]) || text[i] is '_' or '$'))
                {
                    i++;
                }

                var word = text[start..i];

                if (expectingName)
                {
                    pending = word;
                    expectingName = false;
                    continue;
                }

                if (word.Equals("CONSTRAINT", StringComparison.OrdinalIgnoreCase))
                {
                    expectingName = true;
                    continue;
                }

                if (depth >= 1 && word.Equals("CHECK", StringComparison.OrdinalIgnoreCase))
                {
                    if (Expression(text, ref i) is { } expression)
                    {
                        found.Add(new DatabaseCheckConstraint
                        {
                            Name = pending ?? string.Empty,
                            Expression = expression,
                        });
                    }

                    pending = null;

                    continue;
                }

                // `UNIQUE (a, b)` en el cuerpo de la tabla. Sin nombre no hay nada
                // que rescatar —el catálogo ya da el del índice— y un `UNIQUE` sin
                // paréntesis detrás es el de una columna, que no dice cuáles.
                if (depth == 1 && word.Equals("UNIQUE", StringComparison.OrdinalIgnoreCase))
                {
                    if (Expression(text, ref i) is { } columns && pending is { } name)
                    {
                        unique.Add(new DeclaredConstraint(name, Columns(columns)));
                    }

                    pending = null;

                    continue;
                }

                // `FOREIGN KEY (a) REFERENCES …`, que es la otra restricción cuyo
                // nombre solo vive aquí.
                if (depth == 1
                    && pending is not null
                    && word.Equals("FOREIGN", StringComparison.OrdinalIgnoreCase)
                    && TrySkipWord(text, ref i, "KEY")
                    && Expression(text, ref i) is { } origen)
                {
                    foreignKeys.Add(new DeclaredConstraint(pending, Columns(origen)));

                    pending = null;
                }

                continue;
            }

            i++;
        }

        return (found, unique, foreignKeys);
    }

    /// <summary>
    /// Consume la palabra que viene a continuación si es la esperada.
    ///
    /// Sirve para `FOREIGN KEY`, que son dos palabras: sin esto habría que
    /// tratar `KEY` por separado y una columna llamada `foreign` abriría una
    /// clave que no existe.
    /// </summary>
    private static bool TrySkipWord(string text, ref int i, string expected)
    {
        var j = SkipTrivia(text, i);

        if (j + expected.Length > text.Length
            || !text.AsSpan(j, expected.Length).Equals(expected, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var end = j + expected.Length;

        if (end < text.Length && (char.IsLetterOrDigit(text[end]) || text[end] is '_' or '$'))
        {
            return false;
        }

        i = end;

        return true;
    }

    /// <summary>Los nombres de columna de un `UNIQUE (a, "b c")`, ya sin comillas.</summary>
    private static IReadOnlyList<string> Columns(string list) =>
    [
        .. list.Split(',')
            .Select(part => part.Trim())
            .Select(part => part is ['\'' or '"' or '`' or '[', ..] ? Unquote(part) : part)
            .Where(part => part.Length > 0),
    ];

    /// <summary>
    /// Lo que hay dentro del paréntesis de un `CHECK`, contando paréntesis.
    ///
    /// Devuelve nulo si lo que sigue no es un paréntesis, que en un `CREATE TABLE`
    /// que el motor aceptó no puede pasar. Se contempla igual: esto lee texto que
    /// viene de fuera, y una sorpresa tiene que ser un «no sé» y no una excepción
    /// que tire la lectura de la tabla entera.
    /// </summary>
    private static string? Expression(string text, ref int i)
    {
        var j = SkipTrivia(text, i);

        if (j >= text.Length || text[j] != '(')
        {
            return null;
        }

        var start = j + 1;
        var depth = 1;

        j = start;

        while (j < text.Length && depth > 0)
        {
            var c = text[j];

            if (c is '\'' or '"' or '`' or '[')
            {
                j = SkipQuoted(text, j);
                continue;
            }

            if (c == '-' && j + 1 < text.Length && text[j + 1] == '-')
            {
                while (j < text.Length && text[j] != '\n')
                {
                    j++;
                }

                continue;
            }

            if (c == '(')
            {
                depth++;
            }
            else if (c == ')')
            {
                depth--;

                if (depth == 0)
                {
                    break;
                }
            }

            j++;
        }

        if (depth != 0)
        {
            return null;
        }

        var expression = text[start..j].Trim();

        // Se consume el paréntesis de cierre: lo que venga después ya no es de
        // esta condición.
        i = j + 1;

        return expression.Length == 0 ? null : expression;
    }

    /// <summary>Pasa una cadena o un identificador citado y devuelve qué hay después.</summary>
    private static int SkipQuoted(string text, int i)
    {
        var open = text[i];
        var close = open == '[' ? ']' : open;

        i++;

        while (i < text.Length)
        {
            if (text[i] == close)
            {
                // Doblada es una de verdad y sigue dentro: `'no''sé'`. Los
                // corchetes no tienen esa regla.
                if (close != ']' && i + 1 < text.Length && text[i + 1] == close)
                {
                    i += 2;
                    continue;
                }

                return i + 1;
            }

            i++;
        }

        return i;
    }

    /// <summary>Espacios y comentarios.</summary>
    private static int SkipTrivia(string text, int i)
    {
        while (i < text.Length)
        {
            if (char.IsWhiteSpace(text[i]))
            {
                i++;
                continue;
            }

            if (text[i] == '-' && i + 1 < text.Length && text[i + 1] == '-')
            {
                while (i < text.Length && text[i] != '\n')
                {
                    i++;
                }

                continue;
            }

            if (text[i] == '/' && i + 1 < text.Length && text[i + 1] == '*')
            {
                i += 2;

                while (i + 1 < text.Length && !(text[i] == '*' && text[i + 1] == '/'))
                {
                    i++;
                }

                i = Math.Min(text.Length, i + 2);

                continue;
            }

            break;
        }

        return i;
    }

    /// <summary>El nombre sin sus comillas, con las dobladas deshechas.</summary>
    private static string Unquote(string token)
    {
        if (token.Length < 2)
        {
            return token;
        }

        var open = token[0];
        var close = open == '[' ? ']' : open;
        var inner = token[1..^1];

        return close == ']'
            ? inner
            : inner.Replace($"{close}{close}", $"{close}", StringComparison.Ordinal);
    }
}

/// <summary>
/// Una restricción con columnas tal como la declaró quien escribió la tabla.
///
/// El nombre es el único dato que no se puede obtener de otra forma; las columnas
/// vienen con él para poder emparejarla con la que devuelve el catálogo, que sí
/// las trae pero con el nombre del índice interno.
/// </summary>
/// <param name="Name">El nombre escrito tras `CONSTRAINT`.</param>
/// <param name="Columns">Las columnas entre paréntesis, en su orden.</param>
internal sealed record DeclaredConstraint(string Name, IReadOnlyList<string> Columns);

/// <summary>Lo que una tabla declara en su texto y el catálogo no publica.</summary>
/// <param name="Unique">Las restricciones de unicidad con nombre.</param>
/// <param name="ForeignKeys">Las claves foráneas con nombre.</param>
internal sealed record DeclaredConstraints(
    IReadOnlyList<DeclaredConstraint> Unique,
    IReadOnlyList<DeclaredConstraint> ForeignKeys);
