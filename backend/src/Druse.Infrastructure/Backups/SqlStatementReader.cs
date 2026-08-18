using System.Runtime.CompilerServices;
using System.Text;

namespace Druse.Infrastructure.Backups;

/// <summary>
/// Parte un guion en las instrucciones que hay que ejecutar, **sin cargarlo en
/// memoria**.
///
/// Un respaldo de una base mediana ocupa cientos de megas y treinta mil `INSERT`;
/// leerlo entero para partirlo por `;` gastaría el doble de su tamaño en cadenas
/// antes de ejecutar la primera línea. Se lee por trozos y se va entregando.
///
/// El punto y coma solo separa cuando está **fuera de todo lo demás**: dentro de
/// un literal, de un identificador citado o de un comentario es un carácter más.
/// Los cuatro motores citan distinto —comillas dobles, corchetes, acentos
/// graves— así que se reconocen los cuatro: el artefacto no dice de qué motor
/// viene hasta que se lee su manifiesto, y para entonces ya hubo que partirlo.
///
/// **No se reconoce el `$cuerpo$ … $cuerpo$` de PostgreSQL.** Hoy el respaldo
/// escribe tablas, datos y restricciones, donde no aparece; reconocerlo a medias
/// sería peor que no hacerlo, porque un `$` suelto se tragaría el resto del
/// archivo buscando su pareja. Cuando entren funciones y procedimientos, entra
/// aquí con sus pruebas.
/// </summary>
public static class SqlStatementReader
{
    /// <summary>Cuánto se lee de golpe. Un respaldo grande son miles de vueltas.</summary>
    private const int BufferSize = 64 * 1024;

    /// <summary>
    /// Las instrucciones del guion, una a una y en orden.
    ///
    /// Se descartan las que solo tienen espacios o comentarios: entre la última
    /// instrucción y el manifiesto del final solo hay comentarios, y mandarlos al
    /// motor sería un error donde no había nada que hacer.
    /// </summary>
    public static async IAsyncEnumerable<string> ReadAsync(
        TextReader reader,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(reader);

        var buffer = new char[BufferSize];
        var current = new StringBuilder();
        var scan = new ScanState();
        int read;

        while ((read = await reader.ReadAsync(buffer.AsMemory(), cancellationToken)) > 0)
        {
            for (var index = 0; index < read; index++)
            {
                if (!scan.Consume(buffer[index], current))
                {
                    continue;
                }

                var statement = Clean(current.ToString());
                current.Clear();

                if (statement.Length > 0)
                {
                    yield return statement;
                }
            }
        }

        // Lo que quede sin `;` final también es una instrucción: el último
        // `CREATE TABLE` de un archivo escrito a mano suele no llevarlo.
        var last = Clean(current.ToString());

        if (last.Length > 0)
        {
            yield return last;
        }
    }

    /// <summary>Lo mismo, para un texto que ya está en memoria.</summary>
    public static IAsyncEnumerable<string> ReadAsync(
        string script,
        CancellationToken cancellationToken = default) =>
        ReadAsync(new StringReader(script), cancellationToken);

    /// <summary>
    /// Recorta los bordes y descarta lo que no es una instrucción.
    ///
    /// Los comentarios **dentro** del bloque se conservan: el artefacto escribe
    /// «-- Tabla: pedidos» antes de cada uno, y quien lea el error de una
    /// instrucción fallida agradece verla con su cabecera.
    /// </summary>
    private static string Clean(string statement)
    {
        var trimmed = statement.Trim();

        if (trimmed.Length == 0)
        {
            return string.Empty;
        }

        var meaningful = trimmed
            .Split('\n')
            .Select(line => line.Trim())
            .Any(line => line.Length > 0 && !line.StartsWith("--", StringComparison.Ordinal));

        return meaningful ? trimmed : string.Empty;
    }

    /// <summary>
    /// Dónde está el lector dentro del texto.
    ///
    /// Es una máquina de estados y no una expresión regular porque hay que
    /// distinguir un `;` de dentro de un literal de uno de verdad, y eso exige
    /// recordar por dónde se va.
    /// </summary>
    private sealed class ScanState
    {
        private enum Mode
        {
            Code,

            /// <summary>`-- …` hasta el fin de la línea.</summary>
            LineComment,

            /// <summary>`/* … */`.</summary>
            BlockComment,

            /// <summary>Literal `'…'`.</summary>
            Text,

            /// <summary>Identificador `"…"`, `[…]` o `` `…` ``.</summary>
            Quoted,
        }

        private Mode _mode = Mode.Code;
        private char _closing;
        private char _previous;

        /// <summary>
        /// Consume un carácter y dice si ahí terminaba una instrucción.
        ///
        /// El carácter se añade a <paramref name="statement"/> salvo el `;` que
        /// la cierra: el motor no lo necesita y sobra en el mensaje de error.
        /// </summary>
        public bool Consume(char character, StringBuilder statement)
        {
            switch (_mode)
            {
                case Mode.LineComment:
                    statement.Append(character);

                    if (character == '\n')
                    {
                        _mode = Mode.Code;
                    }

                    break;

                case Mode.BlockComment:
                    statement.Append(character);

                    if (_previous == '*' && character == '/')
                    {
                        _mode = Mode.Code;
                        // Se olvida el carácter para que `/*/` no cierre lo que
                        // acababa de abrir.
                        _previous = '\0';

                        return false;
                    }

                    break;

                case Mode.Text:
                    statement.Append(character);

                    // Una comilla cierra el literal. Si venía otra detrás —`''`,
                    // la forma de escribir una comilla dentro— el siguiente
                    // carácter vuelve a abrirlo, que es justo lo que hace falta.
                    if (character == '\'')
                    {
                        _mode = Mode.Code;
                    }

                    break;

                case Mode.Quoted:
                    statement.Append(character);

                    if (character == _closing)
                    {
                        _mode = Mode.Code;
                    }

                    break;

                default:
                    return Code(character, statement);
            }

            _previous = character;

            return false;
        }

        private bool Code(char character, StringBuilder statement)
        {
            switch (character)
            {
                case '\'':
                    _mode = Mode.Text;
                    break;

                case '"':
                case '[':
                case '`':
                    _mode = Mode.Quoted;
                    _closing = character == '[' ? ']' : character;
                    break;

                case '-' when _previous == '-':
                    _mode = Mode.LineComment;
                    break;

                case '*' when _previous == '/':
                    _mode = Mode.BlockComment;
                    break;

                case ';':
                    _previous = '\0';

                    return true;
            }

            statement.Append(character);
            _previous = character;

            return false;
        }
    }
}
