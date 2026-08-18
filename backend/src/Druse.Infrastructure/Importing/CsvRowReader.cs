using System.Runtime.CompilerServices;
using System.Text;

namespace Druse.Infrastructure.Importing;

/// <summary>
/// La máquina de estados del RFC 4180: se le empujan caracteres y devuelve filas.
///
/// Vive aparte de quien lee el archivo porque hay dos formas de leerlo y las dos
/// tienen que partirlo igual: la importación se trae el texto entero —necesita
/// contar las filas y mirar el ancho de todas antes de mapear columnas— y la
/// restauración lo recorre por lotes, porque un respaldo puede traer tres
/// millones de filas y no caben en memoria.
///
/// Dos formas de partir un CSV serían dos formas de equivocarse con las
/// comillas, que es justo lo que el RFC existe para evitar.
/// </summary>
internal sealed class CsvSplitter(char delimiter)
{
    private readonly List<string> _row = [];
    private readonly StringBuilder _field = new();

    private bool _quoted;

    /// <summary>
    /// Se vio una comilla dentro de un campo entrecomillado y todavía no se sabe
    /// si cierra el campo o si es una comilla escrita dos veces.
    /// </summary>
    private bool _pending;

    /// <summary>Empuja un carácter. Devuelve la fila cuando se completa.</summary>
    public List<string>? Push(char character)
    {
        if (_pending)
        {
            _pending = false;

            // Dos comillas seguidas son una comilla dentro del campo.
            if (character == '"')
            {
                _field.Append('"');
                return null;
            }

            // No lo eran: la anterior cerraba el campo y este carácter va fuera.
            _quoted = false;
        }

        if (_quoted)
        {
            if (character == '"')
            {
                _pending = true;
                return null;
            }

            _field.Append(character);
            return null;
        }

        switch (character)
        {
            case '"' when _field.Length == 0:
                _quoted = true;
                return null;

            // Se ignora: el salto lo marca el \n que viene detrás.
            case '\r':
                return null;

            case '\n':
                return EndRow();

            default:
                if (character == delimiter)
                {
                    _row.Add(_field.ToString());
                    _field.Clear();
                    return null;
                }

                _field.Append(character);
                return null;
        }
    }

    /// <summary>Lo que quede sin salto de línea final también es una fila.</summary>
    public List<string>? Flush()
    {
        _pending = false;
        _quoted = false;

        return _field.Length > 0 || _row.Count > 0 ? EndRow() : null;
    }

    private List<string> EndRow()
    {
        _row.Add(_field.ToString());
        _field.Clear();

        var row = new List<string>(_row);

        _row.Clear();

        return row;
    }
}

/// <summary>
/// Lee un CSV fila a fila, sin cargarlo entero en memoria.
///
/// Es el camino que usa la restauración: los datos de una tabla pueden ocupar
/// más que la memoria del proceso, y el artefacto se abre precisamente para
/// mirarlo antes de decidir si es el que se buscaba.
/// </summary>
public static class CsvRowReader
{
    /// <summary>Cuántos caracteres se piden de una vez al archivo.</summary>
    private const int BufferSize = 8 * 1024;

    /// <summary>Las filas del archivo, tal cual vienen y sin interpretar nada.</summary>
    public static async IAsyncEnumerable<IReadOnlyList<string>> ReadAsync(
        TextReader reader,
        char delimiter,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(reader);

        var splitter = new CsvSplitter(delimiter);
        var buffer = new char[BufferSize];

        int read;

        while ((read = await reader.ReadAsync(buffer.AsMemory(), cancellationToken)) > 0)
        {
            for (var index = 0; index < read; index++)
            {
                if (splitter.Push(buffer[index]) is { } row)
                {
                    yield return row;
                }
            }
        }

        if (splitter.Flush() is { } last)
        {
            yield return last;
        }
    }
}
